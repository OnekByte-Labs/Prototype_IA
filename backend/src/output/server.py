"""
Output server — FastAPI-based MJPEG + REST endpoint.

Serves:
  GET /cameras           → JSON list of stream configs (for the Next.js frontend)
  GET /stream/{stream_id} → MJPEG stream of annotated frames
  GET /events            → latest N events as JSON
"""

import asyncio
import logging
import threading
from typing import Dict, Optional
import cv2
import numpy as np

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

logger = logging.getLogger(__name__)


class FrameStore:
    """Thread-safe store for the latest annotated frame per stream."""
    def __init__(self):
        self._frames: Dict[str, np.ndarray] = {}
        self._lock = threading.Lock()

    def put(self, stream_id: str, frame: np.ndarray):
        with self._lock:
            self._frames[stream_id] = frame

    def get(self, stream_id: str) -> Optional[np.ndarray]:
        with self._lock:
            return self._frames.get(stream_id)

    def get_all_ids(self):
        with self._lock:
            return list(self._frames.keys())


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
                self._events = self._events[-self._max :]

    def get_recent(self, n: int = 50):
        with self._lock:
            return list(self._events[-n:])


class AIConfigStore:
    """Thread-safe store for AI enablement per stream."""
    def __init__(self, initial_configs: list):
        self._enabled = {cfg["id"]: False for cfg in initial_configs}
        if "cam_06" in self._enabled:
            self._enabled["cam_06"] = True
        self._lock = threading.Lock()

    def is_enabled(self, stream_id: str) -> bool:
        with self._lock:
            return self._enabled.get(stream_id, False)

    def set_enabled(self, stream_id: str, enabled: bool):
        with self._lock:
            if stream_id in self._enabled:
                self._enabled[stream_id] = enabled

    def get_all(self):
        with self._lock:
            return self._enabled.copy()


class AIToggleRequest(BaseModel):
    enabled: bool


def create_app(
    frame_store: FrameStore,
    event_store: EventStore,
    ai_config: AIConfigStore,
    stream_configs: list,
) -> FastAPI:
    """Create and configure the FastAPI app."""

    app = FastAPI(title="AI Surveillance Backend")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/cameras")
    def get_cameras():
        result = []
        for cfg in stream_configs:
            sid = cfg["id"]
            result.append(
                {
                    "id": sid.upper().replace("CAM_", "CAM-"),
                    "label": cfg.get("label", sid),
                    "online": True,
                    "mjpegUrl": f"/stream/{sid}",
                    "aiEnabled": ai_config.is_enabled(sid),
                }
            )
        return result

    @app.post("/cameras/{stream_id}/ai")
    def toggle_ai(stream_id: str, req: AIToggleRequest):
        internal_id = stream_id.lower().replace("cam-", "cam_")
        ai_config.set_enabled(internal_id, req.enabled)
        return {"success": True, "aiEnabled": ai_config.is_enabled(internal_id)}

    @app.get("/stream/{stream_id}")
    async def stream_video(stream_id: str):
        async def generate():
            last_frame_id = None
            while True:
                frame = frame_store.get(stream_id)
                if frame is not None:
                    current_frame_id = id(frame)
                    if current_frame_id != last_frame_id:
                        h, w = frame.shape[:2]
                        if w > 800:
                            scale = 800 / w
                            frame = cv2.resize(frame, (800, int(h * scale)))

                        # cv2.imencode releases the GIL, so it's safe in async
                        _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
                        yield (
                            b"--frame\r\n"
                            b"Content-Type: image/jpeg\r\n\r\n"
                            + jpeg.tobytes()
                            + b"\r\n"
                        )
                        last_frame_id = current_frame_id
                
                # Non-blocking sleep for FastAPI async loop
                await asyncio.sleep(0.033)

        return StreamingResponse(
            generate(),
            media_type="multipart/x-mixed-replace; boundary=frame",
        )

    @app.get("/events")
    def get_events():
        return event_store.get_recent()

    return app


def run_server(
    frame_store: FrameStore,
    event_store: EventStore,
    ai_config: AIConfigStore,
    stream_configs: list,
    host: str = "0.0.0.0",
    port: int = 5555,
):
    """Start the FastAPI output server in a daemon thread via Uvicorn."""
    app = create_app(frame_store, event_store, ai_config, stream_configs)
    
    def start_uvicorn():
        uvicorn.run(app, host=host, port=port, log_level="error")
        
    server_thread = threading.Thread(
        target=start_uvicorn,
        daemon=True,
        name="output-server",
    )
    server_thread.start()
    logger.info("Output server started on http://%s:%d", host, port)
    return server_thread
