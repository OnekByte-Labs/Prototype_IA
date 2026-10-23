"""
YOLOv11n primary detector — ONNXRuntime wrapper.

Introspects the ONNX graph's input tensor shape at load time rather than
hardcoding dimensions. Falls back to standard YOLO convention (letterbox
to square, RGB, /255) only if introspection is inconclusive — and logs a
warning if the fallback is used.
"""

import logging
from pathlib import Path
from typing import List, Optional, Set, Tuple

import cv2
import numpy as np

from .gpu import create_session

logger = logging.getLogger(__name__)


class Detection:
    """A single detected object."""
    __slots__ = ("bbox", "confidence", "class_id")

    def __init__(self, bbox: Tuple[int, int, int, int], confidence: float, class_id: int):
        self.bbox = bbox          # (x1, y1, x2, y2) in original image coords
        self.confidence = confidence
        self.class_id = class_id

    def __repr__(self):
        return f"Detection(cls={self.class_id}, conf={self.confidence:.2f}, bbox={self.bbox})"


class YOLODetector:
    """
    Wraps an ONNX YOLO model (v8/v11 format) for inference.

    Automatically selects the best available execution provider:
      CUDA → DirectML → CPU
    """

    def __init__(
        self,
        model_path: str,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45,
    ):
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold

        # ── select execution provider (CUDA → DirectML → CPU) ──
        self.session = create_session(model_path, "YOLODetector")

        # ── introspect input tensor ──
        inputs = self.session.get_inputs()
        self.input_name = inputs[0].name
        input_shape = inputs[0].shape  # e.g. [1, 3, 640, 640] or ['batch', 3, 'height', 'width']

        # Try to extract concrete H, W from the shape
        try:
            self.input_h = int(input_shape[2])
            self.input_w = int(input_shape[3])
            self.channels = int(input_shape[1])
            logger.info(
                "Introspected input shape: %s → (%d, %d, %d)",
                input_shape, self.channels, self.input_h, self.input_w,
            )
        except (TypeError, ValueError, IndexError):
            # Dynamic axes — fall back to standard YOLO convention
            self.input_h = 640
            self.input_w = 640
            self.channels = 3
            logger.warning(
                "⚠ Could not introspect concrete input dims from %s — "
                "falling back to YOLO default (%d, %d, %d). "
                "If results look wrong, check the model's expected input.",
                input_shape, self.channels, self.input_h, self.input_w,
            )

        # ── introspect output tensor ──
        outputs = self.session.get_outputs()
        self.output_name = outputs[0].name
        output_shape = outputs[0].shape
        logger.info("Output tensor name: %s, shape: %s", self.output_name, output_shape)

    # ── preprocessing ───────────────────────────────────────────────

    def _letterbox(
        self, img: np.ndarray
    ) -> Tuple[np.ndarray, float, Tuple[int, int]]:
        """
        Letterbox-resize to (input_w, input_h) preserving aspect ratio.
        Returns (letterboxed_image, scale, (pad_w, pad_h)).
        """
        h, w = img.shape[:2]
        scale = min(self.input_w / w, self.input_h / h)
        new_w, new_h = int(w * scale), int(h * scale)
        resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        pad_w = (self.input_w - new_w) // 2
        pad_h = (self.input_h - new_h) // 2
        padded = cv2.copyMakeBorder(
            resized,
            pad_h, self.input_h - new_h - pad_h,
            pad_w, self.input_w - new_w - pad_w,
            cv2.BORDER_CONSTANT, value=(114, 114, 114),
        )

        return padded, scale, (pad_w, pad_h)

    def _preprocess(self, img: np.ndarray) -> Tuple[np.ndarray, float, Tuple[int, int]]:
        """
        Standard YOLO preprocessing: BGR→RGB, letterbox, /255, NCHW, float32.
        """
        letterboxed, scale, pad = self._letterbox(img)
        # BGR→RGB, /255, HWC→NCHW in one optimised OpenCV call
        blob = cv2.dnn.blobFromImage(letterboxed, 1.0 / 255.0, swapRB=True)
        return blob, scale, pad

    # ── postprocessing ──────────────────────────────────────────────

    def _postprocess(
        self, output: np.ndarray, scale: float, pad: Tuple[int, int], orig_shape: Tuple[int, int]
    ) -> List[Detection]:
        """
        Parse YOLO output tensor and apply NMS.

        YOLOv8/v11 output shape is (1, num_classes+4, num_detections).
        Transpose to (num_detections, num_classes+4), then:
          columns 0-3: cx, cy, w, h (in letterboxed coordinates)
          columns 4+:  class scores
        """
        # Squeeze batch dim and transpose
        preds = output[0]  # (num_classes+4, num_detections)
        if preds.shape[0] < preds.shape[1]:
            preds = preds.T  # → (num_detections, num_classes+4)

        # Extract boxes (cx, cy, w, h) and class scores
        cx = preds[:, 0]
        cy = preds[:, 1]
        w = preds[:, 2]
        h = preds[:, 3]
        class_scores = preds[:, 4:]

        # Best class per detection
        class_ids = np.argmax(class_scores, axis=1)
        confidences = class_scores[np.arange(len(class_ids)), class_ids]

        # Filter by confidence
        mask = confidences >= self.conf_threshold
        cx, cy, w, h = cx[mask], cy[mask], w[mask], h[mask]
        class_ids = class_ids[mask]
        confidences = confidences[mask]

        if len(confidences) == 0:
            return []

        # Convert cx,cy,w,h → x1,y1,x2,y2 in letterboxed coords
        x1 = cx - w / 2
        y1 = cy - h / 2
        x2 = cx + w / 2
        y2 = cy + h / 2

        # Undo letterbox: remove padding, then unscale
        pad_w, pad_h = pad
        x1 = (x1 - pad_w) / scale
        y1 = (y1 - pad_h) / scale
        x2 = (x2 - pad_w) / scale
        y2 = (y2 - pad_h) / scale

        # Clip to original image bounds
        orig_h, orig_w = orig_shape
        x1 = np.clip(x1, 0, orig_w)
        y1 = np.clip(y1, 0, orig_h)
        x2 = np.clip(x2, 0, orig_w)
        y2 = np.clip(y2, 0, orig_h)

        # NMS via OpenCV
        boxes_for_nms = np.stack([x1, y1, x2 - x1, y2 - y1], axis=1).tolist()
        indices = cv2.dnn.NMSBoxes(
            boxes_for_nms,
            confidences.tolist(),
            self.conf_threshold,
            self.iou_threshold,
        )

        detections: List[Detection] = []
        if len(indices) > 0:
            indices = indices.flatten()
            for i in indices:
                det = Detection(
                    bbox=(int(x1[i]), int(y1[i]), int(x2[i]), int(y2[i])),
                    confidence=float(confidences[i]),
                    class_id=int(class_ids[i]),
                )
                detections.append(det)

        return detections

    def release(self) -> None:
        if hasattr(self.session, "release"):
            self.session.release()

    # ── public API ──────────────────────────────────────────────────

    def detect(self, img: np.ndarray, classes: Optional[Set[int]] = None,
               conf: Optional[float] = None) -> List[Detection]:
        """
        Run detection on a BGR image (numpy array from cv2).
        Returns a list of Detection objects in original image coordinates.
        """
        blob, scale, pad = self._preprocess(img)
        outputs = self.session.run([self.output_name], {self.input_name: blob})
        dets = self._postprocess(outputs[0], scale, pad, img.shape[:2])
        if conf is not None:
            dets = [d for d in dets if d.confidence >= conf]
        if classes is not None:
            dets = [d for d in dets if d.class_id in classes]
        return dets
