"""
Process-wide model registry with reference counting.

Every model is loaded at most ONCE per worker process no matter how many
cameras use it, and is unloaded (GPU memory / TensorRT engines freed) as soon
as the last camera pipeline using it stops. Loads are serialized per model so
two cameras switching at the same time never load duplicates.
"""

import gc
import logging
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Set

logger = logging.getLogger("pipelines.registry")

PROJECT_ROOT = Path(__file__).resolve().parents[3]
MODELS = PROJECT_ROOT / "models"


def _yolo26n():
    p = MODELS / "yolo26n.onnx"
    if p.is_file():
        from src.inference.yolo_e2e import Yolo26Detector
        return Yolo26Detector(str(p), conf_threshold=0.35)
    from src.inference.detector import YOLODetector
    return YOLODetector(str(MODELS / "yolo11n.onnx"), conf_threshold=0.25)


def _trafficcamnet():
    p = MODELS / "tao/trafficcamnet_resnet18_pruned.onnx"
    if p.is_file():
        from src.inference.tao import DetectNetV2Detector
        return DetectNetV2Detector(
            str(p),
            classes=["car", "bicycle", "person", "road_sign"],
            tag="TrafficCamNet", pre_cluster_threshold=0.2, nms_iou=0.3,
        )
    return _yolo26n()


def _peoplenet():
    p = MODELS / "tao/peoplenet_resnet34.onnx"
    if p.is_file():
        from src.inference.tao import DetectNetV2Detector
        return DetectNetV2Detector(
            str(p),
            classes=["person", "bag", "face"],
            tag="PeopleNet", pre_cluster_threshold=0.4, nms_iou=0.4,
        )
    return _yolo26n()


def _lpdnet():
    p = MODELS / "tao/lpdnet_usa_pruned.onnx"
    if p.is_file():
        from src.inference.tao import DetectNetV2Detector
        return DetectNetV2Detector(
            str(p),
            classes=["license_plate"],
            tag="LPDNet", pre_cluster_threshold=0.3, nms_iou=0.3, min_box=4,
        )
    from src.inference.plate_detector import PlateDetector
    return PlateDetector(str(MODELS / "yolov8n_plate.onnx"), conf_threshold=0.3)


def _lprnet():
    p = MODELS / "tao/lprnet_us_baseline18.onnx"
    d = MODELS / "tao/lprnet_dict_us.txt"
    if p.is_file() and d.is_file():
        from src.inference.tao import LPRNetRecognizer
        return LPRNetRecognizer(str(p), str(d))
    from src.inference.ocr import PlateOCR
    return PlateOCR(str(MODELS / "cct-xs-v2-global-model.onnx"), str(MODELS / "plate_config.yaml"))


MODEL_FACTORIES: Dict[str, Callable[[], Any]] = {
    "yolo26n": _yolo26n,
    "trafficcamnet": _trafficcamnet,
    "peoplenet": _peoplenet,
    "lpdnet": _lpdnet,
    "lprnet": _lprnet,
}


# Files and purpose of each model (administration: registry, versions, validation)
MODEL_INFO: Dict[str, dict] = {
    "yolo26n": {"files": ["yolo26n.onnx"], "task": "object detection (end-to-end YOLO26n, COCO)",
                "framework": "Ultralytics YOLO26 → ONNX"},
    "trafficcamnet": {"files": ["tao/trafficcamnet_resnet18_pruned.onnx"],
                      "task": "vehicle / person detection (DetectNetV2, ResNet-18 pruned)", "framework": "NVIDIA TAO"},
    "peoplenet": {"files": ["tao/peoplenet_resnet34.onnx"],
                  "task": "person / bag / face detection (DetectNetV2, ResNet-34)", "framework": "NVIDIA TAO"},
    "lpdnet": {"files": ["tao/lpdnet_usa_pruned.onnx"], "task": "license-plate detection", "framework": "NVIDIA TAO"},
    "lprnet": {"files": ["tao/lprnet_us_baseline18.onnx", "tao/lprnet_dict_us.txt"],
               "task": "license-plate character recognition", "framework": "NVIDIA TAO"},
}
assert set(MODEL_INFO) == set(MODEL_FACTORIES)


def _providers(model: Any) -> list:
    """Execution providers of the ONNX Runtime sessions held by a model object."""
    out = []
    for v in vars(model).values() if hasattr(model, "__dict__") else ():
        sess = getattr(v, "_session", None)
        if sess is not None and hasattr(sess, "get_providers"):
            out.append(sess.get_providers()[0])
        elif hasattr(v, "get_providers"):
            out.append(v.get_providers()[0])
    return sorted(set(out))


class ModelRegistry:
    def __init__(self):
        self._lock = threading.Lock()
        self._load_locks: Dict[str, threading.Lock] = {n: threading.Lock() for n in MODEL_FACTORIES}
        self._models: Dict[str, Any] = {}
        self._owners: Dict[str, Set[str]] = {}

    def acquire(self, name: str, owner: str) -> Any:
        if name not in MODEL_FACTORIES:
            raise KeyError(f"Unknown model '{name}'")
        with self._load_locks[name]:  # one load at a time per model
            with self._lock:
                model = self._models.get(name)
                if model is not None:
                    self._owners[name].add(owner)
                    return model
            t0 = time.monotonic()
            model = MODEL_FACTORIES[name]()  # may raise → caller reports error
            with self._lock:
                self._models[name] = model
                self._owners[name] = {owner}
            logger.info("Loaded model %s in %.1fs (for %s)", name, time.monotonic() - t0, owner)
            return model

    def release(self, name: str, owner: str) -> None:
        with self._load_locks[name]:
            with self._lock:
                owners = self._owners.get(name)
                if owners is None:
                    return
                owners.discard(owner)
                if owners:
                    return
                model = self._models.pop(name)
                del self._owners[name]
            if hasattr(model, "release"):
                model.release()
            del model
            gc.collect()
            logger.info("Unloaded model %s (no cameras use it)", name)

    def snapshot(self) -> Dict[str, list]:
        with self._lock:
            return {n: sorted(o) for n, o in self._owners.items()}

    def providers(self) -> Dict[str, list]:
        with self._lock:
            models = dict(self._models)
        return {n: _providers(m) for n, m in models.items()}
