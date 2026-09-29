"""
Output server — FastAPI-based MJPEG + REST endpoint.

Serves:
  GET /cameras           → JSON list of stream configs (for the Next.js frontend)
  GET /stream/{stream_id} → MJPEG stream of annotated frames
  GET /events            → latest N events as JSON
"""

import asyncio
import logging
import os
import threading
from typing import Dict, Optional, List
import cv2
import numpy as np
import yaml

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
        sid = stream_id.lower().replace("-", "_")
        with self._lock:
            return self._enabled.get(sid, self._enabled.get(stream_id, False))

    def set_enabled(self, stream_id: str, enabled: bool):
        sid = stream_id.lower().replace("-", "_")
        with self._lock:
            self._enabled[sid] = enabled
            self._enabled[stream_id] = enabled

    def get_all(self):
        with self._lock:
            return self._enabled.copy()


class AIToggleRequest(BaseModel):
    enabled: bool


class ZoneUpdateRequest(BaseModel):
    type: Optional[str] = None
    zone: Optional[List[List[float]]] = None
    line: Optional[List[List[float]]] = None
    buffer_px: Optional[int] = None
    required_consecutive_frames: Optional[int] = None


def create_app(
    frame_store: FrameStore,
    event_store: EventStore,
    ai_config: AIConfigStore,
    stream_configs: list,
    pipeline_cfg: dict,
    analytics_engines: dict,
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
            cam_id = sid.upper().replace("CAM_", "CAM-")
            cam_data = {
                "id": cam_id,
                "name": cfg.get("name", cfg.get("label", sid).split(" · ")[-1]),
                "label": cfg.get("label", f"{cam_id} · {cfg.get('name', 'Camera')}"),
                "zone": cfg.get("zone", "HQ COMPLEX"),
                "sector": cfg.get("sector", "SECTOR-1 HQ"),
                "online": cfg.get("online", True),
                "ip": cfg.get("ip", "10.142.12.101"),
                "model": cfg.get("model", "CP PLUS CP-UNC-TA51ZL6"),
                "firmware": cfg.get("firmware", "11.8.42"),
                "resolution": cfg.get("resolution", "1920×1080"),
                "fps": cfg.get("fps", 30),
                "sensitivity": cfg.get("sensitivity", 75),
                "recording": cfg.get("recording", True),
                "uptime": cfg.get("uptime", 99.9),
                "mgrs": cfg.get("mgrs", "43R WQ 1820 8120"),
                "elevationM": cfg.get("elevationM", 1680),
                "dataset": cfg.get("dataset", "VIRAT"),
                "aiWorkload": cfg.get("aiWorkload", "tracking"),
                "aiEnabled": ai_config.is_enabled(sid),
                "videoUrl": f"/api/videos/{sid}",
                "metadataUrl": f"{base_url}/metadata/{sid}",
                "precomputedUrl": f"{base_url}/precomputed/{sid}",
            }
            # Inject analytics config if present
            if "analytics" in pipeline_cfg and sid in pipeline_cfg["analytics"]:
                cam_data["analytics"] = pipeline_cfg["analytics"][sid]
            
            if mode == "live":
                cam_data["mjpegUrl"] = f"{base_url}/stream/{sid}"
            result.append(cam_data)
        return result

    @app.get("/stream/{stream_id}")
    def stream_video(stream_id: str):
        internal_id = stream_id.lower().replace("-", "_")
        def generate():
            import time
            while True:
                data = frame_store.get(internal_id) or frame_store.get(stream_id)
                if data and "jpeg" in data:
                    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + data["jpeg"] + b"\r\n"
                time.sleep(0.033) # ~30fps poll rate
        return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

    @app.post("/cameras/{stream_id}/ai")
    def toggle_ai(stream_id: str, req: AIToggleRequest):
        internal_id = stream_id.lower().replace("-", "_")
        ai_config.set_enabled(internal_id, req.enabled)
        return {"success": True, "aiEnabled": ai_config.is_enabled(internal_id)}

    @app.post("/cameras/{stream_id}/zone")
    @app.post("/cameras/{stream_id}/analytics")
    def update_analytics_zone(stream_id: str, req: ZoneUpdateRequest):
        internal_id = stream_id.lower().replace("-", "_")
        if "analytics" not in pipeline_cfg:
            pipeline_cfg["analytics"] = {}
        if internal_id not in pipeline_cfg["analytics"]:
            pipeline_cfg["analytics"][internal_id] = {}

        if req.type == "none":
            pipeline_cfg["analytics"].pop(internal_id, None)
            if internal_id in analytics_engines:
                del analytics_engines[internal_id]
            try:
                backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                yaml_path = os.path.join(backend_dir, "configs", "pipeline.yaml")
                with open(yaml_path, "w", encoding="utf-8") as f:
                    yaml.dump(pipeline_cfg, f, default_flow_style=None, sort_keys=False)
                logger.info("Removed analytics config for %s from %s", internal_id, yaml_path)
            except Exception as e:
                logger.error("Failed to persist pipeline.yaml: %s", e)
            return {"success": True, "analytics": None}

        target_cfg = pipeline_cfg["analytics"][internal_id]

        if req.type is not None:
            target_cfg["type"] = req.type

        if req.zone is not None:
            target_cfg["zone"] = req.zone
            target_cfg["type"] = "intrusion_zone"
        if req.line is not None:
            target_cfg["line"] = req.line
            target_cfg["type"] = "traffic_count"
        if req.buffer_px is not None:
            target_cfg["buffer_px"] = req.buffer_px
        if req.required_consecutive_frames is not None:
            target_cfg["required_consecutive_frames"] = req.required_consecutive_frames

        # Update live engine in memory if it exists!
        if internal_id in analytics_engines:
            engine = analytics_engines[internal_id]
            if req.zone is not None and hasattr(engine, 'intrusion_zone'):
                from shapely.geometry import Polygon
                engine.zone_coords = req.zone
                engine.intrusion_zone = Polygon(req.zone)
                buffer_px = target_cfg.get("buffer_px", 0)
                if buffer_px > 0:
                    engine.detection_zone = engine.intrusion_zone.buffer(-buffer_px)
                    if engine.detection_zone.is_empty:
                        engine.detection_zone = engine.intrusion_zone
                else:
                    engine.detection_zone = engine.intrusion_zone
                if hasattr(engine, 'reset'):
                    engine.reset()
            elif req.line is not None and hasattr(engine, 'counting_line'):
                from shapely.geometry import LineString
                engine.line_coords = req.line
                engine.counting_line = LineString(req.line)
                if hasattr(engine, 'reset'):
                    engine.reset()
        else:
            try:
                from src.analytics import create_analytics
                new_engine = create_analytics(internal_id, target_cfg)
                if new_engine:
                    analytics_engines[internal_id] = new_engine
                    logger.info("Dynamically created live analytics engine for %s", internal_id)
            except Exception as e:
                logger.warning("Could not dynamically create engine for %s: %s", internal_id, e)

        # Persist to pipeline.yaml on disk
        try:
            backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            yaml_path = os.path.join(backend_dir, "configs", "pipeline.yaml")
            with open(yaml_path, "w", encoding="utf-8") as f:
                yaml.dump(pipeline_cfg, f, default_flow_style=None, sort_keys=False)
            logger.info("Saved updated analytics config for %s to %s", internal_id, yaml_path)
        except Exception as e:
            logger.error("Failed to persist pipeline.yaml: %s", e)

        return {"success": True, "analytics": target_cfg}

    precomputed_cache = {}

    @app.get("/precomputed/{stream_id}")
    def get_precomputed(stream_id: str):
        internal_id = stream_id.lower().replace("cam-", "cam_")
        import os
        from fastapi import HTTPException
        from fastapi.responses import Response
        
        if internal_id in precomputed_cache:
            return Response(content=precomputed_cache[internal_id], media_type="application/json")
            
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        precomputed_path = os.path.join(base_dir, "backend", "outputs", "precomputed", f"{internal_id}.json")
        
        if not os.path.exists(precomputed_path):
            raise HTTPException(status_code=404, detail="Not found")
            
        with open(precomputed_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        precomputed_cache[internal_id] = content
        return Response(content=content, media_type="application/json")

    @app.get("/metadata/{stream_id}")
    async def stream_metadata(stream_id: str):
        internal_id = stream_id.lower().replace("cam-", "cam_")
        import os
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        precomputed_path = os.path.join(base_dir, "backend", "outputs", "precomputed", f"{internal_id}.json")

        async def generate():
            if mode != "live" and os.path.exists(precomputed_path):
                import json
                import time
                with open(precomputed_path, "r", encoding="utf-8") as f:
                    all_frames = json.load(f)
                
                if not all_frames:
                    return
                
                # Mock Track object to feed into analytics
                class MockTrack:
                    def __init__(self, d):
                        self.track_id = d["id"]
                        self.class_id = 0 # Not strictly needed for logic, usually string mapped
                        self.bbox = [d["x"], d["y"], d["x"]+d["w"], d["y"]+d["h"]]

                recent_events = []

                # Loop forever at exactly 30 FPS
                while True:
                    # Reset all analytics engines at the start of the video loop
                    for engine in analytics_engines.values():
                        if hasattr(engine, 'reset'):
                            engine.reset()

                    for frame_data in all_frames:
                        if not ai_config.is_enabled(stream_id):
                            # AI disabled mock data
                            yield f"data: {json.dumps({'frame_id': frame_data['frame_id'], 'video_time_sec': frame_data['video_time_sec'], 'detections': []})}\n\n"
                        else:
                            # Dynamically compute analytics!
                            if internal_id in analytics_engines:
                                engine = analytics_engines[internal_id]
                                tracks = [MockTrack(d) for d in frame_data.get("detections", []) if "id" in d]
                                # Provide dummy frame of correct size, not used by traffic/intrusion currently
                                dummy_frame = np.zeros((1080, 1920, 3), dtype=np.uint8) 
                                new_events = engine.process_frame(dummy_frame, tracks, frame_data["frame_id"])
                                
                                if new_events:
                                    for ev in new_events:
                                        recent_events.append({"event": ev, "ttl": 90}) # Show for 3 seconds (90 frames)
                                
                                active_events = []
                                next_recent = []
                                for item in recent_events:
                                    active_events.append(item["event"])
                                    item["ttl"] -= 1
                                    if item["ttl"] > 0:
                                        next_recent.append(item)
                                recent_events = next_recent

                                # Always inject a generic traffic_count event if this is a traffic counter
                                # so the UI badge stays visible
                                if hasattr(engine, 'total_count'):
                                    has_count_event = any(e.get("type") == "traffic_count" for e in active_events)
                                    if not has_count_event:
                                        active_events.append({
                                            "type": "traffic_count",
                                            "total_count": engine.total_count
                                        })

                                frame_data["events"] = active_events
                                    
                            yield f"data: {json.dumps(frame_data)}\n\n"
                        await asyncio.sleep(1 / 30.0)
            else:
                last_frame_id = None
                while True:
                    metadata = frame_store.get(internal_id) or frame_store.get(stream_id)
                    if metadata is not None and isinstance(metadata, dict):
                        if metadata.get("frame_id") != last_frame_id:
                            import json
                            # Send as Server-Sent Event (SSE), but strip the raw JPEG bytes!
                            meta_copy = metadata.copy()
                            meta_copy.pop("jpeg", None)
                            yield f"data: {json.dumps(meta_copy)}\n\n"
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
    analytics_engines: Optional[dict] = None,
):
    """Start the FastAPI output server in a daemon thread via Uvicorn."""
    import yaml
    import os
    # __file__ is backend/src/output/server.py
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    with open(os.path.join(backend_dir, "configs", "pipeline.yaml"), "r", encoding="utf-8") as f:
        pipeline_cfg = yaml.safe_load(f)

    # Initialize analytics engines dynamically if not passed from caller
    if analytics_engines is None:
        from src.analytics import create_analytics
        analytics_engines = {}
        if "analytics" in pipeline_cfg:
            for asid, acfg in pipeline_cfg["analytics"].items():
                engine = create_analytics(asid, acfg)
                if engine:
                    analytics_engines[asid] = engine

    app = create_app(frame_store, event_store, ai_config, stream_configs, pipeline_cfg, analytics_engines, mode=mode)
    
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
