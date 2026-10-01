"""
Intrusion Detection: YOLO26n (persons) → tracker → camera restricted polygon
→ PERIMETER_BREACH.

Zone logic (enter/exit hysteresis, one event per entry, id-switch handover)
is the existing, validated IntrusionDetector engine.

Small / distant people: the detector sees a 640 px letterboxed image, so on a
wide frame a person 40 px tall is ~20 px — below what YOLO resolves reliably.
When the restricted zone covers only part of the frame, detection runs on the
zone's bounding box (plus a margin) instead of the whole frame, which
enlarges everything in it by up to 2-3x at no extra cost.
"""

from src.analytics.intrusion import IntrusionDetector
from src.inference.detector import Detection

from .base import DetectionPipeline, PipelineOutput

PERSON = 0
ROI_MARGIN = 0.35        # extra context around the zone, as a fraction of its size
ROI_MIN_PX = 360         # never crop smaller than this (frame px) — tiny crops only blur
ROI_MAX_FRAME_AREA = 0.7  # zone already fills most of the frame: full-frame detection


class IntrusionPipeline(DetectionPipeline):
    mode = "intrusion"
    model_names = ("yolo26n",)

    def on_start(self):
        self.engine = None
        self.on_geometry()

    def on_stop(self):
        self.engine = None

    def _roi(self, frame, coord_scale):
        """Detection window (x1, y1, x2, y2) in frame pixels, or None for the full frame."""
        zone = self.geometry.get("zone")
        if not zone or len(zone) < 3:
            return None
        h, w = frame.shape[:2]
        xs = [p[0] / coord_scale for p in zone]
        ys = [p[1] / coord_scale for p in zone]
        zw, zh = max(xs) - min(xs), max(ys) - min(ys)
        mx, my = max(zw * ROI_MARGIN, 40), max(zh * ROI_MARGIN, 40)
        x1, y1, x2, y2 = min(xs) - mx, min(ys) - my, max(xs) + mx, max(ys) + my
        for lo, hi, size in ((0, 2, ROI_MIN_PX), (1, 3, ROI_MIN_PX)):
            box = [x1, y1, x2, y2]
            if box[hi] - box[lo] < size:
                c = (box[hi] + box[lo]) / 2
                box[lo], box[hi] = c - size / 2, c + size / 2
                x1, y1, x2, y2 = box
        x1, y1, x2, y2 = int(max(0, x1)), int(max(0, y1)), int(min(w, x2)), int(min(h, y2))
        if x2 - x1 < 32 or y2 - y1 < 32 or (x2 - x1) * (y2 - y1) > ROI_MAX_FRAME_AREA * w * h:
            return None
        return x1, y1, x2, y2

    def _detect_people(self, frame, packet):
        roi = self._roi(frame, packet.coord_scale)
        if roi is None:
            return self.models["yolo26n"].detect(frame, classes={PERSON})
        x1, y1, x2, y2 = roi
        dets = self.models["yolo26n"].detect(frame[y1:y2, x1:x2], classes={PERSON})
        return [Detection((d.bbox[0] + x1, d.bbox[1] + y1, d.bbox[2] + x1, d.bbox[3] + y1),
                          d.confidence, d.class_id) for d in dets]

    def on_geometry(self):
        zone = self.geometry.get("zone")
        cfg = {
            "zone": zone,
            "buffer_px": self.geometry.get("buffer_px", 0),
            "required_consecutive_frames": self.config.get("intrusion_confirm_frames", 5),
        }
        self.engine = IntrusionDetector(self.camera_id, cfg) if zone and len(zone) >= 3 else None

    def on_loop_reset(self):
        super().on_loop_reset()
        if self.engine:
            self.engine.reset()

    def extra_health(self):
        return {"zone_configured": self.engine is not None}

    def run(self, frame, packet) -> PipelineOutput:
        if self.should_detect(packet):
            tracks = self.track(self._detect_people(frame, packet), packet)
        else:
            tracks = self.tracker.predict_only()

        out = PipelineOutput(tracks=tracks, class_names={PERSON: "person"})
        if self.engine is None:
            out.analytics = {"zone_configured": False, "persons": len(tracks)}
            return out

        for ev in self.engine.process_frame(frame, tracks, packet.frame_id):
            track = next((t for t in tracks if int(t.track_id) == ev["object_id"]), None)
            out.events.append(self.make_event(
                "PERIMETER_BREACH", track,
                zone_id=f"{self.camera_id}:restricted",
                object_class="person",
                frame_id=packet.frame_id,
                location=ev.get("location"),
            ))
        out.zone = self.engine.zone_coords
        out.zone_active = bool(self.engine.occupied_ids)
        out.alert_ids = set(self.engine.occupied_ids)
        out.analytics = {
            "zone_configured": True,
            "persons": len(tracks),
            "intruders": len(self.engine.occupied_ids),
        }
        return out
