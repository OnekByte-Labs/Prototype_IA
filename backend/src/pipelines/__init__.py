"""Per-camera detection pipelines behind one interface (see base.py)."""

from .anomaly import AnomalyPipeline
from .anpr import AnprPipeline
from .base import DETECTION_MODES, PIPELINE_STATES, DetectionPipeline, NonePipeline, PipelineOutput
from .counting import PersonCountingPipeline, VehicleCountingPipeline
from .intrusion import IntrusionPipeline

PIPELINE_CLASSES = {
    "none": NonePipeline,
    "intrusion": IntrusionPipeline,
    "anpr": AnprPipeline,
    "vehicle_counting": VehicleCountingPipeline,
    "person_counting": PersonCountingPipeline,
    "anomaly": AnomalyPipeline,
}

assert set(PIPELINE_CLASSES) == set(DETECTION_MODES)

__all__ = [
    "DETECTION_MODES", "PIPELINE_STATES", "PIPELINE_CLASSES", "DetectionPipeline",
    "PipelineOutput",
]
