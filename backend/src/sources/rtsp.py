"""
Live RTSP source: one NVR channel, read from the local media server and
decoded on the GPU, emitting the same ``FramePacket`` as recorded video.

Decoding: ffmpeg ``hevc_cuvid`` / ``h264_cuvid`` (NVDEC). Streams wider than
``max_width`` are resized by the decoder itself (on the GPU). The rate is
capped at ``target_fps`` by a timestamp ``select`` filter — surplus frames
are DROPPED, never duplicated, so the measured fps is the real one. Packets
before the first keyframe of a connection are discarded, so a mid-GOP join
never hands corrupt frames to the pipelines. Only NV12
frames at the processing rate cross to the CPU. If NVDEC fails twice in a row
without producing a frame the source falls back to software decoding.

Health / reconnect (states reported to the main process):
  CONNECTING    first connection attempt
  CONNECTED     frames arriving at ≥ ``degraded_fps_ratio`` × target, age < ``degraded_after_s``
  DEGRADED      frames arriving, but late or below that rate
  RECONNECTING  stream lost (decoder exit, stall, media server path not ready) —
                decoder restarts back off exponentially (1 s … ``max_backoff_s``);
                while the NVR itself is down the media server is polled every second
  ERROR         the decoder itself cannot run (e.g. unsupported codec)
A stall watchdog kills the decoder when no frame arrives for ``stall_timeout_s``.
The first frame after a reconnect carries ``loop_reset=True`` so pipelines drop
tracker identities across the gap (counts / baselines are kept).
"""

import collections
import json
import logging
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from typing import Optional

import cv2
import numpy as np

from src.sources.packet import FramePacket
from src.procutil import die_with_parent
from src.sources.nvr import redact

logger = logging.getLogger("sources.rtsp")

CUVID = {"H265": "hevc_cuvid", "H264": "h264_cuvid"}
SOFTWARE = {"H265": "hevc", "H264": "h264"}


class LiveRTSPSource(threading.Thread):
    source_type = "rtsp"

    def __init__(self, spec: dict, sink, target_fps: float):
        super().__init__(daemon=True, name=f"rtsp-{spec['id']}")
        self.stream_id = spec["id"]
        self.url = spec["url"]                        # local media-server URL (no credentials)
        self.path = spec["path"]
        self.api_url = spec["api_url"]
        self.sink = sink
        self.target_fps = float(target_fps)
        self.max_width = int(spec.get("max_width", 1280))
        self.stall_timeout_s = float(spec.get("stall_timeout_s", 5.0))
        self.connect_timeout_s = float(spec.get("connect_timeout_s", 12.0))
        self.degraded_after_s = float(spec.get("degraded_after_s", 2.0))
        self.degraded_fps_ratio = float(spec.get("degraded_fps_ratio", 0.6))
        self.max_backoff_s = float(spec.get("max_backoff_s", 15.0))
        self.use_nvdec = bool(spec.get("nvdec", True))
        self._stop_event = threading.Event()
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        # health
        self.state = "CONNECTING"
        self.codec: Optional[str] = None
        self.width = int(spec.get("width") or 0)      # source resolution (zone coordinates)
        self.height = int(spec.get("height") or 0)
        self.out_w = self.out_h = 0
        self.decoder: Optional[str] = None
        self.frames = 0
        self.reconnects = 0
        self.connected_since: Optional[float] = None
        self.last_frame_at: Optional[float] = None    # time.time()
        self.last_error: Optional[str] = None
        self._times = collections.deque(maxlen=64)    # monotonic emit times
        self._nvdec_failures = 0
        self._stderr = collections.deque(maxlen=20)

    # ── public ───────────────────────────────────────────────────────

    def stop(self) -> None:
        self._stop_event.set()
        self._kill()

    def health(self) -> dict:
        now = time.monotonic()
        with self._lock:
            times = [t for t in self._times if now - t <= 5.0]
            state = self.state
        fps = (len(times) - 1) / (times[-1] - times[0]) if len(times) > 2 and times[-1] > times[0] else 0.0
        age = time.time() - self.last_frame_at if self.last_frame_at else None
        if state == "CONNECTED" and (age is None or age > self.degraded_after_s
                                     or (len(times) > 2 and fps < self.degraded_fps_ratio * self.target_fps)):
            state = "DEGRADED"
        return {
            "source_type": self.source_type, "state": state, "path": self.path,
            "fps": round(fps, 1), "target_fps": self.target_fps,
            "last_frame_age_s": round(age, 2) if age is not None else None,
            "last_frame_at": self.last_frame_at, "frames": self.frames, "reconnects": self.reconnects,
            "connected_since": self.connected_since, "codec": self.codec, "decoder": self.decoder,
            "width": self.width, "height": self.height, "process_width": self.out_w,
            "process_height": self.out_h, "last_error": self.last_error,
        }

    # ── internals ────────────────────────────────────────────────────

    def _set_state(self, state: str) -> None:
        with self._lock:
            if state != self.state:
                logger.info("[%s] stream %s → %s%s", self.stream_id, self.state, state,
                            f" ({self.last_error})" if state in ("RECONNECTING", "ERROR") and self.last_error else "")
            self.state = state

    def _kill(self) -> None:
        p = self._proc
        if p is not None and p.poll() is None:
            p.kill()

    def _upstream(self) -> Optional[dict]:
        """Codec + resolution from the media server, or None while the path isn't ready."""
        try:
            with urllib.request.urlopen(f"{self.api_url}/v3/paths/get/{self.path}", timeout=3) as r:
                info = json.load(r)
        except (urllib.error.URLError, OSError, ValueError):
            return None
        if not info.get("ready"):
            return None
        for t in info.get("tracks2") or []:
            if t.get("codec") in ("H264", "H265"):
                p = t.get("codecProps") or {}
                return {"codec": t["codec"], "width": p.get("width"), "height": p.get("height")}
        return {"codec": next((t.get("codec") for t in info.get("tracks2") or []), None), "width": None, "height": None}

    def _command(self, codec: str, nvdec: bool) -> list:
        cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
               "-rtsp_transport", "tcp", "-timeout", str(int(self.stall_timeout_s * 1e6)),
               "-fflags", "nobuffer", "-flags", "low_delay",
               # Joining a live stream mid-GOP: drop packets until the first
               # keyframe, otherwise NVDEC emits corrupt (green/grey) frames
               # to the AI for up to one GOP after every (re)connect.
               "-bsf:v", "noise=drop='eq(st(0\\,ld(0)+key)\\,0)'"]
        if nvdec:
            cmd += ["-c:v", CUVID[codec]]
            if (self.out_w, self.out_h) != (self.width, self.height):
                cmd += ["-resize", f"{self.out_w}x{self.out_h}"]     # scaled inside NVDEC
            vf = "format=nv12"
        else:
            cmd += ["-c:v", SOFTWARE[codec], "-threads", "2"]
            vf = f"scale={self.out_w}:{self.out_h},format=nv12" if (self.out_w, self.out_h) != (self.width, self.height) else "format=nv12"
        # Keep a frame once ≥ 0.9 frame intervals passed since the last kept one:
        # drops surplus frames, never duplicates (unlike the fps filter / -r)
        gap = 0.9 / self.target_fps
        vf = f"select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,{gap:.4f})',{vf}"
        cmd += ["-i", self.url, "-an", "-sn", "-dn", "-vf", vf, "-fps_mode", "passthrough",
                "-f", "rawvideo", "pipe:1"]
        return cmd

    def _read_stderr(self, proc: subprocess.Popen) -> None:
        for raw in proc.stderr:
            line = redact(raw.decode(errors="replace").strip())
            if line:
                self._stderr.append(line)

    def _watchdog(self, proc: subprocess.Popen, started: float) -> None:
        while proc.poll() is None and not self._stop_event.is_set():
            time.sleep(0.5)
            now = time.monotonic()
            last = self._times[-1] if self._times and self._times[-1] >= started else None
            if last is None and now - started > self.connect_timeout_s:
                self.last_error = f"no frame within {self.connect_timeout_s:.0f}s of connecting"
                proc.kill()
            elif last is not None and now - last > self.stall_timeout_s:
                self.last_error = f"stream stalled (no frame for {now - last:.1f}s)"
                proc.kill()

    def _session(self, up: dict, nvdec: bool) -> int:
        """One decoder run; returns the number of frames emitted."""
        self._stderr.clear()
        self._proc = proc = subprocess.Popen(
            self._command(up["codec"], nvdec), stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
            preexec_fn=lambda: die_with_parent(signal.SIGKILL),
        )
        started = time.monotonic()
        err_reader = threading.Thread(target=self._read_stderr, args=(proc,), daemon=True)
        err_reader.start()
        threading.Thread(target=self._watchdog, args=(proc, started), daemon=True).start()
        frame_size = self.out_w * self.out_h * 3 // 2
        buf = bytearray(frame_size)
        view = memoryview(buf)
        coord_scale = self.width / self.out_w
        emitted = 0
        try:
            while not self._stop_event.is_set():
                got = 0
                while got < frame_size:
                    n = proc.stdout.readinto(view[got:])
                    if not n:
                        break
                    got += n
                if got < frame_size:
                    break
                nv12 = np.frombuffer(buf, np.uint8).reshape(self.out_h * 3 // 2, self.out_w)
                frame = cv2.cvtColor(nv12, cv2.COLOR_YUV2BGR_NV12)
                now = time.time()
                if emitted == 0:
                    self.connected_since = now
                    self.last_error = None
                    self._set_state("CONNECTED")
                packet = FramePacket(
                    frame=frame, frame_id=self.frames, stream_id=self.stream_id,
                    loop_reset=(emitted == 0 and self.frames > 0),   # discontinuity after a reconnect
                    timestamp=now, video_time_sec=now - (self.connected_since or now), coord_scale=coord_scale,
                )
                self.frames += 1
                emitted += 1
                self.last_frame_at = now
                with self._lock:
                    self._times.append(time.monotonic())
                self.sink.put(packet)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
            err_reader.join(timeout=1.0)
            self._proc = None
        if not self._stop_event.is_set():
            tail = " | ".join(list(self._stderr)[-2:])
            if tail:
                self.last_error = tail[-300:]
            elif self.last_error is None:
                self.last_error = f"decoder exited (code {proc.returncode})"
        return emitted

    def run(self) -> None:
        backoff = 1.0
        attempt = 0
        while not self._stop_event.is_set():
            attempt += 1
            up = self._upstream()
            if up is None:
                if self.last_error is None or not self.last_error.startswith("waiting"):
                    self.last_error = "waiting for the NVR stream on the media server"
                self._set_state("CONNECTING" if self.frames == 0 and attempt <= 1 else "RECONNECTING")
                # Polling the local media server is cheap: reconnect within ~1 s
                # of the NVR coming back instead of waiting out a long backoff
                if self._stop_event.wait(1.0):
                    break
                backoff = 1.0
                continue
            elif up["codec"] not in CUVID:
                self.last_error = f"unsupported video codec {up['codec']}"
                self._set_state("ERROR")
            else:
                self.codec = up["codec"]
                if up["width"] and up["height"]:
                    self.width, self.height = int(up["width"]), int(up["height"])
                w, h = self.width or 1280, self.height or 720
                self.width, self.height = w, h
                if w > self.max_width:
                    self.out_w, self.out_h = self.max_width, int(round(h * self.max_width / w / 2)) * 2
                else:
                    self.out_w, self.out_h = w, h
                nvdec = self.use_nvdec and self._nvdec_failures < 2
                self.decoder = f"nvdec ({CUVID[self.codec]})" if nvdec else f"cpu ({SOFTWARE[self.codec]})"
                t0 = time.monotonic()
                emitted = self._session(up, nvdec)
                if self._stop_event.is_set():
                    break
                if emitted == 0 and nvdec and any(k in (self.last_error or "") for k in ("cuvid", "CUDA", "cuda", "NVDEC")):
                    self._nvdec_failures += 1
                    if self._nvdec_failures >= 2:
                        logger.warning("[%s] NVDEC unavailable (%s) — falling back to CPU decoding",
                                       self.stream_id, self.last_error)
                elif emitted:
                    self._nvdec_failures = 0 if nvdec else self._nvdec_failures
                    self.reconnects += 1
                if time.monotonic() - t0 > 30:
                    backoff = 1.0
                self._set_state("RECONNECTING")
            if self._stop_event.wait(backoff):
                break
            backoff = min(backoff * 2, self.max_backoff_s)
        self._set_state("STOPPED")
