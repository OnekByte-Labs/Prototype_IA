"""
Anomaly Detection — statistical BASELINE (no anomaly model exists in this
repository, and none is fabricated here).

YOLO26n (people + vehicles) → tracker → per-camera online statistics. Each
camera learns what "normal" looks like while it runs and flags departures:

  ABNORMAL_MOTION  a track moves much faster than this camera's learned
                   normal speed for its class (robust z-score: median + k·MAD,
                   speed in body-heights/second so it is distance-invariant),
                   sustained for several frames — e.g. running, speeding.
  LOITERING        a person stays in view, roughly in one place, longer than
                   ``anomaly_loiter_s`` seconds.
  CROWD_SURGE      the number of people in view jumps well above this
                   camera's running mean (EMA mean/σ, ≥ +3σ and ≥ +3 people).
  UNUSUAL_OBJECT   an object class that never appeared during the learning
                   period shows up (e.g. a vehicle in a pedestrian-only area).

LIMITATIONS (documented, by design):
  * Heuristic, unsupervised — it detects statistical outliers, not intent;
    it cannot recognise actions such as fighting, theft or falls.
  * Needs a warm-up (``anomaly_warmup_s``, default 60 s) per camera before
    speed/crowd/unusual-object rules arm; the baseline resets when the mode
    is (re)started, and is not persisted.
  * Looping demo clips replay the same scene, so the learned baseline
    converges on that clip; results depend on camera placement and scale.
  * Speed uses image-plane motion normalised by box height; strong
    perspective or partial occlusion can distort it.
"""

import time
from collections import deque
from typing import Dict

import numpy as np

from .base import DetectionPipeline, PipelineOutput

CLASSES = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
PERSON = 0


class _TrackStats:
    __slots__ = ("first_seen", "positions", "fast_frames", "flags")

    def __init__(self, now):
        self.first_seen = now
        self.positions = deque(maxlen=60)   # (t, x, y, box_h)
        self.fast_frames = 0
        self.flags = set()


class AnomalyPipeline(DetectionPipeline):
    mode = "anomaly"
    model_names = ("yolo26n",)

    def on_start(self):
        c = self.config
        self.warmup_s = float(c.get("anomaly_warmup_s", 60))
        self.loiter_s = float(c.get("anomaly_loiter_s", 20))
        self.speed_k = float(c.get("anomaly_speed_k", 4.0))
        self.min_speed = float(c.get("anomaly_min_speed", 1.2))   # body-heights / s
        self.stats: Dict[int, _TrackStats] = {}
        self.speeds: Dict[int, deque] = {k: deque(maxlen=600) for k in CLASSES}
        self.seen_classes = set()
        self.crowd_mean, self.crowd_var, self.crowd_n = 0.0, 1.0, 0
        self.last_crowd_event = 0.0
        self.t0 = time.monotonic()
        self.anomaly_count = 0

    def on_stop(self):
        self.stats = {}

    def on_loop_reset(self):
        super().on_loop_reset()
        self.stats.clear()   # identities restart; learned baselines are kept

    def extra_health(self):
        return {"learning": self._learning(), "anomalies": self.anomaly_count}

    def _learning(self) -> bool:
        return time.monotonic() - self.t0 < self.warmup_s

    def _speed_threshold(self, cls: int):
        s = self.speeds.get(cls)
        if s is None or len(s) < 50:
            return None
        arr = np.asarray(s)
        med = float(np.median(arr))
        mad = float(np.median(np.abs(arr - med))) * 1.4826 + 1e-6
        return max(med + self.speed_k * mad, self.min_speed)

    def _flag(self, out, track, st, kind, **fields):
        if kind in st.flags:
            return
        st.flags.add(kind)
        self.anomaly_count += 1
        out.alert_ids.add(int(track.track_id))
        out.events.append(self.make_event(
            "ANOMALY", track, anomaly_type=kind,
            object_class=CLASSES.get(int(track.class_id), "object"), **fields,
        ))

    def run(self, frame, packet) -> PipelineOutput:
        if self.should_detect(packet):
            dets = self.models["yolo26n"].detect(frame, classes=set(CLASSES))
            tracks = self.track(dets, packet)
        else:
            tracks = self.tracker.predict_only()

        now = packet.timestamp or time.time()
        learning = self._learning()
        out = PipelineOutput(tracks=tracks, class_names=dict(CLASSES))
        live = set()

        for t in tracks:
            tid, cls = int(t.track_id), int(t.class_id)
            live.add(tid)
            x1, y1, x2, y2 = t.bbox
            h = max(1.0, float(y2 - y1))
            foot = ((x1 + x2) / 2.0, float(y2))
            st = self.stats.get(tid)
            if st is None:
                st = self.stats[tid] = _TrackStats(now)
                if not learning and cls not in self.seen_classes:
                    self._flag(out, t, st, "UNUSUAL_OBJECT")
            if learning:
                self.seen_classes.add(cls)
            st.positions.append((now, foot[0], foot[1], h))

            # Speed over ~1 s, in body-heights per second
            old = next((p for p in st.positions if now - p[0] <= 1.0), None)
            if old is not None and now - old[0] > 0.3:
                speed = np.hypot(foot[0] - old[1], foot[1] - old[2]) / ((h + old[3]) / 2) / (now - old[0])
                thr = self._speed_threshold(cls)
                if thr is not None and not learning and speed > thr:
                    st.fast_frames += 1
                    if st.fast_frames >= 4:
                        self._flag(out, t, st, "ABNORMAL_MOTION", speed=round(float(speed), 2),
                                   speed_threshold=round(float(thr), 2))
                else:
                    st.fast_frames = 0
                    self.speeds[cls].append(float(speed))   # learn only non-anomalous motion

            # Loitering: a person present long, staying roughly in one area
            if cls == PERSON and now - st.first_seen > self.loiter_s and len(st.positions) > 10:
                xs = [p[1] for p in st.positions]
                ys = [p[2] for p in st.positions]
                if (max(xs) - min(xs)) < 2.5 * h and (max(ys) - min(ys)) < 1.5 * h:
                    self._flag(out, t, st, "LOITERING", dwell_s=round(now - st.first_seen, 1))

        for tid in list(self.stats):
            if tid not in live:
                del self.stats[tid]

        # Crowd size vs running baseline (EMA)
        persons = sum(1 for t in tracks if int(t.class_id) == PERSON)
        sigma = float(np.sqrt(self.crowd_var))
        if (not learning and self.crowd_n > 100 and persons >= self.crowd_mean + 3 * max(sigma, 1.0)
                and persons >= self.crowd_mean + 3 and now - self.last_crowd_event > 30):
            self.last_crowd_event = now
            self.anomaly_count += 1
            out.events.append(self.make_event(
                "ANOMALY", None, anomaly_type="CROWD_SURGE", persons=persons,
                baseline_mean=round(self.crowd_mean, 2), confidence=None,
            ))
        a = 0.02
        self.crowd_n += 1
        delta = persons - self.crowd_mean
        self.crowd_mean += a * delta
        self.crowd_var = (1 - a) * (self.crowd_var + a * delta * delta)

        out.analytics = {
            "learning": learning,
            "learning_remaining_s": max(0, round(self.warmup_s - (time.monotonic() - self.t0))),
            "objects": len(tracks),
            "persons": persons,
            "crowd_baseline": round(self.crowd_mean, 2),
            "anomalies": self.anomaly_count,
            "flagged_tracks": sorted(out.alert_ids),
        }
        return out
