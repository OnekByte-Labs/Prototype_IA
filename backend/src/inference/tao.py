"""
NVIDIA TAO model wrappers — TrafficCamNet, PeopleNet, LPDNet (DetectNet_v2)
and LPRNet — running on the existing ONNX Runtime + TensorRT/CUDA stack.

Pre/post-processing mirrors DeepStream's nvinfer + DetectNet_v2 parser so the
same ONNX files behave as they would inside a DeepStream pipeline:

  * input: RGB, scaled by 1/255 (``net-scale-factor=0.0039``), resized to the
    network size without keeping aspect ratio (``maintain-aspect-ratio=0``);
  * output: per-class coverage grid + bbox offsets on a 16-px stride, decoded
    with ``bbox_norm = 35`` and a 0.5 px centre offset, then filtered by a
    pre-cluster threshold and minimum box size and clustered with NMS.
"""

import logging
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np

from .detector import Detection
from .gpu import create_session, ensure_gpu_runtime

logger = logging.getLogger(__name__)


class DetectNetV2Detector:
    """TAO DetectNet_v2 detector (TrafficCamNet / PeopleNet / LPDNet)."""

    def __init__(
        self,
        model_path: str,
        classes: Sequence[str],
        tag: str,
        pre_cluster_threshold: float = 0.2,
        nms_iou: float = 0.3,
        min_box: int = 16,
        bbox_norm: float = 35.0,
        class_thresholds: Optional[dict] = None,
    ):
        self.classes = list(classes)
        self.tag = tag
        self.pre_cluster_threshold = pre_cluster_threshold
        self.class_thresholds = class_thresholds or {}
        self.nms_iou = nms_iou
        self.min_box = min_box
        self.bbox_norm = bbox_norm

        # Batch axis of TAO exports is symbolic (unk__NNN) — pin it to 1 so
        # TensorRT builds a static engine.
        import onnxruntime as ort
        # The CUDA/cuDNN/TensorRT libs must be preloaded BEFORE any session in
        # this process — otherwise ORT fails to load its CUDA provider once and
        # silently runs every later session on CPU.
        ensure_gpu_runtime()
        probe = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        inp = probe.get_inputs()[0]
        batch_dim = inp.shape[0] if isinstance(inp.shape[0], str) else None
        self.input_name = inp.name
        self.net_h, self.net_w = int(inp.shape[2]), int(inp.shape[3])
        self.output_names = [o.name for o in probe.get_outputs()]
        del probe
        self.cov_name = next(n for n in self.output_names if "cov" in n)
        self.bbox_name = next(n for n in self.output_names if "bbox" in n)

        self.session = create_session(
            model_path, tag, free_dims={batch_dim: 1} if batch_dim else None,
        )
        logger.info("[%s] DetectNet_v2 %dx%d classes=%s", tag, self.net_w, self.net_h, self.classes)

    def release(self) -> None:
        if hasattr(self.session, "release"):
            self.session.release()

    def detect(self, img: np.ndarray) -> List[Detection]:
        """Detect on a BGR image; boxes are returned in ``img`` pixel coords."""
        h, w = img.shape[:2]
        if h == 0 or w == 0:
            return []
        blob = cv2.dnn.blobFromImage(
            cv2.resize(img, (self.net_w, self.net_h), interpolation=cv2.INTER_LINEAR),
            1.0 / 255.0, swapRB=True,
        )
        cov, bbox = self.session.run([self.cov_name, self.bbox_name], {self.input_name: blob})
        cov, bbox = cov[0], bbox[0]
        grid_h, grid_w = cov.shape[1:]
        stride_x, stride_y = self.net_w / grid_w, self.net_h / grid_h
        norm = self.bbox_norm
        cx = (np.arange(grid_w) * stride_x + 0.5) / norm
        cy = (np.arange(grid_h) * stride_y + 0.5) / norm
        sx, sy = w / self.net_w, h / self.net_h

        detections: List[Detection] = []
        for c in range(cov.shape[0]):
            thr = self.class_thresholds.get(self.classes[c], self.pre_cluster_threshold)
            ys, xs = np.where(cov[c] > thr)
            if len(ys) == 0:
                continue
            b = bbox[c * 4:(c + 1) * 4, ys, xs]
            x1 = (b[0] - cx[xs]) * -norm
            y1 = (b[1] - cy[ys]) * -norm
            x2 = (b[2] + cx[xs]) * norm
            y2 = (b[3] + cy[ys]) * norm
            keep = ((x2 - x1) >= self.min_box) & ((y2 - y1) >= self.min_box)
            if not keep.any():
                continue
            x1, y1, x2, y2 = x1[keep] * sx, y1[keep] * sy, x2[keep] * sx, y2[keep] * sy
            scores = cov[c, ys[keep], xs[keep]].astype(float)
            rects = np.stack([x1, y1, x2 - x1, y2 - y1], axis=1).tolist()
            idx = cv2.dnn.NMSBoxes(rects, scores.tolist(), thr, self.nms_iou)
            for i in np.array(idx).flatten():
                detections.append(Detection(
                    bbox=(int(max(0, x1[i])), int(max(0, y1[i])), int(min(w, x2[i])), int(min(h, y2[i]))),
                    confidence=float(scores[i]),
                    class_id=c,
                ))
        return detections


class LPRNetRecognizer:
    """TAO LPRNet (US) — greedy CTC decode of the model's per-step argmax."""

    def __init__(self, model_path: str, dict_path: str, tag: str = "LPRNet"):
        self.chars = Path(dict_path).read_text().split()
        self.blank = len(self.chars)
        # LPRNet contains an LSTM TensorRT can't take whole — CUDA EP (LSTM
        # itself falls back to CPU, which is negligible at 96x48).
        self.session = create_session(model_path, tag, tensorrt=False)
        self.input_name = self.session.get_inputs()[0].name
        _, _, self.h, self.w = self.session.get_inputs()[0].shape

    def release(self) -> None:
        if hasattr(self.session, "release"):
            self.session.release()

    def recognize(self, plate_bgr: np.ndarray) -> Tuple[str, float]:
        """Returns (text, confidence) — confidence is the mean max-prob of the
        emitted characters."""
        if plate_bgr.size == 0:
            return "", 0.0
        blob = cv2.dnn.blobFromImage(cv2.resize(plate_bgr, (self.w, self.h)), 1.0 / 255.0, swapRB=True)
        ids, probs = self.session.run(None, {self.input_name: blob})
        text, confs, prev = [], [], -1
        for i, p in zip(ids[0], probs[0]):
            if i != prev and i < self.blank:
                text.append(self.chars[i])
                confs.append(float(p))
            prev = i
        return "".join(text), (float(np.mean(confs)) if confs else 0.0)
