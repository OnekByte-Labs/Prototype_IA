"""
YOLO26n wrapper — Ultralytics end-to-end (NMS-free) ONNX export.

Output ``[1, 300, 6]`` = (x1, y1, x2, y2, score, class) in the 640x640
letterboxed input space; no NMS is needed.
"""

import logging
from typing import List, Optional, Set

import cv2
import numpy as np

from .detector import Detection
from .gpu import create_session

logger = logging.getLogger(__name__)


class Yolo26Detector:
    def __init__(self, model_path: str, conf_threshold: float = 0.35, tag: str = "YOLO26n"):
        self.conf_threshold = conf_threshold
        self.session = create_session(model_path, tag)
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        self.input_h, self.input_w = int(inp.shape[2]), int(inp.shape[3])
        self.output_name = self.session.get_outputs()[0].name

    def release(self) -> None:
        if hasattr(self.session, "release"):
            self.session.release()

    def detect(self, img: np.ndarray, classes: Optional[Set[int]] = None,
               conf: Optional[float] = None) -> List[Detection]:
        h, w = img.shape[:2]
        scale = min(self.input_w / w, self.input_h / h)
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        pw, ph = (self.input_w - nw) // 2, (self.input_h - nh) // 2
        padded = cv2.copyMakeBorder(
            cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR),
            ph, self.input_h - nh - ph, pw, self.input_w - nw - pw,
            cv2.BORDER_CONSTANT, value=(114, 114, 114),
        )
        out = self.session.run([self.output_name], {
            self.input_name: cv2.dnn.blobFromImage(padded, 1.0 / 255.0, swapRB=True),
        })[0][0]
        out = out[out[:, 4] >= (self.conf_threshold if conf is None else conf)]
        dets: List[Detection] = []
        for x1, y1, x2, y2, score, cls in out:
            cls = int(cls)
            if classes is not None and cls not in classes:
                continue
            dets.append(Detection(
                bbox=(
                    int(max(0, (x1 - pw) / scale)), int(max(0, (y1 - ph) / scale)),
                    int(min(w, (x2 - pw) / scale)), int(min(h, (y2 - ph) / scale)),
                ),
                confidence=float(score),
                class_id=cls,
            ))
        return dets
