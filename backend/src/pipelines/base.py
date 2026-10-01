"""
Common interface for per-camera detection pipelines.

A pipeline owns everything mode-specific for ONE camera — model references
(borrowed from the process-wide ModelRegistry), its own tracker and analytics
state — and turns frames into tracks + normalized events. The
PipelineManager drives the lifecycle:

    start()   acquire models, build tracker/analytics, warm up (raises on failure)
    process() per frame → PipelineOutput
    stop()    release models and drop all state (no stale trackers)
    health()  runtime stats for the API

Coordinates: frames may arrive downscaled (``packet.coord_scale`` = native /
processed); pipelines always report tracks, zones and events in NATIVE
stream pixels so geometry drawn in the UI maps 1:1.
"""

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import numpy as np

from src.tracking.tracker import ByteTracker

# Detection modes exposed to operators (API value → label)
DETECTION_MODES: Dict[str, str] = {
    "none": "None",
    "intrusion": "Intrusion Detection",
    "anpr": "Number Plate / Vehicle Detection",
    "vehicle_counting": "Vehicle Counting",
    "person_counting": "Person Counting",
    "anomaly": "Anomaly Detection",
}

# Pipeline lifecycle states exposed through the API / WebSocket
PIPELINE_STATES = ("idle", "starting", "running", "stopping", "error")

# Normalized event types that become operator alerts (runtime.ALERT_TYPES).
# The manager captures the annotated frame that produced them as evidence.
ALERT_EVENT_TYPES = frozenset({"PERIMETER_BREACH", "ANOMALY"})


@dataclass
class PipelineOutput:
    """What a pipeline produced for one frame (all coords native pixels)."""
    tracks: list = field(default_factory=list)
    class_names: Dict[int, str] = field(default_factory=dict)
    labels: Dict[int, str] = field(default_factory=dict)        # track_id → extra text (e.g. plate)
    alert_ids: Set[int] = field(default_factory=set)            # tracks drawn in alert red
    zone: Optional[List[List[float]]] = None                    # restricted polygon to draw
    zone_active: bool = False                                   # zone currently breached
    line: Optional[List[List[float]]] = None                    # counting line to draw
    events: List[dict] = field(default_factory=list)            # normalized events
    analytics: Dict[str, Any] = field(default_factory=dict)     # mode-specific live stats


class DetectionPipeline(ABC):
    mode: str = "none"
    #: ModelRegistry names this pipeline needs
    model_names: Sequence[str] = ()

    def __init__(self, camera_id: str, geometry: dict, registry, config: dict):
        self.camera_id = camera_id          # e.g. "CAM-07"
        self.geometry = dict(geometry or {})
        self.registry = registry
        self.config = config
        self.detect_interval = max(1, int(config.get("detect_interval", 2)))
        self.models: Dict[str, Any] = {}
        self.tracker: Optional[ByteTracker] = None
        self._frame_counter = 0
        self._started_at: Optional[float] = None
        self._frames = 0
        self._events = 0
        self._last_frame_at = 0.0
        self._infer_ms = 0.0

    # ── lifecycle ────────────────────────────────────────────────────

    def start(self) -> None:
        """Acquire models and build per-camera state. Raises on failure (the
        manager then reports state=error and releases whatever was acquired)."""
        try:
            for name in self.model_names:
                self.models[name] = self.registry.acquire(name, owner=self.camera_id)
            self.tracker = self._make_tracker()
            self.on_start()
            self._warmup()
        except Exception:
            self.stop()
            raise
        self._started_at = time.monotonic()

    def stop(self) -> None:
        """Release models and drop tracker/analytics state. Idempotent."""
        for name in list(self.models):
            self.registry.release(name, owner=self.camera_id)
        self.models.clear()
        self.tracker = None
        self.on_stop()

    def update_geometry(self, geometry: dict) -> None:
        """Operator saved a new zone/line: replace it (old one is discarded)."""
        self.geometry = dict(geometry or {})
        self.on_geometry()

    def health(self) -> dict:
        uptime = time.monotonic() - self._started_at if self._started_at else 0.0
        return {
            "mode": self.mode,
            "models": list(self.model_names),
            "frames": self._frames,
            "events": self._events,
            "uptime_s": round(uptime, 1),
            "fps": round(self._frames / uptime, 1) if uptime > 1 else 0.0,
            "last_frame_age_s": round(time.monotonic() - self._last_frame_at, 2) if self._last_frame_at else None,
            "avg_infer_ms": round(self._infer_ms, 1),
            **self.extra_health(),
        }

    # ── per-frame ────────────────────────────────────────────────────

    def process(self, frame: np.ndarray, packet) -> PipelineOutput:
        t0 = time.perf_counter()
        if packet.loop_reset:
            self.on_loop_reset()
        out = self.run(frame, packet)
        self._frames += 1
        self._events += len(out.events)
        self._last_frame_at = time.monotonic()
        ms = (time.perf_counter() - t0) * 1000
        self._infer_ms = ms if self._infer_ms == 0 else self._infer_ms * 0.95 + ms * 0.05
        return out

    def should_detect(self, packet) -> bool:
        """Detector runs every Nth frame; the tracker predicts in between."""
        self._frame_counter += 1
        return packet.loop_reset or self._frame_counter % self.detect_interval == 1 % self.detect_interval

    def track(self, detections, packet) -> list:
        """Scale detections to native coords and update the tracker."""
        k = packet.coord_scale
        tuples = []
        for d in detections:
            bbox = d.bbox if k == 1.0 else tuple(int(round(v * k)) for v in d.bbox)
            tuples.append((bbox, d.confidence, d.class_id))
        return self.tracker.update(tuples)

    def make_event(self, event_type: str, track=None, **fields) -> dict:
        """Normalized event in the shared event schema."""
        ev = {
            "type": event_type.lower(),
            "event_type": event_type,
            "camera_id": self.camera_id,
            "detection_mode": self.mode,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "track_id": None,
            "confidence": None,
            "bounding_box": None,
        }
        if track is not None:
            ev["track_id"] = int(track.track_id)
            ev["confidence"] = round(float(track.confidence), 3)
            ev["bounding_box"] = [int(v) for v in track.bbox]
        ev.update({k: v for k, v in fields.items() if v is not None})
        ev["ts"] = ev["timestamp"]  # legacy field used by the existing event log
        return ev

    # ── hooks for subclasses ────────────────────────────────────────

    def _make_tracker(self) -> ByteTracker:
        tracker = ByteTracker(stream_id=self.camera_id)
        tracker.motion_step = 1.0 / self.detect_interval
        return tracker

    def _warmup(self) -> None:
        """Run one dummy inference so model/engine failures surface in start()."""
        dummy = np.zeros((360, 640, 3), dtype=np.uint8)
        for model in self.models.values():
            if hasattr(model, "detect"):
                model.detect(dummy)

    def on_start(self) -> None: ...
    def on_stop(self) -> None: ...
    def on_geometry(self) -> None: ...
    def extra_health(self) -> dict: return {}

    def on_loop_reset(self) -> None:
        """Source video looped: identities restart, so drop tracker state."""
        if self.tracker is not None:
            self.tracker.reset_on_loop()

    @abstractmethod
    def run(self, frame: np.ndarray, packet) -> PipelineOutput: ...


class NonePipeline(DetectionPipeline):
    """Mode "none": no models, no inference — the camera streams raw video."""
    mode = "none"

    def start(self) -> None:
        self._started_at = time.monotonic()

    def run(self, frame, packet) -> PipelineOutput:
        return PipelineOutput()


def crop(frame: np.ndarray, bbox_native: Tuple[int, int, int, int], coord_scale: float,
         pad: float = 0.0) -> Tuple[np.ndarray, Tuple[int, int]]:
    """Crop a native-coordinate box out of a (possibly downscaled) frame.
    Returns (crop, (x_offset, y_offset)) in frame pixels."""
    x1, y1, x2, y2 = (v / coord_scale for v in bbox_native)
    if pad:
        pw, ph = (x2 - x1) * pad, (y2 - y1) * pad
        x1, y1, x2, y2 = x1 - pw, y1 - ph, x2 + pw, y2 + ph
    h, w = frame.shape[:2]
    x1, y1 = int(max(0, x1)), int(max(0, y1))
    x2, y2 = int(min(w, x2)), int(min(h, y2))
    return frame[y1:y2, x1:x2], (x1, y1)
