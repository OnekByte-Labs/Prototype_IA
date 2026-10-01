"""
Output server (FastAPI) of the live command center.

  GET  /cameras                 every command-center camera (from the database + runtime)
  GET  /stream/{camera}         MJPEG of the camera's live frames (browsers without WebRTC
                                support for the stream's codec); ?clean=1 for the zone editor
  GET  /metadata/{camera}       Server-Sent Events: per-frame detections / zone / line / analytics
  POST /cameras/{camera}/zone   restricted zone / counting line (database, applied immediately)
  GET  /events, /alerts         recent events / alert feed
  + /api/v1/* (control_api, admin, map, situation_api), /api/agent/* (Argus Agent)

Streaming is event-driven: MJPEG and SSE responses are async generators woken
by each new frame of their camera (``FrameStore.wait``) — no polling loops and
no threadpool thread per viewer, so many open tiles never starve the API.
"""

import asyncio
import json
import logging
import threading
import time
from typing import Dict, List, Optional, Set

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class FrameStore:
    """Latest per-frame result of each camera (metadata + optional JPEG) with
    change notification for async consumers."""

    def __init__(self):
        self._frames: Dict[str, dict] = {}
        self._ts: Dict[str, float] = {}
        self._interval: Dict[str, float] = {}     # EMA of seconds between frames
        self._lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._waiters: Dict[str, Set[asyncio.Event]] = {}

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def put(self, stream_id: str, data: dict):
        now = time.monotonic()
        with self._lock:
            self._frames[stream_id] = data
            prev = self._ts.get(stream_id)
            if prev is not None:
                dt = now - prev
                ema = self._interval.get(stream_id)
                self._interval[stream_id] = dt if ema is None else 0.9 * ema + 0.1 * dt
            self._ts[stream_id] = now
            notify = bool(self._waiters.get(stream_id))
        if notify and self._loop is not None:
            self._loop.call_soon_threadsafe(self._wake, stream_id)

    def _wake(self, stream_id: str) -> None:           # event-loop thread
        for ev in list(self._waiters.get(stream_id, ())):
            ev.set()

    async def wait(self, stream_id: str, timeout: float) -> None:
        """Until the camera's next frame (or ``timeout``)."""
        ev = asyncio.Event()
        with self._lock:
            self._waiters.setdefault(stream_id, set()).add(ev)
        try:
            await asyncio.wait_for(ev.wait(), timeout)
        except asyncio.TimeoutError:
            pass
        finally:
            with self._lock:
                s = self._waiters.get(stream_id)
                if s is not None:
                    s.discard(ev)
                    if not s:
                        del self._waiters[stream_id]

    def rate(self, stream_id: str) -> float:
        """Measured frames/s delivered for the stream (0 if none yet)."""
        with self._lock:
            ema = self._interval.get(stream_id)
        return 1.0 / ema if ema else 0.0

    def age(self, stream_id: str) -> Optional[float]:
        """Seconds since the stream's last frame (None if it never produced one)."""
        with self._lock:
            ts = self._ts.get(stream_id)
        return None if ts is None else time.monotonic() - ts

    def get(self, stream_id: str) -> Optional[dict]:
        with self._lock:
            return self._frames.get(stream_id)


class EventStore:
    """Thread-safe ring-buffer for recent events."""
    def __init__(self, max_events: int = 500):
        self._events = []
        self._lock = threading.Lock()
        self._max = max_events

    def add(self, event: dict):
        with self._lock:
            self._events.append(event)
            if len(self._events) > self._max:
                self._events = self._events[-self._max:]

    def get_recent(self, n: int = 50):
        with self._lock:
            return list(self._events[-n:])


class AlertStore:
    """Thread-safe ring buffer of operator alerts with a monotonic sequence.

    Clients poll ``/alerts?after=<seq>`` and only receive alerts newer than
    the last one they saw.
    """
    def __init__(self, max_alerts: int = 500):
        self._alerts: List[dict] = []
        self._seq = 0
        self._lock = threading.Lock()
        self._max = max_alerts

    def add(self, alert: dict) -> dict:
        with self._lock:
            self._seq += 1
            alert = {**alert, "seq": self._seq}
            self._alerts.append(alert)
            if len(self._alerts) > self._max:
                self._alerts = self._alerts[-self._max:]
            return alert

    def get_after(self, after: int, limit: int = 50) -> dict:
        with self._lock:
            newer = [a for a in self._alerts if a["seq"] > after]
            return {"seq": self._seq, "alerts": newer[-limit:]}


class ZoneUpdateRequest(BaseModel):
    type: Optional[str] = None
    zone: Optional[List[List[float]]] = None
    line: Optional[List[List[float]]] = None
    buffer_px: Optional[int] = None
    required_consecutive_frames: Optional[int] = None


class OpenStreams:
    """Open MJPEG / SSE responses (diagnostics)."""
    def __init__(self):
        self.mjpeg = 0
        self.sse = 0


def create_app(frame_store: FrameStore, event_store: EventStore, alert_store: AlertStore, runtime,
               map_service=None, admin=None) -> FastAPI:
    app = FastAPI(title="ISCC live backend")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
    open_streams = OpenStreams()
    runtime.open_streams = open_streams

    from src.output.control_api import build_router
    app.include_router(build_router(runtime))

    @app.on_event("startup")
    async def _attach_loop():
        loop = asyncio.get_running_loop()
        runtime.ws.attach(loop)
        frame_store.attach_loop(loop)

    admin = admin or getattr(runtime, "admin", None)
    if admin is not None:
        from src.admin.api import build_admin_router
        app.include_router(build_admin_router(admin))

    if map_service is not None:
        from src.output.map_api import build_map_router
        app.include_router(build_map_router(map_service, admin=admin))

    situation = getattr(runtime, "situation", None)
    if situation is not None:
        from src.output.situation_api import build_situation_router
        app.include_router(build_situation_router(situation, admin=admin))
    agent = getattr(runtime, "agent", None)
    if agent is not None:
        from src.agent.api import build_agent_router
        app.include_router(build_agent_router(agent, admin=admin))

    @app.get("/cameras")
    def get_cameras(request: Request):
        return runtime.describe_cameras(str(request.base_url).rstrip("/"))

    def key_of(camera: str) -> str:
        try:
            return runtime.get(camera)["key"]
        except (KeyError, ValueError):
            raise HTTPException(404, f"Unknown camera {camera}")

    @app.get("/stream/{camera}")
    async def stream_video(camera: str, clean: bool = False):
        """MJPEG of the camera's live frames. The worker decodes and encodes a
        camera only while it has at least one MJPEG viewer (or a pipeline)."""
        key = key_of(camera)

        async def generate():
            runtime.add_viewer(key, clean, +1)
            open_streams.mjpeg += 1
            last = None
            try:
                while True:
                    data = frame_store.get(key)
                    jpeg = data and ((clean and data.get("jpeg_clean")) or data.get("jpeg"))
                    if jpeg and jpeg is not last:      # only new frames are sent
                        last = jpeg
                        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
                    await frame_store.wait(key, 2.0)
            finally:
                open_streams.mjpeg -= 1
                runtime.add_viewer(key, clean, -1)

        return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame",
                                 headers={"Cache-Control": "no-store"})

    @app.get("/metadata/{camera}")
    async def stream_metadata(camera: str):
        """Per-frame pipeline output (detections, zone, line, analytics) as SSE."""
        key = key_of(camera)

        async def generate():
            open_streams.sse += 1
            last_id = None
            try:
                while True:
                    m = frame_store.get(key)
                    if m is not None and m.get("frame_id") != last_id:
                        last_id = m.get("frame_id")
                        yield "data: " + json.dumps({k: v for k, v in m.items() if k not in ("jpeg", "jpeg_clean")}) + "\n\n"
                    elif m is None:
                        yield ": keepalive\n\n"
                    await frame_store.wait(key, 15.0)
            finally:
                open_streams.sse -= 1

        return StreamingResponse(generate(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                                          "X-Accel-Buffering": "no"})

    @app.post("/cameras/{camera}/ai")
    def toggle_ai(camera: str):
        raise HTTPException(410, "Use PATCH /api/v1/cameras/{camera_id}/detection-mode")

    @app.post("/cameras/{camera}/zone")
    @app.post("/cameras/{camera}/analytics")
    def update_analytics_zone(camera: str, req: ZoneUpdateRequest, request: Request):
        """Per-camera geometry in the database; the camera's pipeline swaps to
        it immediately (the previous zone/line is discarded)."""
        try:
            cam = runtime.get(camera)
        except (KeyError, ValueError):
            raise HTTPException(404, f"Unknown camera {camera}")
        principal_ = before_geom = None
        if runtime.admin is not None:
            from src.admin.api import principal as _principal
            from src.admin.auth import AuthError
            try:
                principal_ = _principal(runtime.admin, request)
                runtime.admin.require_camera(principal_, "detection.manage", cam["camera_id"])
            except AuthError as e:
                raise HTTPException(e.status, str(e))
            before_geom = runtime.db.geometry(cam["camera_id"])
        if req.zone is not None and len(req.zone) < 3:
            raise HTTPException(400, "A zone needs at least 3 points")
        if req.line is not None and len(req.line) < 2:
            raise HTTPException(400, "A counting line needs at least 2 points")
        if req.type == "none":
            geom = runtime.set_geometry(cam["camera_id"], zone=None, line=None)
        else:
            geom = runtime.set_geometry(cam["camera_id"], zone=req.zone if req.zone is not None else ...,
                                        line=req.line if req.line is not None else ...)
        kind = "traffic_count" if req.line is not None or req.type == "traffic_count" else "intrusion_zone"
        if principal_ is not None:
            runtime.admin.audit(principal_, "detection.geometry", f"camera:{cam['camera_id']}",
                                prev={k: before_geom.get(k) for k in ("zone", "line")},
                                new={k: geom.get(k) for k in ("zone", "line")})
        return {"success": True, "analytics": {"type": kind, **geom}}

    @app.get("/events")
    def get_events():
        return event_store.get_recent()

    @app.get("/alerts")
    def get_alerts(after: int = -1):
        # First poll (after < 0) only gets the most recent backlog.
        return alert_store.get_after(max(after, 0), limit=20 if after < 0 else 50)

    return app


def run_server(frame_store: FrameStore, event_store: EventStore, alert_store: AlertStore, runtime,
               host: str = "0.0.0.0", port: int = 5556, map_service=None, admin=None):
    """Start the API server in a daemon thread (uvicorn)."""
    app = create_app(frame_store, event_store, alert_store, runtime, map_service=map_service, admin=admin)
    t = threading.Thread(target=lambda: uvicorn.run(app, host=host, port=port, log_level="error"),
                         daemon=True, name="output-server")
    t.start()
    logger.info("Output server started on http://%s:%d", host, port)
    return t
