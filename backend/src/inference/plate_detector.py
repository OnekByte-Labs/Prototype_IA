"""
YOLOv8n plate detector — ONNXRuntime wrapper.

Same architecture as the primary detector but specialised for license-plate
detection. Crops from the primary detector's vehicle bounding boxes are fed
in, and plate bounding boxes are returned in the coordinate space of the
*crop*, not the original frame.
"""

import logging
from typing import List, Tuple

import cv2
import numpy as np

from .detector import Detection
from .gpu import create_session

logger = logging.getLogger(__name__)


class PlateDetector:
    """
    Wraps the yolov8n_plate.onnx model.

    Input:  a vehicle crop (BGR numpy array).
    Output: list of Detection with bbox in crop coordinates.
    """

    def __init__(
        self,
        model_path: str,
        conf_threshold: float = 0.3,
        iou_threshold: float = 0.45,
    ):
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold

        self.session = create_session(model_path, "PlateDetector")

        # Introspect input
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        shape = inp.shape
        try:
            self.input_h = int(shape[2])
            self.input_w = int(shape[3])
            logger.info("[PlateDetector] Input shape: %s", shape)
        except (TypeError, ValueError, IndexError):
            self.input_h = 640
            self.input_w = 640
            logger.warning(
                "⚠ [PlateDetector] Could not introspect input dims from %s — "
                "falling back to 640×640",
                shape,
            )

        out = self.session.get_outputs()[0]
        self.output_name = out.name

    def _letterbox(self, img: np.ndarray) -> Tuple[np.ndarray, float, Tuple[int, int]]:
        h, w = img.shape[:2]
        scale = min(self.input_w / w, self.input_h / h)
        new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
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
        letterboxed, scale, pad = self._letterbox(img)
        blob = cv2.dnn.blobFromImage(letterboxed, 1.0 / 255.0, swapRB=True)
        return blob, scale, pad

    def _postprocess(
        self, output: np.ndarray, scale: float, pad: Tuple[int, int], orig_shape: Tuple[int, int]
    ) -> List[Detection]:
        preds = output[0]
        if preds.shape[0] < preds.shape[1]:
            preds = preds.T

        cx, cy, w, h = preds[:, 0], preds[:, 1], preds[:, 2], preds[:, 3]
        class_scores = preds[:, 4:]

        class_ids = np.argmax(class_scores, axis=1)
        confidences = class_scores[np.arange(len(class_ids)), class_ids]

        mask = confidences >= self.conf_threshold
        cx, cy, w, h = cx[mask], cy[mask], w[mask], h[mask]
        class_ids, confidences = class_ids[mask], confidences[mask]

        if len(confidences) == 0:
            return []

        x1 = cx - w / 2
        y1 = cy - h / 2
        x2 = cx + w / 2
        y2 = cy + h / 2

        pad_w, pad_h = pad
        x1 = (x1 - pad_w) / scale
        y1 = (y1 - pad_h) / scale
        x2 = (x2 - pad_w) / scale
        y2 = (y2 - pad_h) / scale

        orig_h, orig_w = orig_shape
        x1, y1 = np.clip(x1, 0, orig_w), np.clip(y1, 0, orig_h)
        x2, y2 = np.clip(x2, 0, orig_w), np.clip(y2, 0, orig_h)

        boxes_for_nms = np.stack([x1, y1, x2 - x1, y2 - y1], axis=1).tolist()
        indices = cv2.dnn.NMSBoxes(
            boxes_for_nms, confidences.tolist(), self.conf_threshold, self.iou_threshold
        )

        detections: List[Detection] = []
        if len(indices) > 0:
            for i in indices.flatten():
                detections.append(
                    Detection(
                        bbox=(int(x1[i]), int(y1[i]), int(x2[i]), int(y2[i])),
                        confidence=float(confidences[i]),
                        class_id=int(class_ids[i]),
                    )
                )
        return detections

    def detect(self, vehicle_crop: np.ndarray) -> List[Detection]:
        """
        Run plate detection on a vehicle crop (BGR).
        Returns plate bounding boxes in crop coordinates.
        """
        if vehicle_crop.size == 0:
            return []
        blob, scale, pad = self._preprocess(vehicle_crop)
        outputs = self.session.run([self.output_name], {self.input_name: blob})
        return self._postprocess(outputs[0], scale, pad, vehicle_crop.shape[:2])
