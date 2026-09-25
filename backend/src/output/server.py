"""
Output server — Flask-based MJPEG + REST endpoint.

Serves:
  GET /cameras           → JSON list of stream configs (for the Next.js frontend)
  GET /stream/<stream_id> → MJPEG stream of annotated frames
  GET /events            → latest N events as JSON
"""

import json
import logging
import threading
import time
from typing import Dict, Optional

import cv2
import numpy as np
from flask import Flask, Response, jsonify
from flask_cors import CORS

logger = logging.getLogger(__name__)


class FrameStore:
    """
    Thread-safe store for the latest annotated frame per stream.
    The pipeline writes frames here; the Flask server reads them.
    """

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
        # Only enable cam_06 by default to save CPU!
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


def create_app(
    frame_store: FrameStore,
    event_store: EventStore,
    ai_config: AIConfigStore,
    stream_configs: list,
) -> Flask:
    """Create and configure the Flask app."""

    app = Flask(__name__)
    CORS(app)

    @app.route("/cameras", methods=["GET"])
    def cameras():
        """Return camera list in the same format the Next.js frontend expects."""
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
        return jsonify(result)

    @app.route("/cameras/<stream_id>/ai", methods=["POST"])
    def toggle_ai(stream_id: str):
        """Toggle AI enablement for a stream."""
        from flask import request
        data = request.json
        if not data or "enabled" not in data:
            return jsonify({"error": "Missing 'enabled' boolean"}), 400
        
        # Next.js sends IDs as "CAM-XX", we need "cam_xx" internally
        internal_id = stream_id.lower().replace("cam-", "cam_")
        ai_config.set_enabled(internal_id, bool(data["enabled"]))
        return jsonify({"success": True, "aiEnabled": ai_config.is_enabled(internal_id)})

    @app.route("/stream/<stream_id>", methods=["GET"])
    def stream(stream_id: str):
        """MJPEG stream of annotated frames for a given camera."""

        def generate():
            last_frame_id = None
            while True:
                # We expect the frame store to give us a tuple (frame_id, frame)
                # But currently it just gives the frame. Let's just use the object id of the frame array.
                frame = frame_store.get(stream_id)
                if frame is not None:
                    current_frame_id = id(frame)
                    if current_frame_id != last_frame_id:
                        # Resize large frames (like 4K) down to 800px for the dashboard grid
                        # to save massive amounts of CPU and network bandwidth.
                        h, w = frame.shape[:2]
                        if w > 800:
                            scale = 800 / w
                            frame = cv2.resize(frame, (800, int(h * scale)))

                        _, jpeg = cv2.imencode(
                            ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 60]
                        )
                        yield (
                            b"--frame\r\n"
                            b"Content-Type: image/jpeg\r\n\r\n"
                            + jpeg.tobytes()
                            + b"\r\n"
                        )
                        last_frame_id = current_frame_id
                # Sleep a little to prevent busy-waiting, target max 30 FPS check rate
                time.sleep(0.033)

        return Response(
            generate(),
            mimetype="multipart/x-mixed-replace; boundary=frame",
        )

    @app.route("/events", methods=["GET"])
    def events():
        """Return latest events as JSON."""
        return jsonify(event_store.get_recent())

    return app


def run_server(
    frame_store: FrameStore,
    event_store: EventStore,
    ai_config: AIConfigStore,
    stream_configs: list,
    host: str = "0.0.0.0",
    port: int = 5555,
):
    """Start the Flask output server in a daemon thread."""
    app = create_app(frame_store, event_store, ai_config, stream_configs)
    server_thread = threading.Thread(
        target=lambda: app.run(host=host, port=port, threaded=True, use_reloader=False),
        daemon=True,
        name="output-server",
    )
    server_thread.start()
    logger.info("Output server started on http://%s:%d", host, port)
    return server_thread
