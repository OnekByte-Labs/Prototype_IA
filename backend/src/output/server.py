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
    """Thread-safe store for the latest annotated metadata per stream."""
    def __init__(self):
        self._frames: Dict[str, dict] = {}
        self._lock = threading.Lock()

    def put(self, stream_id: str, data: dict):
        with self._lock:
            self._frames[stream_id] = data

    def get(self, stream_id: str) -> Optional[dict]:
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
        self._enabled = {cfg["id"]: True for cfg in initial_configs}
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
    mode: str = "mock"
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

    from fastapi import Request

    @app.get("/cameras")
    def get_cameras(request: Request):
        host = request.client.host if request.client else "127.0.0.1"
        # We need the base URL that the client requested
        base_url = str(request.base_url).rstrip('/')
        result = []
        for cfg in stream_configs:
            sid = cfg["id"]
            cam_data = {
                "id": sid.upper().replace("CAM_", "CAM-"),
                "label": cfg.get("label", sid),
                "online": True,
                "aiEnabled": ai_config.is_enabled(sid),
            }
            if mode == "live":
                cam_data["mjpegUrl"] = f"{base_url}/stream/{sid}"
                cam_data["metadataUrl"] = f"{base_url}/metadata/{sid}"
            else:
                cam_data["metadataUrl"] = f"{base_url}/metadata/{sid}"
                cam_data["videoUrl"] = f"/api/videos/{sid}"
            result.append(cam_data)
        return result

    @app.get("/stream/{stream_id}")
    def stream_video(stream_id: str):
        def generate():
            import time
            while True:
                data = frame_store.get(stream_id)
                if data and "jpeg" in data:
                    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + data["jpeg"] + b"\r\n"
                time.sleep(0.033) # ~30fps poll rate
        return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

    @app.post("/cameras/{stream_id}/ai")
    def toggle_ai(stream_id: str, req: AIToggleRequest):
        internal_id = stream_id.lower().replace("cam-", "cam_")
        ai_config.set_enabled(internal_id, req.enabled)
        return {"success": True, "aiEnabled": ai_config.is_enabled(internal_id)}

    @app.get("/metadata/{stream_id}")
    async def stream_metadata(stream_id: str):
        internal_id = stream_id.lower().replace("cam-", "cam_")
        import os
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        precomputed_path = os.path.join(base_dir, "backend", "outputs", "precomputed", f"{internal_id}.json")

        async def generate():
            if os.path.exists(precomputed_path):
                import json
                import time
                with open(precomputed_path, "r", encoding="utf-8") as f:
                    all_frames = json.load(f)
                
                if not all_frames:
                    return
                
                # Loop forever at exactly 30 FPS
                while True:
                    for frame_data in all_frames:
                        if not ai_config.is_enabled(stream_id):
                            # AI disabled mock data
                            yield f"data: {json.dumps({'frame_id': frame_data['frame_id'], 'video_time_sec': frame_data['video_time_sec'], 'detections': []})}\n\n"
                        else:
                            yield f"data: {json.dumps(frame_data)}\n\n"
                        await asyncio.sleep(1 / 30.0)
            else:
                last_frame_id = None
                while True:
                    metadata = frame_store.get(stream_id)
                    if metadata is not None and isinstance(metadata, dict):
                        if metadata.get("frame_id") != last_frame_id:
                            import json
                            # Send as Server-Sent Event (SSE)
                            yield f"data: {json.dumps(metadata)}\n\n"
                            last_frame_id = metadata["frame_id"]
                    
                    # Check 100 times a second for new metadata
                    await asyncio.sleep(0.01)

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
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
    mode: str = "mock",
):
    """Start the FastAPI output server in a daemon thread via Uvicorn."""
    app = create_app(frame_store, event_store, ai_config, stream_configs, mode=mode)
    
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
