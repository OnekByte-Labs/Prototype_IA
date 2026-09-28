"""
ByteTrack-style multi-object tracker using IOU association + Kalman filter.

Per-stream state with explicit reset_on_loop() to clear all tracks when
the video wraps, preventing phantom tracks from teleporting objects.

This is a simplified ByteTrack implementation suitable for a prototype.
Uses lapx (LAP solver) for optimal assignment.
"""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np

try:
    import lapx
    _HAVE_LAPX = True
except ImportError:
    _HAVE_LAPX = False

logger = logging.getLogger(__name__)


class KalmanBoxState:
    """Simple Kalman-like state for a bounding box: [cx, cy, w, h, vx, vy]."""

    def __init__(self, bbox: Tuple[int, int, int, int]):
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        w = max(10.0, float(abs(x2 - x1)))
        h = max(10.0, float(abs(y2 - y1)))
        # [cx, cy, w, h, vx, vy]
        self.state = np.array([cx, cy, w, h, 0.0, 0.0], dtype=np.float64)

    def predict(self):
        """Advance position by velocity. Size stays stable without runaway drift."""
        self.state[0] += self.state[4]  # cx += vx
        self.state[1] += self.state[5]  # cy += vy
        self.state[4] *= 0.9  # velocity damping
        self.state[5] *= 0.9

    def update(self, bbox: Tuple[int, int, int, int]):
        """Update state with a new measurement."""
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        w = max(10.0, float(abs(x2 - x1)))
        h = max(10.0, float(abs(y2 - y1)))

        vx = cx - self.state[0]
        vy = cy - self.state[1]

        alpha = 0.7
        self.state[0] = alpha * cx + (1.0 - alpha) * self.state[0]
        self.state[1] = alpha * cy + (1.0 - alpha) * self.state[1]
        self.state[2] = alpha * w + (1.0 - alpha) * self.state[2]
        self.state[3] = alpha * h + (1.0 - alpha) * self.state[3]
        self.state[4] = alpha * vx + (1.0 - alpha) * self.state[4]
        self.state[5] = alpha * vy + (1.0 - alpha) * self.state[5]

    @property
    def bbox(self) -> Tuple[int, int, int, int]:
        cx, cy, w, h = self.state[:4]
        w = max(10.0, w)
        h = max(10.0, h)
        return (
            int(cx - w / 2),
            int(cy - h / 2),
            int(cx + w / 2),
            int(cy + h / 2),
        )


class Track:
    """A single tracked object."""

    _next_id = 1

    def __init__(self, bbox: Tuple[int, int, int, int], class_id: int, confidence: float):
        self.track_id: int = Track._next_id
        Track._next_id += 1
        self.class_id: int = class_id
        self.confidence: float = confidence
        self.kalman = KalmanBoxState(bbox)
        self.hits: int = 1
        self.age: int = 0
        self.time_since_update: int = 0
        self.is_confirmed: bool = False

    @property
    def bbox(self) -> Tuple[int, int, int, int]:
        return self.kalman.bbox

    def predict(self):
        self.kalman.predict()
        self.age += 1
        self.time_since_update += 1

    def update(self, bbox: Tuple[int, int, int, int], class_id: int, confidence: float):
        self.kalman.update(bbox)
        self.class_id = class_id
        self.confidence = confidence
        self.hits += 1
        self.time_since_update = 0
        if self.hits >= 3:
            self.is_confirmed = True


def _iou_batch(
    bb_a: np.ndarray, bb_b: np.ndarray
) -> np.ndarray:
    """
    Compute IOU between two sets of boxes.
    bb_a: (N, 4), bb_b: (M, 4) — each row is [x1, y1, x2, y2].
    Returns: (N, M) IOU matrix.
    """
    x1 = np.maximum(bb_a[:, 0:1], bb_b[:, 0:1].T)
    y1 = np.maximum(bb_a[:, 1:2], bb_b[:, 1:2].T)
    x2 = np.minimum(bb_a[:, 2:3], bb_b[:, 2:3].T)
    y2 = np.minimum(bb_a[:, 3:4], bb_b[:, 3:4].T)

    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (bb_a[:, 2] - bb_a[:, 0]) * (bb_a[:, 3] - bb_a[:, 1])
    area_b = (bb_b[:, 2] - bb_b[:, 0]) * (bb_b[:, 3] - bb_b[:, 1])
    union = area_a[:, None] + area_b[None, :] - inter
    return inter / np.clip(union, 1e-6, None)


def _linear_assignment(cost_matrix: np.ndarray, threshold: float):
    """
    Solve the linear assignment problem.
    Returns (matches, unmatched_a, unmatched_b).
    """
    if cost_matrix.size == 0:
        return (
            np.empty((0, 2), dtype=int),
            np.arange(cost_matrix.shape[0]),
            np.arange(cost_matrix.shape[1]),
        )

    if _HAVE_LAPX:
        # lapx expects a cost matrix (lower is better), so use 1 - IOU
        cost = 1.0 - cost_matrix
        row_ind, col_ind = lapx.lapjv(cost, extend_cost=True, cost_limit=1.0 - threshold)
        matches = []
        unmatched_a = []
        for r, c in enumerate(row_ind):
            if c < 0 or cost_matrix[r, c] < threshold:
                unmatched_a.append(r)
            else:
                matches.append([r, c])
        matched_cols = set(m[1] for m in matches)
        unmatched_b = [c for c in range(cost_matrix.shape[1]) if c not in matched_cols]
        return (
            np.array(matches, dtype=int).reshape(-1, 2) if matches else np.empty((0, 2), dtype=int),
            np.array(unmatched_a, dtype=int),
            np.array(unmatched_b, dtype=int),
        )
    else:
        # Greedy fallback
        matches = []
        unmatched_b = list(range(cost_matrix.shape[1]))
        unmatched_a = []
        used_cols = set()
        for r in range(cost_matrix.shape[0]):
            best_c = -1
            best_iou = threshold
            for c in range(cost_matrix.shape[1]):
                if c in used_cols:
                    continue
                if cost_matrix[r, c] > best_iou:
                    best_iou = cost_matrix[r, c]
                    best_c = c
            if best_c >= 0:
                matches.append([r, best_c])
                used_cols.add(best_c)
                if best_c in unmatched_b:
                    unmatched_b.remove(best_c)
            else:
                unmatched_a.append(r)
        return (
            np.array(matches, dtype=int).reshape(-1, 2) if matches else np.empty((0, 2), dtype=int),
            np.array(unmatched_a, dtype=int),
            np.array(unmatched_b, dtype=int),
        )


class ByteTracker:
    """
    Simplified ByteTrack tracker.

    Two-stage association:
      1. Match high-confidence detections to existing tracks via IOU.
      2. Match remaining low-confidence detections to unmatched tracks.

    Supports reset_on_loop() to clear all state when the video wraps.
    """

    def __init__(
        self,
        stream_id: str,
        high_thresh: float = 0.5,
        low_thresh: float = 0.1,
        iou_threshold: float = 0.3,
        max_age: int = 30,
    ):
        self.stream_id = stream_id
        self.high_thresh = high_thresh
        self.low_thresh = low_thresh
        self.iou_threshold = iou_threshold
        self.max_age = max_age
        self.tracks: List[Track] = []

    def reset_on_loop(self):
        """Clear all tracks when the video loops back to frame 0."""
        n = len(self.tracks)
        self.tracks.clear()
        Track._next_id = 1
        logger.info("[%s] Tracker reset on loop — cleared %d tracks", self.stream_id, n)

    def update(
        self, detections: List[Tuple[Tuple[int, int, int, int], float, int]]
    ) -> List[Track]:
        """
        Update tracker with new detections.

        Args:
            detections: list of (bbox, confidence, class_id)

        Returns:
            List of confirmed Track objects after this frame.
        """
        # Predict step
        for t in self.tracks:
            t.predict()

        if not detections:
            self.tracks = [t for t in self.tracks if t.time_since_update <= self.max_age]
            return [t for t in self.tracks if t.is_confirmed]

        det_array = np.array([d[0] for d in detections], dtype=np.float64)  # (N, 4)
        det_confs = np.array([d[1] for d in detections])
        det_classes = np.array([d[2] for d in detections])

        # Split into high and low confidence
        high_mask = det_confs >= self.high_thresh
        low_mask = (det_confs >= self.low_thresh) & (~high_mask)

        high_dets = np.where(high_mask)[0]
        low_dets = np.where(low_mask)[0]

        # ── Stage 1: associate high-conf detections with tracks ──
        unmatched_tracks_idx = list(range(len(self.tracks)))
        if len(high_dets) > 0 and len(self.tracks) > 0:
            track_boxes = np.array([t.bbox for t in self.tracks], dtype=np.float64)
            iou_matrix = _iou_batch(track_boxes, det_array[high_dets])
            matches, um_tracks, um_dets = _linear_assignment(iou_matrix, self.iou_threshold)

            for m in matches:
                ti, di = int(m[0]), int(m[1])
                d_idx = high_dets[di]
                self.tracks[ti].update(
                    tuple(det_array[d_idx].astype(int)),
                    int(det_classes[d_idx]),
                    float(det_confs[d_idx]),
                )

            unmatched_tracks_idx = um_tracks.tolist()
            unmatched_high_dets = high_dets[um_dets]
        else:
            unmatched_high_dets = high_dets

        # ── Stage 2: associate low-conf detections with remaining tracks ──
        remaining_tracks_idx = [i for i in unmatched_tracks_idx]
        if len(low_dets) > 0 and len(remaining_tracks_idx) > 0:
            r_tracks = [self.tracks[i] for i in remaining_tracks_idx]
            track_boxes = np.array([t.bbox for t in r_tracks], dtype=np.float64)
            iou_matrix = _iou_batch(track_boxes, det_array[low_dets])
            matches2, um_tracks2, _ = _linear_assignment(iou_matrix, self.iou_threshold)

            for m in matches2:
                ti, di = int(m[0]), int(m[1])
                actual_ti = remaining_tracks_idx[ti]
                d_idx = low_dets[di]
                self.tracks[actual_ti].update(
                    tuple(det_array[d_idx].astype(int)),
                    int(det_classes[d_idx]),
                    float(det_confs[d_idx]),
                )

        # ── Create new tracks for unmatched high-conf detections ──
        for d_idx in unmatched_high_dets:
            new_track = Track(
                bbox=tuple(det_array[d_idx].astype(int)),
                class_id=int(det_classes[d_idx]),
                confidence=float(det_confs[d_idx]),
            )
            self.tracks.append(new_track)

        # ── Remove dead tracks ──
        self.tracks = [t for t in self.tracks if t.time_since_update <= self.max_age]

        return [t for t in self.tracks if t.is_confirmed and t.time_since_update <= 1]
