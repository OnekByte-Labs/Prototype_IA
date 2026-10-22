"""
OCR module — thin wrapper around fast-plate-ocr's LicensePlateRecognizer.

Uses the cct-xs-v2-global-model ONNX model for plate text recognition.
The model file should already be present at models/cct-xs-v2-global-model.onnx.
"""

import logging
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import yaml

from .gpu import create_session

logger = logging.getLogger(__name__)


class PlateOCR:
    """
    License-plate OCR using the cct-xs-v2-global-model directly via
    ONNXRuntime, guided by the plate_config.yaml shipped alongside the model.

    This avoids needing the fast-plate-ocr library to download anything
    at runtime and keeps all model files local.
    """

    def __init__(self, model_path: str, config_path: str):
        """
        Args:
            model_path:  Path to cct-xs-v2-global-model.onnx
            config_path: Path to plate_config.yaml
        """
        # Load config
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)

        self.img_height: int = cfg.get("img_height", 64)
        self.img_width: int = cfg.get("img_width", 128)
        self.max_plate_slots: int = cfg.get("max_plate_slots", 10)
        self.alphabet: str = cfg.get("alphabet", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_")
        self.pad_char: str = cfg.get("pad_char", "_")
        self.keep_aspect_ratio: bool = cfg.get("keep_aspect_ratio", False)
        self.color_mode: str = cfg.get("image_color_mode", "rgb")

        # Build character index
        self._char_list = list(self.alphabet)

        # Load ONNX model
        self.session = create_session(model_path, "PlateOCR", tensorrt=False)

        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        logger.info("[PlateOCR] Input: name=%s, shape=%s", inp.name, inp.shape)

        out = self.session.get_outputs()[0]
        self.output_name = out.name
        logger.info("[PlateOCR] Output: name=%s, shape=%s", out.name, out.shape)

    def _preprocess(self, plate_crop: np.ndarray) -> np.ndarray:
        """
        Resize plate crop to the model's expected input size.
        The model expects uint8 input (it handles normalization internally).
        """
        if self.color_mode == "grayscale":
            if len(plate_crop.shape) == 3:
                plate_crop = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2GRAY)
            resized = cv2.resize(
                plate_crop, (self.img_width, self.img_height), interpolation=cv2.INTER_LINEAR
            )
            blob = resized.astype(np.uint8)
            blob = np.expand_dims(blob, axis=(0, -1))  # (1, H, W, 1)
        else:
            rgb = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2RGB)
            resized = cv2.resize(
                rgb, (self.img_width, self.img_height), interpolation=cv2.INTER_LINEAR
            )
            blob = resized.astype(np.uint8)
            blob = np.expand_dims(blob, axis=0)  # (1, H, W, 3)

        return blob

    def _decode(self, output: np.ndarray) -> str:
        """
        Decode the model's output into a plate string.
        Output shape is typically (1, max_plate_slots, num_classes).
        Take argmax per slot and map to characters, stripping pad chars.
        """
        preds = output[0]  # (max_plate_slots, num_classes)
        indices = np.argmax(preds, axis=-1)
        chars = []
        for idx in indices:
            if idx < len(self._char_list):
                c = self._char_list[idx]
                if c != self.pad_char:
                    chars.append(c)
        return "".join(chars)

    def release(self) -> None:
        if hasattr(self.session, "release"):
            self.session.release()

    def recognize(self, plate_crop: np.ndarray):
        """
        Run OCR on a plate crop (BGR numpy array).
        Returns (text, conf) tuple.
        """
        if plate_crop is None or plate_crop.size == 0:
            return "", 0.0

        # Minimum size sanity check
        h, w = plate_crop.shape[:2]
        if h < 8 or w < 16:
            return "", 0.0

        blob = self._preprocess(plate_crop)
        outputs = self.session.run([self.output_name], {self.input_name: blob})
        text = self._decode(outputs[0])
        return (text or "", 0.85 if text else 0.0)
