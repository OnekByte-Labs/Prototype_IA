"""
Number Plate / Vehicle Detection: YOLO26n → tracker → LPDNet → LPRNet.

Vehicles (car / motorcycle / bus / truck) come from YOLO26n. Per vehicle track
the plate cascade runs throttled (a few vehicles per detector frame, largest
first, with retry back-off). Every raw plate read is snapped to the Indian
plate layout (plates.py); reads that cannot be a real plate are discarded. A
track's plate is decided by voting over its valid reads. Events:

  VEHICLE_OBSERVED  once per new confirmed vehicle track
  PLATE_READ        when a track's plate is first decided, and again only
                    if the vote moves to a different plate
"""

from .base import DetectionPipeline, PipelineOutput, crop
from .plates import normalize_indian_plate

VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}   # COCO ids
VEHICLE_CONF = 0.45


class AnprPipeline(DetectionPipeline):
    mode = "anpr"
    model_names = ("yolo26n", "lpdnet", "lprnet")

    def on_start(self):
        self.plates = {}        # track_id → {"text", "conf", "last_try", "fails", "votes"}
        self.rejected = 0       # raw reads discarded as not a valid plate
        self.observed = set()
        self.max_per_frame = int(self.config.get("anpr_max_per_frame", 2))
        self.min_vehicle_px = int(self.config.get("anpr_min_vehicle_px", 80))
        self.min_plate_conf = float(self.config.get("anpr_min_plate_conf", 0.6))

    def on_stop(self):
        self.plates = {}
        self.observed = set()

    def on_loop_reset(self):
        super().on_loop_reset()
        self.plates.clear()
        self.observed.clear()

    def extra_health(self):
        return {"plates_read": sum(1 for p in self.plates.values() if p["text"])}

    def _read_plate(self, frame, track, packet):
        """LPDNet on the vehicle crop, LPRNet on the best plate."""
        vcrop, _ = crop(frame, track.bbox, packet.coord_scale)
        if vcrop.shape[0] < self.min_vehicle_px * 0.6 or vcrop.shape[1] < self.min_vehicle_px:
            return None
        plates = self.models["lpdnet"].detect(vcrop)
        if not plates:
            return None
        best = max(plates, key=lambda d: d.confidence)
        x1, y1, x2, y2 = best.bbox
        pcrop = vcrop[y1:y2, x1:x2]
        if pcrop.shape[0] < 8 or pcrop.shape[1] < 16:
            return None
        raw, conf = self.models["lprnet"].recognize(pcrop)
        fit = normalize_indian_plate(raw)
        if fit is None:
            self.rejected += 1
            return None
        text, corrections = fit
        return text, max(0.0, conf - 0.05 * corrections), best.confidence

    def run(self, frame, packet) -> PipelineOutput:
        detect = self.should_detect(packet)
        if detect:
            dets = self.models["yolo26n"].detect(frame, classes=set(VEHICLE_CLASSES), conf=VEHICLE_CONF)
            tracks = self.track(dets, packet)
        else:
            tracks = self.tracker.predict_only()

        out = PipelineOutput(tracks=tracks, class_names=dict(VEHICLE_CLASSES))
        live_ids = {int(t.track_id) for t in tracks}

        for t in tracks:
            tid = int(t.track_id)
            if tid not in self.observed:
                self.observed.add(tid)
                out.events.append(self.make_event(
                    "VEHICLE_OBSERVED", t, vehicle_type=VEHICLE_CLASSES.get(int(t.class_id), "vehicle"),
                ))

        # Plate cascade — only on detector frames, bounded per frame
        if detect:
            due = []
            for t in tracks:
                p = self.plates.get(int(t.track_id))
                retry = 15 if (p and p["text"]) else min(3 * (1 + (p["fails"] if p else 0) // 2), 30)
                if p is None or packet.frame_id - p["last_try"] >= retry:
                    due.append(t)
            due.sort(key=lambda t: (t.bbox[2] - t.bbox[0]) * (t.bbox[3] - t.bbox[1]), reverse=True)
            for t in due[:self.max_per_frame]:
                tid = int(t.track_id)
                p = self.plates.setdefault(tid, {"text": None, "conf": 0.0, "last_try": 0, "fails": 0, "votes": {}})
                p["last_try"] = packet.frame_id
                read = self._read_plate(frame, t, packet)
                if read is None or read[1] < self.min_plate_conf:
                    p["fails"] += 1
                    continue
                text, conf, det_conf = read
                p["fails"] = 0
                # Vote: the plate with the most accumulated confidence over this track's reads wins
                v = p["votes"].setdefault(text, [0.0, 0.0])
                v[0] += conf
                v[1] = max(v[1], conf)
                lead = max(p["votes"], key=lambda k: p["votes"][k][0])
                if p["text"] is None or lead != p["text"]:
                    text, conf = lead, p["votes"][lead][1]
                    p["text"], p["conf"] = text, conf
                    out.events.append(self.make_event(
                        "PLATE_READ", t,
                        vehicle_type=VEHICLE_CLASSES.get(int(t.class_id), "vehicle"),
                        plate_text=text,
                        plate_confidence=round(conf, 3),
                        plate_detection_confidence=round(det_conf, 3),
                    ))

        for tid in list(self.plates):
            if tid not in live_ids and packet.frame_id - self.plates[tid]["last_try"] > 300:
                del self.plates[tid]
        out.labels = {tid: p["text"] for tid, p in self.plates.items() if p["text"] and tid in live_ids}
        out.analytics = {
            "vehicles": len(tracks),
            "rejected_reads": self.rejected,
            "plates": [{"track_id": tid, "plate": p["text"], "confidence": round(p["conf"], 3)}
                       for tid, p in self.plates.items() if p["text"] and tid in live_ids],
        }
        return out
