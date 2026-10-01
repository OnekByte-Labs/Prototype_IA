"""
Vehicle Counting: YOLO26n (car / motorcycle / bus / truck) → tracker → counting line/zone.
Person Counting:  PeopleNet     → tracker → counting line/zone.

Counting geometry (per camera, from the operator):
  * line  → a track is counted once when its anchor point (feet / box bottom)
            crosses the line; direction is the side it crossed towards
            (IN = left→right of the line's drawn direction, OUT otherwise);
  * zone  → (no line) occupancy: objects currently inside + entries counted;
  * none  → objects currently in view + unique tracks seen.
"""

from typing import Dict, Optional, Tuple

from shapely.geometry import Point, Polygon

from .base import DetectionPipeline, PipelineOutput


def _side(p, a, b) -> float:
    """Sign of the cross product: which side of segment a→b point p is on."""
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def _segments_cross(p1, p2, a, b) -> bool:
    d1, d2 = _side(p1, a, b), _side(p2, a, b)
    d3, d4 = _side(a, p1, p2), _side(b, p1, p2)
    return d1 * d2 < 0 and d3 * d4 < 0


class LineCounter:
    """Counts each track at most once when its anchor crosses a polyline."""

    def __init__(self, line):
        self.line = [tuple(p) for p in line]
        self.last: Dict[int, Tuple[float, float]] = {}
        self.counted: Dict[int, str] = {}
        self.count_in = 0
        self.count_out = 0

    def update(self, tid: int, p) -> Optional[str]:
        prev = self.last.get(tid)
        self.last[tid] = p
        if prev is None or tid in self.counted:
            return None
        for a, b in zip(self.line, self.line[1:]):
            if _segments_cross(prev, p, a, b):
                direction = "in" if _side(p, a, b) > 0 else "out"
                self.counted[tid] = direction
                if direction == "in":
                    self.count_in += 1
                else:
                    self.count_out += 1
                return direction
        return None

    def forget(self, live_ids):
        for tid in list(self.last):
            if tid not in live_ids:
                del self.last[tid]

    @property
    def total(self):
        return self.count_in + self.count_out


class _CountingPipeline(DetectionPipeline):
    detector_name = ""
    #: detector confidence override (None = the model's default)
    detect_conf = None
    count_classes: Dict[int, str] = {}
    event_type = ""
    subject = ""

    def on_start(self):
        self.unique_ids = set()
        self.zone_entries = 0
        self.inside = set()
        self.on_geometry()

    def on_stop(self):
        self.counter = None
        self.zone = None

    def on_geometry(self):
        # New geometry replaces the old one entirely (counts restart with it)
        line = self.geometry.get("line")
        zone = self.geometry.get("zone")
        self.counter = LineCounter(line) if line and len(line) >= 2 else None
        self.zone = Polygon(zone) if (not self.counter and zone and len(zone) >= 3) else None
        self.inside = set()

    def on_loop_reset(self):
        # Track ids restart when the source loops: forget per-track state but
        # keep the cumulative counts (a count is a count).
        super().on_loop_reset()
        if self.counter:
            self.counter.last.clear()
            self.counter.counted.clear()
        self.inside = set()
        self.unique_ids = set()

    def extra_health(self):
        return {"counting_geometry": "line" if self.counter else "zone" if self.zone else "none"}

    def _detect(self, frame):
        model = self.models[self.detector_name]
        if self.detect_conf is not None:      # YOLO: class filter + confidence in the call
            return model.detect(frame, classes=set(self.count_classes), conf=self.detect_conf)
        return [d for d in model.detect(frame) if d.class_id in self.count_classes]

    def run(self, frame, packet) -> PipelineOutput:
        if self.should_detect(packet):
            dets = self._detect(frame)
            tracks = self.track(dets, packet)
        else:
            tracks = self.tracker.predict_only()

        out = PipelineOutput(tracks=tracks, class_names=dict(self.count_classes))
        live = {int(t.track_id) for t in tracks}
        self.unique_ids |= live

        for t in tracks:
            tid = int(t.track_id)
            foot = ((t.bbox[0] + t.bbox[2]) / 2.0, float(t.bbox[3]))
            kind = self.count_classes.get(int(t.class_id), self.subject)
            if self.counter:
                direction = self.counter.update(tid, foot)
                if direction:
                    out.events.append(self.make_event(
                        self.event_type, t, direction=direction, zone_id=f"{self.camera_id}:line",
                        count_in=self.counter.count_in, count_out=self.counter.count_out,
                        total_count=self.counter.total,
                        vehicle_type=kind if self.subject == "vehicle" else None,
                    ))
            elif self.zone is not None:
                if self.zone.contains(Point(foot)):
                    if tid not in self.inside:
                        self.inside.add(tid)
                        self.zone_entries += 1
                        out.events.append(self.make_event(
                            self.event_type, t, direction="enter", zone_id=f"{self.camera_id}:zone",
                            total_count=self.zone_entries,
                            vehicle_type=kind if self.subject == "vehicle" else None,
                        ))
                else:
                    self.inside.discard(tid)
        if self.counter:
            self.counter.forget(live)
            out.line = [list(p) for p in self.counter.line]
            stats = {"geometry": "line", "in": self.counter.count_in, "out": self.counter.count_out,
                     "total": self.counter.total}
        elif self.zone is not None:
            self.inside &= live
            out.zone = [list(p) for p in self.zone.exterior.coords][:-1]
            stats = {"geometry": "zone", "occupancy": len(self.inside), "entries": self.zone_entries}
        else:
            stats = {"geometry": "none"}
        out.analytics = {"subject": self.subject, "in_view": len(tracks), "unique": len(self.unique_ids), **stats}
        return out


class VehicleCountingPipeline(_CountingPipeline):
    mode = "vehicle_counting"
    model_names = ("yolo26n",)
    detector_name = "yolo26n"
    # COCO ids. 0.45 keeps parked/occluded vehicles but drops clutter (rubble, bags) that scores 0.3-0.4
    count_classes = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
    detect_conf = 0.45
    event_type = "VEHICLE_COUNT"
    subject = "vehicle"


class PersonCountingPipeline(_CountingPipeline):
    mode = "person_counting"
    model_names = ("peoplenet",)
    detector_name = "peoplenet"
    count_classes = {0: "person"}
    event_type = "PERSON_COUNT"
    subject = "person"
