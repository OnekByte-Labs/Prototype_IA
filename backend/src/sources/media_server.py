"""
Media server (MediaMTX) supervisor — the single RTSP client of the NVR.

    NVR ──RTSP (1 connection per channel/subtype)──▶ MediaMTX ─┬─▶ AI ingest (RTSP, localhost)
                                                               ├─▶ browser (WebRTC / WHEP)
                                                               └─▶ on-demand H.264 (NVENC) for
                                                                   browsers without H.265

  * Substream paths (``nvr01ch07``) are always pulled, so stream health is
    known for every camera; main-stream paths (``nvr01ch07main``) are pulled
    only while someone reads them (focused / full-screen view).
  * A ``type: file`` source (sources/nvr.py) is published into the same path
    layout by looping the file with ffmpeg (``-c copy``, real-time paced): the
    substream path from a 1280-wide H.264 copy prepared once and cached in
    data/file_sources/ (always on, like an NVR substream), the main path from
    the untouched original (on demand). Nothing is decoded or encoded at run
    time, so the GPU stays free for detection. Everything downstream — AI
    ingest, WebRTC, health, detection modes — is identical to an NVR channel.
  * ``nvr01ch07h264`` exists only if transcoding is enabled: an ffmpeg
    NVDEC→NVENC job started when a browser that cannot decode H.265 opens the
    focused view and stopped when it leaves. Nothing is transcoded otherwise.
  * Credentials: the generated config file contains no upstream URLs. Each
    path's credentialed source is passed in the child's environment
    (``MTX_PATHS_<NAME>_SOURCE``) and MediaMTX never logs it; every forwarded
    log line is additionally redacted.
  * Every listener binds to localhost except WebRTC ICE (UDP) — browsers only
    reach MediaMTX through the backend's authenticated WHEP proxy.
"""

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

import yaml

from src.procutil import die_with_parent
from src.sources.nvr import NvrConfig, redact

logger = logging.getLogger("sources.media")

BACKEND = Path(__file__).resolve().parents[2]
_LOG_RE = re.compile(r"^\S+ \S+ (DEB|INF|WAR|ERR) (?:\[path ([^\]]+)\] )?(.*)$")
_LOST_RE = re.compile(r"(\d+) RTP packets? lost")
_PROC_ERR_RE = re.compile(r"(\d+) processing errors?")
_STATUS_RE = re.compile(r"bad status code: (\d{3})")
# Upstream failures that retrying will not fix without a configuration change
PERMANENT_STATUS = {401: "NVR rejected the credentials (401)", 403: "NVR denied access to this channel (403)",
                    404: "NVR has no stream on this channel (404)"}


def path_name(nvr_id: str, channel: int, variant: str = "") -> str:
    """NVR-01, 7 → nvr01ch07 (alphanumeric: MediaMTX maps MTX_PATHS_<NAME>_* env vars to it)."""
    slug = re.sub(r"[^a-z0-9]", "", nvr_id.lower())
    return f"{slug}ch{channel:02d}{variant}"


class MediaServer:
    def __init__(self, cfg: dict, nvrs: Dict[str, NvrConfig], bindings: List[dict]):
        """``bindings``: [{camera_id, nvr_id, channel, subtype}] for every live camera."""
        self.cfg = cfg
        self.nvrs = nvrs
        self.rtsp_port = int(cfg.get("rtsp_port", 8554))
        self.api_port = int(cfg.get("api_port", 9997))
        self.webrtc_port = int(cfg.get("webrtc_port", 8889))
        self.ice_udp_port = int(cfg.get("webrtc_ice_udp_port", 8189))
        self.transcode = cfg.get("browser_transcode", "h264_nvenc")   # h264_nvenc | off
        self.binary = (os.environ.get("MEDIAMTX_BIN") or cfg.get("binary") or str(BACKEND / "bin" / "mediamtx"))
        if not Path(self.binary).is_file():
            self.binary = shutil.which("mediamtx") or self.binary
        self.config_path = BACKEND / "data" / "mediamtx.yml"
        self.paths: Dict[str, dict] = {}          # path → {nvr_id, channel, subtype, role, on_demand}
        for b in bindings:
            self._add_paths(b)
        self._proc: Optional[subprocess.Popen] = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._stats: Dict[str, dict] = {}         # path → live stats (API poll + log parsing)
        self._prev_bytes: Dict[str, tuple] = {}
        self._last_log: Dict[tuple, float] = {}
        self.restarts = 0
        self.started_at: Optional[float] = None
        self.last_error: Optional[str] = None

    # ── configuration ────────────────────────────────────────────────

    def _add_paths(self, b: dict) -> None:
        nvr, ch = b["nvr_id"], int(b["channel"])
        ai_sub = int(b.get("subtype", 1))
        sub, main = path_name(nvr, ch), path_name(nvr, ch, "main")
        src = self.nvrs[nvr]
        if src.is_file:
            # Looped file: scaled copy as the always-on substream, original on demand (already H.264: no fallback path)
            original = src.files[ch]
            self.paths[sub] = {"nvr_id": nvr, "channel": ch, "subtype": 1, "file": str(self._ensure_scaled(original)),
                               "on_demand": ai_sub != 1}
            self.paths[main] = {"nvr_id": nvr, "channel": ch, "subtype": 0, "file": str(original), "on_demand": True}
            return
        # The AI ingest reads its subtype continuously; the other one is on demand
        self.paths[sub] = {"nvr_id": nvr, "channel": ch, "subtype": 1, "on_demand": ai_sub != 1}
        self.paths[main] = {"nvr_id": nvr, "channel": ch, "subtype": 0, "on_demand": ai_sub != 0}
        if self.transcode == "h264_nvenc":
            self.paths[path_name(nvr, ch, "h264")] = {"nvr_id": nvr, "channel": ch, "subtype": 0,
                                                      "transcode_of": main}

    def rtsp_url(self, path: str) -> str:
        """Local (credential-free) URL for AI ingest."""
        return f"rtsp://127.0.0.1:{self.rtsp_port}/{path}"

    def api_url(self) -> str:
        return f"http://127.0.0.1:{self.api_port}"

    def _transcode_cmd(self, src: str) -> str:
        # Zero-copy NVDEC → NVENC: frames stay on the GPU; low-latency H.264
        # without B-frames (WebRTC), 1 s GOP so a new viewer starts fast.
        max_w = int(self.cfg.get("transcode_max_width", 1920))
        bitrate = self.cfg.get("transcode_bitrate", "3M")
        return (
            "ffmpeg -hide_banner -nostdin -loglevel error -rtsp_transport tcp "
            "-hwaccel cuda -hwaccel_output_format cuda "
            f"-i rtsp://127.0.0.1:{self.rtsp_port}/{src} -an "
            # MediaMTX shell-splits this string: double quotes keep the value whole,
            # "\\," escapes the comma for ffmpeg's filtergraph parser
            f'-vf "scale_cuda=w=min({max_w}\\,iw):h=-2" '
            f"-c:v h264_nvenc -preset p2 -tune ull -rc cbr -b:v {bitrate} -maxrate {bitrate} -bufsize {bitrate} "
            "-g 25 -bf 0 -profile:v main "
            f"-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:{self.rtsp_port}/$MTX_PATH"
        )

    def _ensure_scaled(self, src: Path) -> Path:
        """1280-wide, 1 s-GOP, B-frame-free H.264 copy of a video file (cached; made once)."""
        max_w = int(self.cfg.get("file_scaled_width", 1280))
        st = src.stat()
        slug = re.sub(r"[^a-z0-9]+", "-", src.stem.lower()).strip("-")[:48]
        out = BACKEND / "data" / "file_sources" / f"{slug}-{max_w}w-{st.st_size}.mp4"
        if out.is_file():
            return out
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".part.mp4")
        logger.info("File source: preparing a %dpx H.264 copy of %s (one-time, cached in %s)", max_w, src.name, out.parent)
        cmd = ["nice", "-n", "10", "ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", str(src), "-an",
               "-vf", f"scale={max_w}:-2", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
               "-maxrate", "4M", "-bufsize", "8M", "-g", "25", "-keyint_min", "25", "-sc_threshold", "0", "-bf", "0",
               "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4", str(tmp)]
        try:
            subprocess.run(cmd, check=True, timeout=3600)
        except (OSError, subprocess.SubprocessError) as e:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"could not prepare the scaled copy of {src}: {e}") from e
        tmp.replace(out)
        return out

    def _file_cmd(self, file: str) -> str:
        """ffmpeg job that loops a video file into MediaMTX as a live stream (stream copy, paced to real time)."""
        return ('ffmpeg -hide_banner -nostdin -loglevel error -re -stream_loop -1 '
                f'-i "{file}" -an -c:v copy -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:{self.rtsp_port}/$MTX_PATH')

    def _write_config(self) -> None:
        paths = {}
        for name, p in self.paths.items():
            if "file" in p:
                cmd = self._file_cmd(p["file"])
                if p["on_demand"]:
                    paths[name] = {"runOnDemand": cmd, "runOnDemandRestart": True,
                                   "runOnDemandStartTimeout": "20s", "runOnDemandCloseAfter": "10s"}
                else:
                    paths[name] = {"runOnInit": cmd, "runOnInitRestart": True}
            elif "transcode_of" in p:
                paths[name] = {"runOnDemand": self._transcode_cmd(p["transcode_of"]),
                               "runOnDemandStartTimeout": "20s", "runOnDemandCloseAfter": "10s"}
            else:
                # The upstream source comes from the environment (credentials)
                paths[name] = {"sourceOnDemand": bool(p["on_demand"])}
        conf = {
            "logLevel": "info", "logDestinations": ["stdout"],
            "readTimeout": "10s", "writeTimeout": "10s", "writeQueueSize": 1024,
            "authMethod": "internal",
            "authInternalUsers": [{"user": "any", "pass": "", "ips": ["127.0.0.1", "::1"],
                                   "permissions": [{"action": "publish"}, {"action": "read"},
                                                   {"action": "api"}]}],
            "api": True, "apiAddress": f"127.0.0.1:{self.api_port}",
            "metrics": False, "pprof": False, "playback": False,
            "rtsp": True, "rtspTransports": ["tcp"], "rtspAddress": f"127.0.0.1:{self.rtsp_port}",
            "rtmp": False, "hls": False, "srt": False, "moq": False,
            "webrtc": True, "webrtcAddress": f"127.0.0.1:{self.webrtc_port}",
            "webrtcLocalUDPAddress": f":{self.ice_udp_port}",
            "webrtcIPsFromInterfaces": True,
            "webrtcAdditionalHosts": list(self.cfg.get("webrtc_additional_hosts") or []),
            "pathDefaults": {"rtspTransport": "tcp", "sourceOnDemandStartTimeout": "10s",
                             "sourceOnDemandCloseAfter": "15s"},
            "paths": paths,
        }
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text("# Generated by backend/src/sources/media_server.py — do not edit.\n"
                                    "# Upstream NVR sources are injected through the environment.\n"
                                    + yaml.safe_dump(conf, sort_keys=False))

    def _child_env(self) -> dict:
        keep = ("PATH", "HOME", "LANG", "LC_ALL", "TZ", "LD_LIBRARY_PATH", "CUDA_VISIBLE_DEVICES")
        env = {k: os.environ[k] for k in keep if k in os.environ}
        for name, p in self.paths.items():
            if "transcode_of" in p or "file" in p:
                continue
            nvr = self.nvrs[p["nvr_id"]]
            env[f"MTX_PATHS_{name.upper()}_SOURCE"] = nvr.rtsp_url(p["channel"], p["subtype"])
        return env

    # ── lifecycle ────────────────────────────────────────────────────

    def start(self) -> None:
        if not Path(self.binary).is_file():
            raise FileNotFoundError(f"MediaMTX binary not found ({self.binary}) — run backend/scripts/install_mediamtx.sh")
        self._write_config()
        self._spawn()
        threading.Thread(target=self._supervise, daemon=True, name="mediamtx-supervisor").start()
        threading.Thread(target=self._poll, daemon=True, name="mediamtx-poll").start()
        logger.info("MediaMTX: %d paths (%d always-on NVR pulls), RTSP 127.0.0.1:%d, WebRTC 127.0.0.1:%d / ICE udp:%d%s",
                    len(self.paths), sum(1 for p in self.paths.values() if "transcode_of" not in p and not p["on_demand"]),
                    self.rtsp_port, self.webrtc_port, self.ice_udp_port,
                    ", H.264 NVENC fallback on demand" if self.transcode == "h264_nvenc" else "")

    def _spawn(self) -> None:
        self._proc = subprocess.Popen(
            [self.binary, str(self.config_path)], env=self._child_env(),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
            preexec_fn=lambda: die_with_parent(signal.SIGTERM),
        )
        self.started_at = time.time()
        threading.Thread(target=self._read_log, args=(self._proc,), daemon=True, name="mediamtx-log").start()

    def stop(self) -> None:
        self._stop.set()
        p = self._proc
        if p is not None and p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()

    def _supervise(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            p = self._proc
            if p is not None and p.poll() is None:
                time.sleep(1.0)
                if time.time() - (self.started_at or 0) > 30:
                    backoff = 1.0
                continue
            if self._stop.is_set():
                return
            self.restarts += 1
            logger.error("MediaMTX exited (code %s)%s — restarting in %.0fs", p.returncode if p else None,
                         f": {self.last_error}" if self.last_error else "", backoff)
            with self._lock:
                for s in self._stats.values():
                    s["ready"] = False
            time.sleep(backoff)
            backoff = min(backoff * 2, 15.0)
            try:
                self._spawn()
            except OSError as e:
                logger.error("MediaMTX restart failed: %s", e)

    # ── observability ────────────────────────────────────────────────

    def _read_log(self, proc: subprocess.Popen) -> None:
        for raw in proc.stdout:
            line = redact(raw.rstrip())
            m = _LOG_RE.match(line)
            if not m:
                if line.startswith("ERR"):
                    self.last_error = line[4:]
                    logger.error("MediaMTX: %s", line)
                elif line:
                    # Output of an on-demand command (H.264 transcoder), throttled
                    key = ("cmd", re.sub(r"\d+", "#", line)[:120])
                    now = time.monotonic()
                    if now - self._last_log.get(key, 0) > 60:
                        self._last_log[key] = now
                        logger.warning("MediaMTX command: %s", line[:300])
                continue
            level, path, msg = m.groups()
            if path in self.paths:
                self._on_path_log(path, level, msg)
            if level == "ERR" and not path:
                self.last_error = msg
            if level in ("WAR", "ERR"):
                # A dead channel repeats the same error every retry: log it once a minute
                key = (path, _STATUS_RE.sub("", re.sub(r"\d+", "#", msg)))
                now = time.monotonic()
                if now - self._last_log.get(key, 0) > 60:
                    self._last_log[key] = now
                    logger.log(logging.WARNING if level == "WAR" else logging.ERROR,
                               "MediaMTX%s %s", f" [{path}]" if path else "", msg)

    def _on_path_log(self, path: str, level: str, msg: str) -> None:
        with self._lock:
            s = self._stats.setdefault(path, {})
            if "[RTSP source]" in msg and level == "ERR":
                err = msg.split("[RTSP source]", 1)[1].strip()
                s["source_error"] = err
                s["source_error_at"] = time.time()
                code = _STATUS_RE.search(err)
                s["permanent_error"] = PERMANENT_STATUS.get(int(code.group(1))) if code else None
            elif "stream is available and online" in msg:
                s["upstream_connects"] = s.get("upstream_connects", 0) + 1
                s["source_error"] = s["permanent_error"] = None
                s["online_since"] = time.time()
            elif "[RTSP source] stopped" in msg or "[RTSP source] ERR" in msg:
                s["online_since"] = None
            m = _LOST_RE.search(msg)
            if m:
                s["rtp_lost"] = s.get("rtp_lost", 0) + int(m.group(1))
            m = _PROC_ERR_RE.search(msg)
            if m:
                s["processing_errors"] = s.get("processing_errors", 0) + int(m.group(1))

    def _poll(self) -> None:
        while not self._stop.is_set():
            time.sleep(2.0)
            try:
                with urllib.request.urlopen(f"{self.api_url()}/v3/paths/list?itemsPerPage=1000", timeout=2) as r:
                    items = json.load(r).get("items") or []
            except (OSError, ValueError):
                continue
            now = time.monotonic()
            seen = set()
            with self._lock:
                for it in items:
                    name = it.get("name")
                    if name not in self.paths:
                        continue
                    seen.add(name)
                    s = self._stats.setdefault(name, {})
                    video = next((t for t in it.get("tracks2") or [] if t.get("codec") in ("H264", "H265", "AV1", "VP9")), None)
                    props = (video or {}).get("codecProps") or {}
                    b = int(it.get("inboundBytes", it.get("bytesReceived", 0)) or 0)
                    prev = self._prev_bytes.get(name)
                    if prev and now > prev[1] and b >= prev[0]:
                        s["bitrate_kbps"] = round((b - prev[0]) * 8 / 1000 / (now - prev[1]), 1)
                    self._prev_bytes[name] = (b, now)
                    if it.get("ready"):
                        s["ready_at"] = time.time()
                    s.update({
                        "ready": bool(it.get("ready")), "codec": (video or {}).get("codec"),
                        "width": props.get("width"), "height": props.get("height"),
                        "readers": len(it.get("readers") or []), "inbound_bytes": b,
                        "reader_types": [r.get("type") for r in it.get("readers") or []],
                        "frames_in_error": it.get("inboundFramesInError"),
                    })
                    if not s["ready"]:
                        s["bitrate_kbps"] = 0.0
                for name in self.paths:
                    if name not in seen:
                        self._stats.setdefault(name, {})["ready"] = False

    def path_status(self, path: str) -> dict:
        with self._lock:
            return dict(self._stats.get(path) or {})

    def health(self) -> dict:
        p = self._proc
        return {"running": p is not None and p.poll() is None, "restarts": self.restarts,
                "uptime_s": round(time.time() - self.started_at, 1) if self.started_at else None,
                "last_error": self.last_error, "transcode": self.transcode,
                "paths": {n: {**self.path_status(n), **{k: v for k, v in meta.items() if k not in ("transcode_of", "file")}}
                          for n, meta in self.paths.items()}}

    # ── WebRTC signalling (WHEP), proxied by the backend API ─────────

    def whep_offer(self, path: str, sdp: str) -> tuple:
        """Forward a WHEP offer; returns (status, answer_sdp, session_id)."""
        req = urllib.request.Request(f"http://127.0.0.1:{self.webrtc_port}/{path}/whep", data=sdp.encode(),
                                     method="POST", headers={"Content-Type": "application/sdp"})
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                loc = r.headers.get("Location") or ""
                return r.status, r.read().decode(), loc.rstrip("/").rsplit("/", 1)[-1] or None
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(errors="replace")[:300], None
        except OSError as e:
            return 502, f"media server unreachable: {e}", None

    def whep_delete(self, path: str, session: str) -> int:
        if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", session or ""):
            return 400
        req = urllib.request.Request(f"http://127.0.0.1:{self.webrtc_port}/{path}/whep/{session}", method="DELETE")
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code
        except OSError:
            return 502
