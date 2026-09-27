"""
Annotation utilities — draw detection boxes, track IDs, and plate text
onto frames for the MJPEG output stream.
"""

from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np


# Color palette (BGR) for different object categories
COLORS = {
    "person": (0, 255, 120),     # green
    "vehicle": (255, 180, 0),    # blue-ish
    "animal": (0, 200, 255),     # orange-ish
    "plate": (0, 255, 255),      # yellow
    "default": (200, 200, 200),  # grey
}

CATEGORY_MAP = {
    0: "person",
    1: "vehicle",   # bicycle
    2: "vehicle",   # car
    3: "vehicle",   # motorcycle
    5: "vehicle",   # bus
    7: "vehicle",   # truck
    14: "animal", 15: "animal", 16: "animal", 17: "animal",
    18: "animal", 19: "animal", 20: "animal", 21: "animal",
    22: "animal", 23: "animal",
}


def get_color(class_id: int) -> Tuple[int, int, int]:
    cat = CATEGORY_MAP.get(class_id, "default")
    return COLORS.get(cat, COLORS["default"])


def draw_detections(
    frame: np.ndarray,
    tracks: list,
    class_names: Dict[int, str],
    plate_texts: Optional[Dict[int, str]] = None,
    plate_boxes: Optional[Dict[int, Tuple[int, int, int, int]]] = None,
) -> np.ndarray:
    """
    Draw tracked detections onto a frame.

    Args:
        frame:       BGR image (will be modified in-place).
        tracks:      List of Track objects from the tracker.
        class_names: Mapping of class_id → label string.
        plate_texts: Optional mapping of track_id → recognized plate text.
        plate_boxes: Optional mapping of track_id → plate bbox in frame coords.

    Returns:
        The annotated frame.
    """
    if plate_texts is None:
        plate_texts = {}
    if plate_boxes is None:
        plate_boxes = {}

    for track in tracks:
        x1, y1, x2, y2 = track.bbox
        color = get_color(track.class_id)
        class_name = class_names.get(track.class_id, f"cls{track.class_id}")

        # Main bounding box
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        # Label: "ID:42 car 0.87"
        label = f"ID:{track.track_id} {class_name} {track.confidence:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw + 4, y1), color, -1)
        cv2.putText(
            frame, label, (x1 + 2, y1 - 4),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA,
        )

        # Plate text (if recognized)
        if track.track_id in plate_texts:
            plate_text = plate_texts[track.track_id]
            plate_label = f"PLATE: {plate_text}"
            (ptw, pth), _ = cv2.getTextSize(plate_label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(frame, (x1, y2), (x1 + ptw + 4, y2 + pth + 6), COLORS["plate"], -1)
            cv2.putText(
                frame, plate_label, (x1 + 2, y2 + pth + 2),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA,
            )

        # Plate bounding box (if detected)
        if track.track_id in plate_boxes:
            px1, py1, px2, py2 = plate_boxes[track.track_id]
            cv2.rectangle(frame, (px1, py1), (px2, py2), COLORS["plate"], 2)

    return frame
