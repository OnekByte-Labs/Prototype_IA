"""
Per-camera Detection Pipeline Manager (runs inside each inference worker).

    live source ──fan-out──▶ camera queue (2, stale dropped) ──▶ camera thread ──▶ active pipeline
    (NVDEC, on demand)                                                  │            (one per camera)
                                                                        └──▶ metadata (+ tile JPEG
                                                                             while watched) ──▶ main

Sources are decoded ON DEMAND: a source runs only while one of its cameras
has an active detection pipeline or an MJPEG / zone-editor viewer, and is
stopped (decoder process killed, CUDA context released) after
``idle_stop_after_s`` without demand. Browsers normally play the live stream
over WebRTC straight from the media server, which needs no decoding here.

Guarantees
  * exactly ONE pipeline per camera; switches are serialized per camera;
  * a switch detaches the old pipeline under the camera lock (so it can't
    process or emit again), stops it (models released via the refcounted
    registry, tracker dropped), and only then starts the new one;
  * while a camera switches, its video keeps flowing as raw frames and no
    events are produced; other cameras are unaffected;
  * events are emitted while holding the camera lock, stamped with the
    pipeline's mode and generation, so a stopped pipeline can never emit.

State per camera: idle (mode none) · starting · running · stopping · error.
"""

import logging
import queue
import threading
import time
import traceback
from typing import Callable, Dict, List, Optional

import cv2

from src.annotator import draw_counting_line, draw_detections, draw_restricted_zone

from . import PIPELINE_CLASSES
from .base import ALERT_EVENT_TYPES
from .registry import ModelRegistry

logger = logging.getLogger("pipelines.manager")

EVIDENCE_MAX_WIDTH = 960          # annotated alert evidence frames
JPEG_PARAMS = [int(cv2.IMWRITE_JPEG_QUALITY), 80]
MAX_CONSECUTIVE_FAILURES = 25


class _SourceSink:
    """Frame sink of one source: fans out to the cameras bound to it."""
    __slots__ = ("manager", "source_id")

    def __init__(self, manager, source_id: str):
        self.manager, self.source_id = manager, source_id

    def put(self, packet, timeout=None):
        self.manager.on_frame(self.source_id, packet)


class CameraRuntime:
    def __init__(self, camera_id: str, key: str, source_id: str, geometry: dict):
        self.camera_id = camera_id      # "CAM-07"
        self.key = key                  # "cam_07" (frame-store / stream key)
        self.source_id = source_id
        self.geometry = dict(geometry or {})
        self.mode = "none"
        self.state = "idle"
        self.error: Optional[str] = None
        self.generation = 0
        self.pipeline = None
        self.lock = threading.Lock()            # pipeline swap vs frame processing
        self.switch_lock = threading.Lock()     # one switch at a time per camera
        self.frames = queue.Queue(maxsize=2)
        self.failures = 0
        self.state_since = time.time()
        # Frame decoded → result published (inference + annotation), EMA in ms
        self.latency_ms: Optional[float] = None
        # MJPEG demand (set by the main process): frames are only resized +
        # JPEG-encoded while someone watches the camera's MJPEG / zone editor
        self.want_jpeg = False
        self.want_clean = False
        self.last_jpeg_at = 0.0
        # Stage timings (EMA, ms): decoded → picked up by the camera thread
        self.queue_ms: Optional[float] = None


class PipelineManager:
    def __init__(self, emit: Callable, config: dict, source_factory: Optional[Callable] = None):
        self.emit = emit
        self.config = config
        self.registry = ModelRegistry()
        self.cameras: Dict[str, CameraRuntime] = {}
        self.by_source: Dict[str, List[CameraRuntime]] = {}
        self._stop = threading.Event()
        self._threads: List[threading.Thread] = []
        # On-demand sources: source_id → {spec, reader, idle_since, starts}
        self.source_factory = source_factory
        self.sources: Dict[str, dict] = {}
        self._src_lock = threading.Lock()
        self.idle_stop_after_s = float(config.get("idle_stop_after_s", 10.0))
        self.mjpeg_max_width = int(config.get("mjpeg_max_width", 640))
        self.mjpeg_fps = float(config.get("mjpeg_fps", 12.5))
        self.mjpeg_params = [int(cv2.IMWRITE_JPEG_QUALITY), int(config.get("mjpeg_quality", 75))]

    # ── setup ─────────────────────────────────────────────────────────

    def add_camera(self, camera_id: str, key: str, source_id: str, geometry: dict) -> None:
        rt = CameraRuntime(camera_id, key, source_id, geometry)
        self.cameras[key] = rt
        self.by_source.setdefault(source_id, []).append(rt)
        t = threading.Thread(target=self._camera_loop, args=(rt,), daemon=True, name=f"cam-{key}")
        t.start()
        self._threads.append(t)

    # ── on-demand sources ─────────────────────────────────────────────

    def add_source(self, spec: dict) -> None:
        self.sources[spec["id"]] = {"spec": spec, "reader": None, "idle_since": None, "starts": 0,
                                    "last_health": None}

    def start_source_supervisor(self) -> None:
        t = threading.Thread(target=self._source_loop, daemon=True, name="source-supervisor")
        t.start()
        self._threads.append(t)

    def _demand(self, sid: str) -> Optional[str]:
        """Why a source must be decoded (None = it need not)."""
        for rt in self.by_source.get(sid, ()):
            if rt.mode != "none":
                return f"{rt.camera_id} {rt.mode}"
            if rt.want_jpeg or rt.want_clean:
                return f"{rt.camera_id} viewer"
        return None

    def reconcile_sources(self) -> None:
        """Start sources that are needed; stop those idle for idle_stop_after_s."""
        now = time.monotonic()
        with self._src_lock:
            for sid, s in self.sources.items():
                reason = self._demand(sid)
                r = s["reader"]
                if reason:
                    s["idle_since"] = None
                    if r is None or not r.is_alive():
                        spec = s["spec"]
                        s["reader"] = r = self.source_factory(spec, _SourceSink(self, sid), float(spec.get("process_fps", 12.5)))
                        s["starts"] += 1
                        r.start()
                        logger.info("[%s] decode started (%s)", sid, reason)
                elif r is not None:
                    if s["idle_since"] is None:
                        s["idle_since"] = now
                    elif now - s["idle_since"] >= self.idle_stop_after_s:
                        s["last_health"] = r.health()
                        r.stop()
                        s["reader"] = None
                        s["idle_since"] = None
                        logger.info("[%s] decode stopped (no pipeline or viewer for %.0fs)", sid, self.idle_stop_after_s)

    def _source_loop(self) -> None:
        while not self._stop.wait(1.0):
            try:
                self.reconcile_sources()
            except Exception:
                logger.exception("source reconcile failed")

    def sources_health(self) -> dict:
        out = {}
        with self._src_lock:
            items = list(self.sources.items())
        for sid, s in items:
            r = s["reader"]
            if r is not None:
                out[sid] = {**r.health(), "decoding": True, "decode_starts": s["starts"]}
            else:
                last = s["last_health"] or {}
                out[sid] = {"source_type": s["spec"].get("type", "rtsp"), "state": "IDLE", "decoding": False,
                            "decode_starts": s["starts"], "path": s["spec"].get("path"),
                            **{k: last.get(k) for k in ("codec", "width", "height", "frames", "reconnects")}}
        return out

    def on_frame(self, source_id: str, packet) -> None:
        """Fan a decoded frame out to every camera on this source (non-blocking;
        a slow camera drops its own stale frames, never delays others)."""
        for rt in self.by_source.get(source_id, ()):
            try:
                rt.frames.put_nowait(packet)
            except queue.Full:
                try:
                    rt.frames.get_nowait()
                except queue.Empty:
                    pass
                try:
                    rt.frames.put_nowait(packet)
                except queue.Full:
                    pass

    # ── lifecycle API ─────────────────────────────────────────────────

    def switch_mode(self, key: str, mode: str, request_id: Optional[str] = None, force: bool = False) -> None:
        """Asynchronously switch a camera to ``mode`` (returns immediately)."""
        rt = self.cameras.get(key)
        if rt is None:
            logger.warning("switch_mode: unknown camera %s", key)
            return
        threading.Thread(
            target=self._switch, args=(rt, mode, request_id, force), daemon=True, name=f"switch-{key}",
        ).start()

    def restart(self, key: str) -> None:
        rt = self.cameras.get(key)
        if rt:
            self.switch_mode(key, rt.mode, force=True)

    def update_config(self, detection: dict, restart_modes) -> list:
        """New detection thresholds (admin config version). Pipelines read them
        at start, so cameras running an affected mode are restarted."""
        self.config.update(detection)
        restarted = []
        for key, rt in self.cameras.items():
            if rt.mode in restart_modes and rt.state in ("running", "error"):
                self.switch_mode(key, rt.mode, force=True)
                restarted.append(rt.camera_id)
        return restarted

    def update_geometry(self, key: str, geometry: dict) -> None:
        rt = self.cameras.get(key)
        if rt is None:
            return
        with rt.lock:
            rt.geometry = dict(geometry or {})
            if rt.pipeline is not None:
                rt.pipeline.update_geometry(rt.geometry)
        logger.info("[%s] geometry replaced: %s", rt.camera_id, sorted(k for k, v in rt.geometry.items() if v))

    def set_viewers(self, key: str, want: dict) -> None:
        rt = self.cameras.get(key)
        if rt is not None:
            rt.want_jpeg, rt.want_clean = bool(want.get("jpeg")), bool(want.get("clean"))
            logger.info("[%s] MJPEG %s", rt.camera_id, "on" if rt.want_jpeg else "off (no viewers)")
            self.reconcile_sources()

    def health(self) -> dict:
        out = {}
        for key, rt in self.cameras.items():
            p = rt.pipeline
            out[key] = {
                "camera_id": rt.camera_id, "mode": rt.mode, "state": rt.state, "error": rt.error,
                "generation": rt.generation, "source_id": rt.source_id,
                "latency_ms": round(rt.latency_ms, 1) if rt.latency_ms is not None else None,
                "queue_ms": round(rt.queue_ms, 1) if rt.queue_ms is not None else None,
                "mjpeg": rt.want_jpeg, "pipeline": p.health() if p is not None else None,
            }
        return {"cameras": out, "models": self.registry.snapshot(), "model_providers": self.registry.providers(),
                "config_version": self.config.get("_config_version"), "sources": self.sources_health()}

    def stop_all(self) -> None:
        self._stop.set()
        with self._src_lock:
            for s in self.sources.values():
                if s["reader"] is not None:
                    s["reader"].stop()
                    s["reader"] = None
        for rt in self.cameras.values():
            with rt.switch_lock:
                with rt.lock:
                    old, rt.pipeline = rt.pipeline, None
                if old is not None:
                    try:
                        old.stop()
                    except Exception:
                        logger.exception("[%s] stop failed", rt.camera_id)

    # ── internals ─────────────────────────────────────────────────────

    def _set_state(self, rt: CameraRuntime, state: str, error: Optional[str] = None,
                   request_id: Optional[str] = None) -> None:
        rt.state, rt.error, rt.state_since = state, error, time.time()
        self.emit("state", {
            "camera_key": rt.key, "camera_id": rt.camera_id, "mode": rt.mode, "state": state,
            "error": error, "generation": rt.generation, "request_id": request_id, "ts": rt.state_since,
        })

    def _switch(self, rt: CameraRuntime, mode: str, request_id: Optional[str], force: bool) -> None:
        with rt.switch_lock:
            if not force and mode == rt.mode and rt.state in ("running", "idle"):
                self._set_state(rt, rt.state, request_id=request_id)   # idempotent ack
                return
            t0 = time.monotonic()
            # 1. Detach + stop the previous pipeline
            if rt.pipeline is not None:
                self._set_state(rt, "stopping", request_id=request_id)
                with rt.lock:                    # waits for an in-flight frame
                    old, rt.pipeline = rt.pipeline, None
                    rt.generation += 1
                try:
                    old.stop()
                except Exception:
                    logger.exception("[%s] error stopping %s pipeline", rt.camera_id, rt.mode)
                del old
            rt.mode = mode
            rt.failures = 0
            if self.source_factory is not None:
                self.reconcile_sources()
            if mode == "none":
                with rt.lock:
                    rt.generation += 1
                self._set_state(rt, "idle", request_id=request_id)
                logger.info("[%s] detection off (%.2fs)", rt.camera_id, time.monotonic() - t0)
                return
            # 2. Start the new pipeline (models load while video keeps flowing)
            self._set_state(rt, "starting", request_id=request_id)
            pipeline = PIPELINE_CLASSES[mode](rt.camera_id, rt.geometry, self.registry, self.config)
            try:
                pipeline.start()
            except Exception as e:
                logger.error("[%s] %s pipeline failed to start: %s", rt.camera_id, mode, e)
                logger.debug(traceback.format_exc())
                self._set_state(rt, "error", error=f"{mode} failed to start: {e}", request_id=request_id)
                return
            # 3. Attach it to the camera stream
            with rt.lock:
                rt.generation += 1
                rt.pipeline = pipeline
            self._set_state(rt, "running", request_id=request_id)
            logger.info("[%s] %s running (switch took %.2fs; models: %s)", rt.camera_id, mode,
                        time.monotonic() - t0, ", ".join(pipeline.model_names))

    @staticmethod
    def _scaled(packet, width: int, key: str):
        """BGR frame no wider than ``width`` (shared by every camera on the source)."""
        disp = packet.cache.get(key)
        if disp is None:
            frame = packet.frame
            s = 1.0
            if frame.shape[1] > width:
                s = width / frame.shape[1]
                frame = cv2.resize(frame, (width, round(frame.shape[0] * s)), interpolation=cv2.INTER_AREA)
            disp = packet.cache.setdefault(key, (frame, s))
        return disp

    def _display(self, packet):
        """Evidence-resolution frame (annotated alert snapshots)."""
        return self._scaled(packet, EVIDENCE_MAX_WIDTH, "display")

    def _tile_jpeg(self, packet) -> bytes:
        """Raw live frame at tile size for MJPEG viewers and the zone editor
        (detections are drawn by the browser from the metadata stream)."""
        jpeg = packet.cache.get("tile_jpeg")
        if jpeg is None:
            frame, _ = self._scaled(packet, self.mjpeg_max_width, "tile")
            jpeg = packet.cache.setdefault("tile_jpeg", cv2.imencode(".jpg", frame, self.mjpeg_params)[1].tobytes())
        return jpeg

    def _camera_loop(self, rt: CameraRuntime) -> None:
        while not self._stop.is_set():
            try:
                packet = rt.frames.get(timeout=0.2)
            except queue.Empty:
                continue
            out = None
            annotated = None
            mode, state, gen = rt.mode, rt.state, rt.generation
            wait = (time.time() - packet.timestamp) * 1000
            rt.queue_ms = wait if rt.queue_ms is None else rt.queue_ms * 0.9 + wait * 0.1
            try:
                with rt.lock:
                    p = rt.pipeline
                    if p is not None:
                        out = p.process(packet.frame, packet)
                        mode, gen = p.mode, rt.generation
                        # Alert evidence: the annotated frame that produced the
                        # alert (zone + red box), rendered once and reused below
                        # for the live stream.
                        if any(ev["event_type"] in ALERT_EVENT_TYPES for ev in out.events):
                            annotated = self._render(packet, out)
                        # Emit while the lock is held: once a switch detaches
                        # this pipeline, nothing it produced can follow.
                        for ev in out.events:
                            ev["generation"] = gen
                            ev["frame_id"] = packet.frame_id
                            ev["decoded_at"] = packet.timestamp       # end-to-end alert latency
                            if annotated and ev["event_type"] in ALERT_EVENT_TYPES:
                                jpeg, w, h = annotated
                                ev["_snapshot"] = {"jpeg": jpeg, "width": w, "height": h}
                            self.emit("event", ev)
                rt.failures = 0
            except Exception as e:
                rt.failures += 1
                logger.exception("[%s] %s pipeline frame failed", rt.camera_id, rt.mode)
                if rt.failures >= MAX_CONSECUTIVE_FAILURES and rt.state == "running":
                    with rt.lock:
                        broken, rt.pipeline = rt.pipeline, None
                        rt.generation += 1
                    if broken is not None:
                        broken.stop()
                    self._set_state(rt, "error", error=f"{rt.mode} pipeline crashed: {e}")
                out = None

            try:
                self._publish(rt, packet, out, mode, state if out is None else "running")
            except Exception:
                logger.exception("[%s] publish failed", rt.camera_id)

    def _render(self, packet, out):
        """Annotated display frame for a pipeline output → (jpeg, width, height)."""
        frame, s = self._display(packet)
        canvas = frame.copy()
        scale = s / packet.coord_scale
        if out.zone:
            draw_restricted_zone(canvas, out.zone, scale, occupied=out.zone_active)
        if out.line:
            a = out.analytics
            draw_counting_line(canvas, out.line, scale,
                               label=f"IN {a.get('in', 0)}  OUT {a.get('out', 0)}  TOTAL {a.get('total', 0)}")
        if out.tracks:
            draw_detections(canvas, out.tracks, out.class_names, out.labels, None,
                            scale=scale, alert_ids=out.alert_ids)
        jpeg = cv2.imencode(".jpg", canvas, JPEG_PARAMS)[1].tobytes()
        return jpeg, canvas.shape[1], canvas.shape[0]

    def _publish(self, rt: CameraRuntime, packet, out, mode: str, state: str) -> None:
        metadata = {
            "frame_id": packet.frame_id,
            "video_time_sec": packet.video_time_sec,
            "timestamp": packet.timestamp,
            "camera_id": rt.camera_id,
            "detection_mode": rt.mode,
            "pipeline_state": rt.state,
            "detections": [],
            "events": [],
            "analytics": {},
        }
        # Tile JPEG only while watched, at most mjpeg_fps (surplus frames skipped)
        jpeg = None
        if (rt.want_jpeg or rt.want_clean) and time.monotonic() - rt.last_jpeg_at >= 0.9 / self.mjpeg_fps:
            jpeg = self._tile_jpeg(packet)
            rt.last_jpeg_at = time.monotonic()
        metadata["decoded_at"] = packet.timestamp
        if out is not None:
            metadata["detections"] = [{
                "id": int(t.track_id),
                "class": str(out.class_names.get(int(t.class_id), t.class_id)),
                "confidence": round(float(t.confidence), 3),
                "x": int(t.bbox[0]), "y": int(t.bbox[1]),
                "w": int(t.bbox[2] - t.bbox[0]), "h": int(t.bbox[3] - t.bbox[1]),
                **({"plate": out.labels[int(t.track_id)]} if int(t.track_id) in out.labels else {}),
            } for t in out.tracks]
            metadata["analytics"] = out.analytics
            metadata["events"] = [e["event_type"] for e in out.events]
            # Geometry + alert state for browser-side overlays on the WebRTC video
            metadata["zone"] = out.zone
            metadata["zone_active"] = out.zone_active
            metadata["line"] = out.line
            metadata["alert_ids"] = sorted(int(i) for i in out.alert_ids)
        if jpeg is not None:
            # The tile frame is unannotated, so the zone editor uses the same bytes
            metadata["jpeg"] = jpeg
            if rt.want_clean:
                metadata["jpeg_clean"] = jpeg
        self.emit("frame", rt.key, metadata)
        ms = (time.time() - packet.timestamp) * 1000
        rt.latency_ms = ms if rt.latency_ms is None else rt.latency_ms * 0.9 + ms * 0.1
