"""
Restricted-zone intrusion detection.

A person "enters" the zone when their anchor point (feet by default — the
bottom-centre of the box, i.e. where they stand on the floor) is inside the
operator-drawn polygon for ``required_consecutive_frames`` frames in a row.
Each entry raises exactly one ``intrusion`` event:

  * while the person stays inside, no further events;
  * they must be outside for ``exit_frames`` consecutive frames before the
    zone re-arms for them, so jitter on the boundary doesn't re-trigger;
  * a track that briefly drops out (occlusion, missed detection) keeps its
    state for ``lost_grace_frames``;
  * if the tracker re-assigns a new id to the same person inside the zone
    (id switch), the new id inherits the "already alerted" state when it
    appears near where an alerted track vanished within ``handover_s``.
"""

import time
from typing import Dict, List, Set, Tuple

import numpy as np
from shapely.geometry import Point, Polygon

from .base import BaseAnalytics

PERSON_CLASS_IDS = {0}


class _TrackState:
    __slots__ = ("in_count", "out_count", "inside", "alerted", "lost", "last_pos")

    def __init__(self):
        self.in_count = 0      # consecutive frames with anchor inside
        self.out_count = 0     # consecutive frames with anchor outside
        self.inside = False    # confirmed inside (debounced)
        self.alerted = False   # alert already raised for the current entry
        self.lost = 0          # frames since the track was last seen
        self.last_pos: Tuple[float, float] = (0.0, 0.0)


class IntrusionDetector(BaseAnalytics):
    def __init__(self, stream_id: str, config: dict):
        super().__init__(stream_id, config)

        self.zone_coords = config.get("zone", [])
        if len(self.zone_coords) < 3:
            raise ValueError(f"IntrusionDetector for {stream_id} requires at least 3 points for the zone polygon.")

        self.intrusion_zone = Polygon(self.zone_coords)
        if not self.intrusion_zone.is_valid:
            # Self-intersecting drawing (e.g. a bow-tie): keep ALL its lobes. buffer(0)
            # silently drops one of them, leaving part of the drawn zone unguarded.
            from shapely.ops import unary_union
            from shapely.validation import make_valid
            fixed = make_valid(self.intrusion_zone)
            parts = [g for g in getattr(fixed, "geoms", [fixed]) if g.geom_type == "Polygon" and g.area > 0]
            self.intrusion_zone = unary_union(parts) if parts else self.intrusion_zone.buffer(0)

        # Optional inward buffer to avoid near-miss false triggers
        buffer_px = config.get("buffer_px", 0)
        self.detection_zone = self.intrusion_zone
        if buffer_px > 0:
            shrunk = self.intrusion_zone.buffer(-buffer_px)
            if not shrunk.is_empty:
                self.detection_zone = shrunk

        self.required_consecutive_frames = int(config.get("required_consecutive_frames", 5))
        self.exit_frames = int(config.get("exit_frames", 8))
        self.lost_grace_frames = int(config.get("lost_grace_frames", 30))
        self.handover_s = float(config.get("handover_s", 3.0))
        self.anchor = config.get("anchor", "foot")  # "foot" | "center"
        self.class_ids: Set[int] = set(config.get("classes", PERSON_CLASS_IDS))

        self.states: Dict[int, _TrackState] = {}
        # (x, y, monotonic time) where an alerted person inside the zone vanished
        self._vanished_inside: List[Tuple[float, float, float]] = []
        # Track ids currently confirmed inside (for drawing)
        self.occupied_ids: Set[int] = set()

    def reset(self):
        self.states.clear()
        self._vanished_inside.clear()
        self.occupied_ids.clear()

    def _anchor_point(self, bbox) -> Tuple[float, float]:
        x1, y1, x2, y2 = bbox
        if self.anchor == "center":
            return (x1 + x2) / 2.0, (y1 + y2) / 2.0
        return (x1 + x2) / 2.0, float(y2)

    def _claim_handover(self, pos: Tuple[float, float], bbox) -> bool:
        """True if a new inside track is likely the same person as an alerted
        track that just vanished inside the zone (tracker id switch)."""
        now = time.monotonic()
        self._vanished_inside = [v for v in self._vanished_inside if now - v[2] <= self.handover_s]
        x1, y1, x2, y2 = bbox
        radius = max(x2 - x1, y2 - y1) * 1.5
        # An alerted intruder whose track is currently lost (still in grace)
        for otid, ost in list(self.states.items()):
            if ost.lost > 0 and ost.inside and ost.alerted and \
                    np.hypot(pos[0] - ost.last_pos[0], pos[1] - ost.last_pos[1]) <= radius:
                del self.states[otid]
                return True
        for i, (vx, vy, _) in enumerate(self._vanished_inside):
            if np.hypot(pos[0] - vx, pos[1] - vy) <= radius:
                del self._vanished_inside[i]
                return True
        return False

    def process_frame(self, frame: np.ndarray, tracks: list, frame_id: int) -> list:
        events = []
        seen: Set[int] = set()

        for track in tracks:
            if int(track.class_id) not in self.class_ids:
                continue
            tid = int(track.track_id)
            seen.add(tid)
            st = self.states.get(tid)
            if st is None:
                st = self.states[tid] = _TrackState()
            st.lost = 0
            pos = self._anchor_point(track.bbox)
            st.last_pos = pos

            if self.detection_zone.contains(Point(pos)):
                st.in_count += 1
                st.out_count = 0
                if not st.inside and st.in_count >= self.required_consecutive_frames:
                    st.inside = True
                    if not st.alerted and self._claim_handover(pos, track.bbox):
                        st.alerted = True  # same person as a just-lost intruder
                    if not st.alerted:
                        st.alerted = True
                        events.append({
                            "type": "intrusion",
                            "stream_id": self.stream_id,
                            "frame_id": frame_id,
                            "object_id": tid,
                            "class_id": int(track.class_id),
                            "confidence": float(track.confidence),
                            "location": [pos[0], pos[1]],
                        })
            else:
                st.out_count += 1
                st.in_count = 0
                if st.inside and st.out_count >= self.exit_frames:
                    # Person has left — re-arm so a later re-entry alerts again
                    st.inside = False
                    st.alerted = False

        # Tracks not reported this frame: keep their state for a grace period
        for tid in list(self.states):
            if tid in seen:
                continue
            st = self.states[tid]
            st.lost += 1
            if st.lost > self.lost_grace_frames:
                if st.inside and st.alerted:
                    self._vanished_inside.append((*st.last_pos, time.monotonic()))
                del self.states[tid]

        self.occupied_ids = {tid for tid, st in self.states.items() if st.inside and tid in seen}
        return events
