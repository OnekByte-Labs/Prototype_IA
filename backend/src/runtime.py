"""
Main-process camera control service: API ↔ database ↔ worker pipeline
managers ↔ event/alert stores ↔ WebSocket clients.

    PATCH detection-mode ─▶ validate ─▶ persist (DB = source of truth)
                          ─▶ control message to the worker owning the camera
    worker "state" msgs   ─▶ real pipeline state (idle/starting/running/stopping/error)
    worker "event" msgs   ─▶ gate: only the camera's ACTIVE pipeline may emit
                          ─▶ DB events table + JSONL log + EventStore
                          ─▶ AlertStore for alert-worthy types ─▶ WebSocket
    worker "health" msgs  ─▶ per-camera STREAM status (source health merged with
                             the media server's view of the NVR) ─▶ DB + WebSocket
"""

import asyncio
import collections
import json
import logging
import threading
import time
import uuid
from typing import Dict, List, Optional

from src.pipelines.base import DETECTION_MODES

logger = logging.getLogger("runtime")

# Normalized event types that become operator alerts (existing alert feed)
ALERT_TYPES = {
    "PERIMETER_BREACH": ("intrusion", "perimeter breach"),
    "ANOMALY": ("anomaly", None),
}
ALERT_LABELS = {"PERIMETER_BREACH": "PERIMETER BREACH / INTRUSION", "ANOMALY": "BEHAVIOURAL ANOMALY"}
TRANSITIONAL = ("starting", "stopping")
GEOMETRY_MODES = {"intrusion": "zone", "vehicle_counting": "line", "person_counting": "line"}
STREAM_STATES = ("CONNECTED", "DEGRADED", "DISCONNECTED", "RECONNECTING", "ERROR")
# Browser WebRTC profiles → media-server path variant (see sources/media_server.py)
WEBRTC_PROFILES = {"sub": "", "main": "main", "main_h264": "h264"}


def camera_key(camera_id: str) -> str:
    """CAM-07 / cam-07 / cam_07 → cam_07"""
    n = int(camera_id.replace("-", "_").split("_")[-1])
    return f"cam_{n:02d}"


def camera_id_of(key: str) -> str:
    return f"CAM-{int(key.split('_')[-1]):02d}"


def alert_id(event_id: int) -> str:
    """Alerts are identified by the id of their row in the events table."""
    return f"INC-{event_id:06d}"


def parse_alert_id(value: str) -> int:
    """INC-000123 / 123 → 123 (ValueError otherwise)."""
    v = value.strip().upper()
    n = int(v[4:] if v.startswith("INC-") else v)
    if n <= 0:
        raise ValueError(value)
    return n


class ModeConflict(Exception):
    pass


class WsBroadcaster:
    """Thread-safe fan-out from worker/collector threads to WebSocket clients."""

    def __init__(self):
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.clients: set = set()

    def attach(self, loop):
        self.loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.clients.add(q)
        return q

    def unsubscribe(self, q) -> None:
        self.clients.discard(q)

    def publish(self, message: dict) -> None:
        if self.loop is None or not self.clients:
            return
        data = json.dumps(message, default=str)
        self.loop.call_soon_threadsafe(self._fanout, data)

    def _fanout(self, data: str) -> None:
        for q in list(self.clients):
            if q.full():            # slow client: drop its oldest message
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(data)


class OfflineRuntime:
    """Runtime stand-in for mock mode: the command-center database and the
    administration layer are available, but no inference pipeline is attached
    (every view reports no running pipelines; mode switches are refused)."""

    def __init__(self, db):
        self.db = db
        self.cams: Dict[str, dict] = {}
        self.owner: Dict[str, int] = {}
        self.ctrl_qs: list = []
        self.health: dict = {}
        self.ws = WsBroadcaster()
        self.evidence = None
        self.admin = None
        self.map = None
        self.situation = None
        self.worker_pids: Dict[int, int] = {}
        self.stream_paths: Dict[str, str] = {}
        self.media = None

    def get(self, camera_id: str) -> dict:
        raise KeyError(f"{camera_id}: no live pipeline in mock mode")

    def request_mode(self, camera_id: str, mode: str) -> dict:
        raise KeyError(f"{camera_id}: no live pipeline in mock mode")

    def resync_from_db(self) -> dict:
        return {"modes_switched": 0, "geometry_pushed": 0, "note": "mock mode: no pipelines"}


class CameraControlService:
    def __init__(self, db, cameras: List[dict], owner: Dict[str, int], ctrl_qs, alert_store,
                 event_store, events_file, sources: Dict[str, dict]):
        self.db = db
        self.owner = owner
        self.ctrl_qs = ctrl_qs
        self.alert_store = alert_store
        self.event_store = event_store
        self.events_file = events_file
        self.ws = WsBroadcaster()
        self._lock = threading.Lock()
        self._pending_events: list = []
        self.dropped_events = 0
        self.health: dict = {}
        self.map = None                      # MapService (tactical GIS status), attached by run_live
        self.evidence = None                 # EvidenceStore (alert snapshots), attached by run_live
        self.admin = None                    # AdminService (config, alert policy, RBAC), attached by run_live
        self.media = None                    # MediaServer (live NVR streams), attached by run_live
        self.situation = None                # SituationService (alerts / incidents / device health), attached by run_live
        self.ingest: dict = {}               # streams.yaml `ingest` settings, attached by run_live
        self.worker_pids: Dict[int, int] = {}
        self.stream_paths: Dict[str, str] = {
            s: f"{v['nvr_id']} channel {v['channel']} subtype {v['subtype']} (media server path {v['path']})"
            for s, v in sources.items()}
        self.alert_latencies: collections.deque = collections.deque(maxlen=200)   # decode → alert broadcast (ms)
        self.open_streams = None             # MJPEG / SSE counters, attached by the output server
        self.started_at = time.time()
        self.cams: Dict[str, dict] = {}
        for c in cameras:
            key = camera_key(c["camera_id"])
            src = sources[c["source_id"]]
            self.cams[key] = {
                "camera_id": c["camera_id"], "key": key, "name": c["name"], "source_id": c["source_id"],
                "detection_mode": c["detection_mode"],   # persisted / requested
                "active_mode": None,                     # mode of the pipeline actually attached
                "state": "idle", "error": None, "generation": 0, "state_ts": time.time(),
                "width": src["width"], "height": src["height"],
                "source_type": src.get("type", "rtsp"), "nvr_id": src.get("nvr_id"), "decoding": False,
                "channel": src.get("channel"), "subtype": src.get("subtype"), "codec": src.get("codec"),
                "stream": {"status": "RECONNECTING", "reason": "connecting", "since": time.time()},
            }

    # ── API operations ───────────────────────────────────────────────

    def get(self, camera_id: str) -> dict:
        key = camera_key(camera_id)
        if key not in self.cams:
            raise KeyError(camera_id)
        return self.cams[key]

    def request_mode(self, camera_id: str, mode: str) -> dict:
        if mode not in DETECTION_MODES:
            raise ValueError(f"Invalid mode '{mode}'. Valid: {', '.join(DETECTION_MODES)}")
        cam = self.get(camera_id)
        with self._lock:
            if cam["state"] in TRANSITIONAL:
                raise ModeConflict(f"{cam['camera_id']} is {cam['state']} — wait for the current switch to finish")
            self.db.set_mode(cam["camera_id"], mode)          # persist first: DB is the truth
            cam["detection_mode"] = mode
            request_id = uuid.uuid4().hex[:12]
            if cam["active_mode"] == mode and cam["state"] in ("running", "idle"):
                return {**self.public(cam), "request_id": request_id, "changed": False}
            # Optimistic transitional state until the worker reports back
            cam["state"] = "stopping" if cam["active_mode"] not in (None, "none") else "starting"
            cam["error"] = None
            cam["state_ts"] = time.time()
        self.ctrl_qs[self.owner[cam["key"]]].put(("mode", cam["key"], {"mode": mode, "request_id": request_id}))
        self.ws.publish({"type": "pipeline_state", **self.public(cam), "request_id": request_id})
        logger.info("Mode change requested: %s → %s (request %s)", cam["camera_id"], mode, request_id)
        return {**self.public(cam), "request_id": request_id, "changed": True}

    def restart(self, camera_id: str) -> dict:
        cam = self.get(camera_id)
        self.ctrl_qs[self.owner[cam["key"]]].put(("restart", cam["key"], None))
        return self.public(cam)

    def set_geometry(self, camera_id: str, zone=..., line=...) -> dict:
        cam = self.get(camera_id)
        geom = self.db.set_geometry(cam["camera_id"], zone=zone, line=line)
        self.ctrl_qs[self.owner[cam["key"]]].put(("geometry", cam["key"], geom))
        self.ws.publish({"type": "geometry", "camera_id": cam["camera_id"], **geom})
        return geom

    # ── worker messages ──────────────────────────────────────────────

    def on_state(self, msg: dict) -> None:
        cam = self.cams.get(msg["camera_key"])
        if cam is None:
            return
        with self._lock:
            cam["state"] = msg["state"]
            cam["error"] = msg.get("error")
            cam["generation"] = msg.get("generation", cam["generation"])
            cam["state_ts"] = msg.get("ts", time.time())
            # The attached pipeline's mode: set once it runs, cleared when it goes
            if msg["state"] in ("running", "stopping"):
                cam["active_mode"] = msg["mode"]
            elif msg["state"] in ("idle", "error", "starting"):
                cam["active_mode"] = "none" if msg["state"] == "idle" else None
        self.ws.publish({"type": "pipeline_state", **self.public(cam), "request_id": msg.get("request_id")})
        logger.info("[%s] pipeline %s → %s%s", cam["camera_id"], msg["mode"], msg["state"],
                    f" ({msg['error']})" if msg.get("error") else "")

    def on_event(self, ev: dict) -> None:
        # Annotated frame the worker captured for an alert (bytes: never serialized)
        snapshot = ev.pop("_snapshot", None)
        cam = self.cams.get(camera_key(ev["camera_id"]))
        # Only the camera's active pipeline may produce events
        if cam is None or ev.get("detection_mode") != cam["active_mode"] or cam["state"] not in ("running", "stopping"):
            self.dropped_events += 1
            logger.warning("Dropped event %s from inactive %s pipeline on %s",
                           ev.get("event_type"), ev.get("detection_mode"), ev.get("camera_id"))
            return
        alert_cls = ALERT_TYPES.get(ev["event_type"])
        severity = None
        if alert_cls and self.admin is not None:
            # Alert policy (enabled / arming schedule / cooldown): a suppressed
            # alert's event is still stored like any other event
            severity = self.admin.alert_gate(ev)
            if severity is None:
                alert_cls = None
        if alert_cls:
            if snapshot and self.evidence is not None:
                rel = self.evidence.save(snapshot["jpeg"], ev["camera_id"], ev.get("frame_id"), ev["timestamp"])
                if rel:
                    ev["snapshot"] = {"file": rel, "width": snapshot["width"], "height": snapshot["height"]}
            if ev["detection_mode"] == "intrusion":
                # Restricted zone in force when the breach fired (native pixels)
                geom = self.db.geometry(cam["camera_id"])
                ev["restricted_zone"] = {"polygon": geom["zone"], "buffer_px": geom["buffer_px"]}
            # Alert events are written immediately: their row id is the alert's durable id
            ev["event_id"] = self.db.insert_event(ev)
        else:
            with self._lock:
                self._pending_events.append(ev)
        self.event_store.add(ev)
        self.events_file.write(json.dumps(ev) + "\n")
        self.ws.publish({"type": "event", "event": ev})
        if alert_cls:
            cls, label = alert_cls
            site = self.db.camera_site(cam["camera_id"])
            alert = self.alert_store.add({
                "alert_id": alert_id(ev["event_id"]), "event_id": ev["event_id"],
                "camera_id": ev["camera_id"], "stream_id": cam["key"], "detection_mode": ev["detection_mode"],
                "class": cls, "label": label or ev.get("anomaly_type", ev["event_type"]).lower().replace("_", " "),
                "event_type": ev["event_type"], "anomaly_type": ev.get("anomaly_type"),
                "object_class": ev.get("object_class"),
                "confidence": round((ev.get("confidence") or 0.9) * 100, 1),
                "object_id": ev.get("track_id"), "zone_id": ev.get("zone_id"),
                "bounding_box": ev.get("bounding_box"), "ts": ev["timestamp"],
                "camera_name": site.get("camera_name") or cam["name"], "post_id": site.get("post_id"),
                "post_name": site.get("post_name"), "company_id": site.get("company_id"),
                "company_name": site.get("company_name"), "has_snapshot": "snapshot" in ev,
                "severity": severity,
            })
            if self.situation is not None:
                try:
                    alert["incident_id"] = self.situation.record_alert(alert, ev)
                except Exception:
                    logger.exception("Could not record alert %s", alert["alert_id"])
            self.ws.publish({"type": "alert", "alert": alert})
            if ev.get("decoded_at"):
                ms = (time.time() - ev["decoded_at"]) * 1000
                self.alert_latencies.append(ms)
                cam["alert_latency_ms"] = round(ms, 1)
            self.events_file.write(json.dumps({"type": "alert", **alert}) + "\n")
            if self.map is not None:
                self.map.on_alert(alert)

    def alert_detail(self, event_id: int) -> Optional[dict]:
        """Everything stored for one alert: its event row, camera, place in the
        tactical hierarchy, restricted zone and evidence snapshot."""
        ev = self.db.event(event_id)
        if ev is None or ev.get("event_type") not in ALERT_TYPES:
            return None
        cls, _ = ALERT_TYPES[ev["event_type"]]
        cam_id = ev["camera_id"]
        cam = self.cams.get(camera_key(cam_id)) or {}
        site = self.db.camera_site(cam_id)
        snap = ev.get("snapshot") or {}
        snap_ok = self.evidence is not None and self.evidence.path(snap.get("file")) is not None
        zone = ev.get("restricted_zone")
        if zone is None and ev["detection_mode"] == "intrusion":
            # Breaches recorded before zones were stamped on the event: current zone
            geom = self.db.geometry(cam_id)
            zone = {"polygon": geom["zone"], "buffer_px": geom["buffer_px"], "current": True}
        conf = ev.get("confidence")
        mode = ev["detection_mode"]
        return {
            **(self.situation.alert_extra(event_id) if self.situation is not None else {}),
            "alert_id": alert_id(event_id),
            "event_id": event_id,
            "class": cls,
            "event_type": ev["event_type"],
            "event_label": ALERT_LABELS.get(ev["event_type"], ev["event_type"].replace("_", " ")),
            "anomaly_type": ev.get("anomaly_type"),
            # The intrusion pipeline only tracks persons (YOLO class 0)
            "object_class": ev.get("object_class") or ("person" if mode == "intrusion" else None),
            "confidence": round(conf * 100, 1) if conf is not None else None,
            "detection_mode": mode,
            "detection_mode_label": DETECTION_MODES.get(mode, mode),
            "timestamp": ev["timestamp"],
            "track_id": ev.get("track_id"),
            "bounding_box": ev.get("bounding_box"),
            "foot_point": ev.get("location"),
            "frame_id": ev.get("frame_id"),
            "pipeline_generation": ev.get("generation"),
            "camera": {
                "camera_id": cam_id,
                "name": site.get("camera_name") or cam.get("name"),
                "source_id": cam.get("source_id"),
                "width": cam.get("width"), "height": cam.get("height"),
                "current_mode": cam.get("detection_mode"),
                "pipeline_state": cam.get("state"),
            },
            "site": {k: site.get(k) for k in ("post_id", "post_name", "company_id", "company_name",
                                              "battalion_id", "battalion_name", "latitude", "longitude")},
            "restricted_zone": {
                "zone_id": ev.get("zone_id"),
                "polygon": (zone or {}).get("polygon"),
                "buffer_px": (zone or {}).get("buffer_px"),
                "is_current_config": bool((zone or {}).get("current")),
            } if ev.get("zone_id") or zone else None,
            "snapshot": {
                "available": snap_ok,
                "url": f"/api/v1/alerts/{alert_id(event_id)}/snapshot" if snap_ok else None,
                "width": snap.get("width"), "height": snap.get("height"),
            },
        }

    def resync_from_db(self) -> dict:
        """After a database restore: bring every camera's pipeline and geometry
        back in line with the (restored) database."""
        modes, geoms = 0, 0
        for c in self.db.cameras():
            key = camera_key(c["camera_id"])
            cam = self.cams.get(key)
            if cam is None:
                continue
            self.ctrl_qs[self.owner[key]].put(("geometry", key, self.db.geometry(c["camera_id"])))
            geoms += 1
            if c["detection_mode"] != cam["detection_mode"]:
                try:
                    self.request_mode(c["camera_id"], c["detection_mode"])
                    modes += 1
                except (ModeConflict, ValueError):
                    logger.warning("Resync: %s busy, mode left for the next switch", c["camera_id"])
        return {"modes_switched": modes, "geometry_pushed": geoms}

    def on_health(self, worker_idx: int, health: dict) -> None:
        self.health[worker_idx] = health
        pipes = health.get("cameras", {})
        changed, batch = [], {}
        for key, cam in self.cams.items():
            src = (health.get("sources") or {}).get(cam["source_id"])
            if src is None:
                continue
            cam["decoding"] = bool(src.get("decoding", True))
            stream = self._stream_view(cam, src, pipes.get(key) or {})
            prev = cam["stream"]
            if stream["status"] != prev.get("status"):
                stream["since"] = time.time()
                changed.append((cam, prev.get("status"), stream))
            else:
                stream["since"] = prev.get("since", time.time())
            cam["stream"] = stream
            if src.get("width") and src.get("height"):
                cam["width"], cam["height"] = int(src["width"]), int(src["height"])
            cam["codec"] = src.get("codec") or cam.get("codec")
            batch[cam["camera_id"]] = stream
        for cam, before, stream in changed:
            try:
                self.db.set_stream_status(cam["camera_id"], stream["status"])
            except Exception:
                logger.exception("Could not persist stream status of %s", cam["camera_id"])
            logger.info("[%s] stream %s → %s%s", cam["camera_id"], before, stream["status"],
                        f" ({stream['reason']})" if stream.get("reason") else "")
            self.ws.publish({"type": "stream_status", "camera_id": cam["camera_id"], **stream})
        if batch:
            self.ws.publish({"type": "stream_health", "cameras": batch})

    def _stream_view(self, cam: dict, src: dict, pipe: dict) -> dict:
        """Operator-facing stream status: the source's own health merged with
        what the media server sees of the upstream NVR connection."""
        state, reason = src.get("state"), src.get("last_error")
        path = self.media.path_status(cam["source_id"]) if self.media is not None and cam["source_type"] == "rtsp" else {}
        age = src.get("last_frame_age_s")
        decoding = bool(src.get("decoding", True))
        if not decoding:
            # Not decoded here (no pipeline / MJPEG viewer): the media server
            # still pulls the channel, so its health is the stream's health
            seen = path.get("ready_at")
            age = time.time() - seen if seen else None
            if path.get("ready"):
                status, reason = "CONNECTED", None
            elif path.get("permanent_error"):
                status, reason = "ERROR", path["permanent_error"]
            else:
                if path.get("source_error"):
                    reason = f"NVR: {path['source_error']}"
                limit = float(self.ingest.get("disconnected_after_s", 30))
                lost_for = age if age is not None else time.time() - self.started_at
                status = "DISCONNECTED" if lost_for > limit else "RECONNECTING"
            return {
                "status": status, "reason": reason, "source_type": cam["source_type"], "decoding": False,
                "fps": None, "target_fps": src.get("target_fps"), "last_frame_at": seen, "last_frame_age_s": age,
                "reconnects": src.get("reconnects") or 0,
                "upstream_reconnects": max(0, (path.get("upstream_connects") or 0) - 1), "latency_ms": None,
                "codec": path.get("codec") or src.get("codec"), "decoder": None,
                "width": path.get("width") or src.get("width"), "height": path.get("height") or src.get("height"),
                "bitrate_kbps": path.get("bitrate_kbps"), "rtp_lost": path.get("rtp_lost"),
                "viewers": path.get("readers"),
            }
        if state in ("CONNECTED", "DEGRADED"):
            status, reason = state, (None if state == "CONNECTED" else
                                     f"{src.get('fps', 0):.1f} fps" + (f", last frame {age:.1f}s ago" if age else ""))
        elif state == "ERROR":
            status = "ERROR"
        elif path.get("permanent_error") and not path.get("ready"):
            status, reason = "ERROR", path["permanent_error"]
        else:
            lost_for = age if age is not None else time.time() - self.started_at
            if path.get("source_error") and not path.get("ready"):
                reason = f"NVR: {path['source_error']}"
            limit = float(self.ingest.get("disconnected_after_s", 30))
            status = "DISCONNECTED" if state == "STOPPED" or lost_for > limit else "RECONNECTING"
        return {
            "status": status, "reason": reason, "source_type": cam["source_type"], "decoding": True,
            "fps": src.get("fps"), "target_fps": src.get("target_fps"),
            "last_frame_at": src.get("last_frame_at"), "last_frame_age_s": age,
            "reconnects": src.get("reconnects", 0), "upstream_reconnects": max(0, (path.get("upstream_connects") or 0) - 1),
            "latency_ms": pipe.get("latency_ms"),
            "codec": src.get("codec"), "decoder": src.get("decoder"), "width": src.get("width"),
            "height": src.get("height"), "bitrate_kbps": path.get("bitrate_kbps"),
            "rtp_lost": path.get("rtp_lost"), "viewers": path.get("readers"),
        }

    def add_viewer(self, key: str, clean: bool, delta: int) -> None:
        """MJPEG viewer (dis)connected: workers JPEG-encode a camera only while watched."""
        cam = self.cams.get(key)
        if cam is None:
            return
        with self._lock:
            v = cam.setdefault("viewers", {"mjpeg": 0, "clean": 0, "sent": None})
            v["clean" if clean else "mjpeg"] = max(0, v["clean" if clean else "mjpeg"] + delta)
            want = {"jpeg": v["mjpeg"] + v["clean"] > 0, "clean": v["clean"] > 0}
            if want == v["sent"]:
                return
            v["sent"] = want
        self.ctrl_qs[self.owner[key]].put(("viewers", key, want))

    def feed_age(self, key: str, frame_age: Optional[float]) -> Optional[float]:
        """Seconds since the camera's live feed was last seen: decoded-frame
        age while decoding, else since the media server last saw the channel up."""
        cam = self.cams.get(key)
        if cam is None:
            return None
        if cam.get("decoding"):
            return frame_age
        st = self.media.path_status(cam["source_id"]) if self.media is not None else {}
        if st.get("ready"):
            return 0.0                       # up at the media server's last check (every 2 s)
        return time.time() - st["ready_at"] if st.get("ready_at") else None

    def _is_file_source(self, cam: dict) -> bool:
        nvr = self.media.nvrs.get(cam.get("nvr_id") or "") if self.media is not None else None
        return bool(nvr and nvr.is_file)

    def webrtc_path(self, camera_id: str, profile: str) -> str:
        """Media-server path a browser may play for this camera (no URL, no credentials)."""
        cam = self.get(camera_id)
        if self.media is None or cam["source_type"] != "rtsp":
            raise LookupError(f"{cam['camera_id']} is not a live camera")
        if profile not in WEBRTC_PROFILES:
            raise ValueError(f"Unknown profile {profile!r} (sub | main | main_h264)")
        if profile == "main_h264" and self._is_file_source(cam):
            raise LookupError("A file source is already H.264: use the main profile")
        if profile == "main_h264" and self.media.transcode != "h264_nvenc":
            raise LookupError("H.264 transcoding for browsers is disabled (media_server.browser_transcode)")
        from src.sources.media_server import path_name
        return path_name(cam["nvr_id"], int(cam["channel"]), WEBRTC_PROFILES[profile])

    def streams_view(self) -> dict:
        return {
            "cameras": {c["camera_id"]: {**c["stream"], "nvr_id": c["nvr_id"], "channel": c["channel"],
                                         "subtype": c["subtype"], "source_id": c["source_id"]}
                        for c in self.cams.values()},
            "media_server": self.media.health() if self.media is not None else None,
            "nvrs": [n.public() for n in self.media.nvrs.values()] if self.media is not None else [],
            "states": list(STREAM_STATES),
        }

    def flush(self) -> None:
        """Batch-write pending events to the database (collector thread)."""
        with self._lock:
            batch, self._pending_events = self._pending_events, []
        if batch:
            self.db.insert_events(batch)
            self.events_file.flush()

    # ── views ────────────────────────────────────────────────────────

    def public(self, cam: dict) -> dict:
        return {
            "camera_id": cam["camera_id"], "name": cam["name"], "source_id": cam["source_id"],
            "detection_mode": cam["detection_mode"], "detection_mode_label": DETECTION_MODES[cam["detection_mode"]],
            "active_mode": cam["active_mode"], "state": cam["state"], "error": cam["error"],
            "generation": cam["generation"], "state_since": cam["state_ts"],
            "source_type": cam["source_type"], "stream_status": cam["stream"]["status"],
        }

    def describe_cameras(self, base_url: str) -> List[dict]:
        out = []
        for key, cam in self.cams.items():
            geom = self.db.geometry(cam["camera_id"])
            mode = cam["detection_mode"]
            kind = GEOMETRY_MODES.get(mode)
            analytics = None
            if kind == "zone":
                analytics = {"type": "intrusion_zone", "zone": geom["zone"], "buffer_px": geom["buffer_px"]}
            elif kind == "line":
                analytics = {"type": "traffic_count", "line": geom["line"], "zone": geom["zone"]}
            stream = cam["stream"]
            live = cam["source_type"] == "rtsp"
            out.append({
                "id": cam["camera_id"], "streamId": key, "label": f"{cam['camera_id']} · {cam['name']}",
                "online": stream["status"] in ("CONNECTED", "DEGRADED"), "aiEnabled": mode != "none",
                # Source binding (no URLs / credentials — browsers play through /webrtc)
                "sourceType": cam["source_type"], "nvrId": cam["nvr_id"], "channel": cam["channel"],
                "subtype": cam["subtype"], "codec": cam.get("codec"),
                "stream": {k: stream.get(k) for k in ("status", "reason", "since", "fps", "target_fps",
                                                      "last_frame_age_s", "reconnects", "upstream_reconnects",
                                                      "latency_ms", "codec", "decoder", "bitrate_kbps")},
                "webrtcProfiles": ([p for p in WEBRTC_PROFILES if p != "main_h264" or
                                    (self.media is not None and self.media.transcode == "h264_nvenc"
                                     and not self._is_file_source(cam))]
                                   if live else []),
                "width": cam["width"], "height": cam["height"],
                "mjpegUrl": f"{base_url}/stream/{key}", "metadataUrl": f"{base_url}/metadata/{key}",
                "detectionMode": mode, "activeMode": cam["active_mode"], "pipelineState": cam["state"],
                "pipelineError": cam["error"], "stateSince": cam["state_ts"], "intrusion": mode == "intrusion",
                "geometry": geom, "analytics": analytics,
            })
        return out

    def health_view(self) -> dict:
        cams, models = {}, {}
        for idx, h in sorted(self.health.items()):
            for key, c in h.get("cameras", {}).items():
                cams[c["camera_id"]] = {**c, "worker": idx, "stream": (self.cams.get(key) or {}).get("stream")}
            models[f"worker_{idx}"] = h.get("models", {})
        return {"cameras": cams, "models_loaded": models, "dropped_inactive_events": self.dropped_events,
                "media_server": self.media.health() if self.media is not None else None}
