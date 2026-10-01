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
    "alert": (40, 40, 255),      # red — object inside a restricted zone
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


NAME_CATEGORY = {
    "person": "person",
    "car": "vehicle", "bicycle": "vehicle", "motorcycle": "vehicle", "bus": "vehicle",
    "truck": "vehicle", "vehicle": "vehicle",
    "animal": "animal",
}


def get_color(class_id: int, class_name: Optional[str] = None) -> Tuple[int, int, int]:
    # Pipelines use different label spaces (COCO for YOLO, TAO ids for
    # TrafficCamNet/PeopleNet), so colour by name when one is known.
    cat = NAME_CATEGORY.get(class_name) if class_name else None
    if cat is None:
        cat = CATEGORY_MAP.get(class_id, "default")
    return COLORS.get(cat, COLORS["default"])


def draw_detections(
    frame: np.ndarray,
    tracks: list,
    class_names: Dict[int, str],
    plate_texts: Optional[Dict[int, str]] = None,
    plate_boxes: Optional[Dict[int, Tuple[int, int, int, int]]] = None,
    scale: float = 1.0,
    alert_ids: Optional[set] = None,
) -> np.ndarray:
    """
    Draw tracked detections onto a frame.

    Args:
        frame:       BGR image (will be modified in-place).
        tracks:      List of Track objects from the tracker.
        class_names: Mapping of class_id → label string.
        plate_texts: Optional mapping of track_id → recognized plate text.
        plate_boxes: Optional mapping of track_id → plate bbox in frame coords.
        scale:       Factor from track/plate coords to ``frame`` pixels, for
                     drawing on a downscaled display copy of the frame.
        alert_ids:   Track ids to draw in alert red (e.g. intruders in a
                     restricted zone).

    Returns:
        The annotated frame.
    """
    if plate_texts is None:
        plate_texts = {}
    if plate_boxes is None:
        plate_boxes = {}

    # Keep labels legible whether the display frame is 432p or 720p.
    font_scale = max(0.4, frame.shape[0] / 1300)
    thickness = 2 if frame.shape[0] >= 600 else 1

    def sc(v):
        return int(round(v * scale))

    for track in tracks:
        x1, y1, x2, y2 = (sc(v) for v in track.bbox)
        class_name = class_names.get(track.class_id, f"cls{track.class_id}")
        color = COLORS["alert"] if alert_ids and track.track_id in alert_ids else get_color(track.class_id, class_name)

        # Main bounding box
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)

        # Label: "car 87% #42"
        label = f"{class_name} {track.confidence * 100:.0f}% #{track.track_id}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
        ly = y1 if y1 - th - 6 >= 0 else y1 + th + 6
        cv2.rectangle(frame, (x1, ly - th - 6), (x1 + tw + 4, ly), color, -1)
        cv2.putText(
            frame, label, (x1 + 2, ly - 4),
            cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), 1, cv2.LINE_AA,
        )

        # Plate text (if recognized)
        if track.track_id in plate_texts:
            plate_label = f"PLATE: {plate_texts[track.track_id]}"
            (ptw, pth), _ = cv2.getTextSize(plate_label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
            cv2.rectangle(frame, (x1, y2), (x1 + ptw + 4, y2 + pth + 6), COLORS["plate"], -1)
            cv2.putText(
                frame, plate_label, (x1 + 2, y2 + pth + 2),
                cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), 1, cv2.LINE_AA,
            )

        # Plate bounding box (if detected)
        if track.track_id in plate_boxes:
            px1, py1, px2, py2 = (sc(v) for v in plate_boxes[track.track_id])
            cv2.rectangle(frame, (px1, py1), (px2, py2), COLORS["plate"], thickness)

    return frame


def draw_restricted_zone(
    frame: np.ndarray,
    zone: List[List[float]],
    scale: float = 1.0,
    occupied: bool = False,
) -> np.ndarray:
    """
    Shade a restricted (intrusion) zone in red on the frame. The fill gets
    stronger and a label appears while someone is inside it.

    Args:
        zone:     Polygon vertices in native stream pixels.
        scale:    Factor from native coords to ``frame`` pixels.
        occupied: True while an intruder is confirmed inside.
    """
    if not zone or len(zone) < 3:
        return frame
    pts = np.array([[int(round(x * scale)), int(round(y * scale))] for x, y in zone], dtype=np.int32)
    overlay = frame.copy()
    cv2.fillPoly(overlay, [pts], (0, 0, 255))
    alpha = 0.38 if occupied else 0.22
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, dst=frame)
    thickness = 3 if occupied else 2
    cv2.polylines(frame, [pts], isClosed=True, color=(0, 0, 255), thickness=thickness, lineType=cv2.LINE_AA)

    label = "RESTRICTED ZONE - INTRUSION" if occupied else "RESTRICTED ZONE"
    font_scale = max(0.45, frame.shape[0] / 1100)
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
    x, y = int(pts[:, 0].min()), int(pts[:, 1].min())
    y = max(y, th + 8)
    cv2.rectangle(frame, (x, y - th - 8), (x + tw + 8, y), (0, 0, 200), -1)
    cv2.putText(frame, label, (x + 4, y - 5), cv2.FONT_HERSHEY_SIMPLEX, font_scale,
                (255, 255, 255), 1, cv2.LINE_AA)
    return frame


def draw_counting_line(frame: np.ndarray, line: List[List[float]], scale: float = 1.0,
                       label: Optional[str] = None) -> np.ndarray:
    """Draw a counting line (polyline) with an optional count label."""
    if not line or len(line) < 2:
        return frame
    pts = np.array([[int(round(x * scale)), int(round(y * scale))] for x, y in line], dtype=np.int32)
    cv2.polylines(frame, [pts], isClosed=False, color=(0, 220, 255), thickness=3, lineType=cv2.LINE_AA)
    if label:
        font_scale = max(0.45, frame.shape[0] / 1100)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
        x, y = int(pts[0][0]), max(int(pts[0][1]) - 6, th + 8)
        cv2.rectangle(frame, (x, y - th - 8), (x + tw + 8, y), (0, 150, 200), -1)
        cv2.putText(frame, label, (x + 4, y - 5), cv2.FONT_HERSHEY_SIMPLEX, font_scale,
                    (255, 255, 255), 1, cv2.LINE_AA)
    return frame
