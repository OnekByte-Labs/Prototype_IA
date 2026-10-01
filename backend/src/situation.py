"""
Operational situation: the persisted alert / incident / device-health record
and the read model over it. Shared by the REST API (situation_api.py) and the
Argus Agent's tools — both answer from exactly the same queries.

  runtime.on_event (raised alert) ─▶ record_alert ─▶ alerts + incidents (SQLite)
  health loop (every few s)       ─▶ map health view (cameras, company recorders)
                                     + ingest-NVR roll-up of live stream status
                                   ─▶ device_status (current) + device_health (transitions)

Incidents group the alerts of one camera and class while they keep coming: an
alert joins the camera's open incident if it fires within ``gap_s`` of that
incident's last alert, otherwise it opens a new one. An incident is ACTIVE
until ``gap_s`` passes without a new alert, then CLOSED.

Everything returned here is real pipeline output; when something is not known
(no live runtime, no history) the result says so instead of filling a value in.
"""

import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

from src.runtime import ALERT_LABELS, ALERT_TYPES, alert_id, camera_key, parse_alert_id

logger = logging.getLogger("situation")

ONLINE, DEGRADED, OFFLINE = "ONLINE", "DEGRADED", "OFFLINE"
SEV_RANK = {None: -1, "low": 0, "med": 1, "high": 2}
CONNECTED_STREAM = ("CONNECTED", "DEGRADED")

PERIODS = {
    "last_15m": 15 * 60, "last_30m": 30 * 60, "last_hour": 3600, "last_6h": 6 * 3600,
    "last_24h": 24 * 3600, "last_7d": 7 * 86400,
}
PERIOD_NAMES = tuple(PERIODS) + ("today", "yesterday", "all")


# ── identifiers / formatting ─────────────────────────────────────────

def incident_ref(n: int) -> str:
    return f"INCD-{int(n):06d}"


def parse_incident_id(value) -> int:
    """INCD-000042 / incd-42 / 42 → 42 (ValueError otherwise)."""
    v = str(value).strip().upper().replace(" ", "")
    m = re.fullmatch(r"(?:INCD-?|INCIDENT-?)?0*(\d+)", v)
    if not m or int(m.group(1)) <= 0:
        raise ValueError(value)
    return int(m.group(1))


def normalize_camera_id(value) -> Optional[str]:
    """CAM-9 / cam_09 / cam 9 / 9 → CAM-09 (None if it is not a camera id)."""
    v = str(value or "").strip().upper()
    m = re.fullmatch(r"(?:CAM(?:ERA)?[\s_-]*)?0*(\d{1,3})", v)
    return f"CAM-{int(m.group(1)):02d}" if m else None


def fmt_time(epoch: Optional[float]) -> Optional[str]:
    """Local wall-clock time the operators read: 2026-10-01 16:37:59 IST."""
    if epoch is None:
        return None
    return time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(epoch))


def iso_to_epoch(iso: str) -> float:
    d = datetime.fromisoformat(iso)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


def epoch_to_iso(epoch: float) -> str:
    """Same format as stored event timestamps (lexicographically comparable)."""
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="microseconds")


def fmt_duration(seconds: Optional[float]) -> Optional[str]:
    if seconds is None:
        return None
    s = int(max(0, seconds))
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60}m {s % 60:02d}s"
    if s < 86400:
        return f"{s // 3600}h {(s % 3600) // 60:02d}m"
    return f"{s // 86400}d {(s % 86400) // 3600}h"


def _parse_local(value: str) -> float:
    """ISO date/time from a user or the model; naive values are local time."""
    v = str(value).strip().replace("Z", "+00:00")
    if re.fullmatch(r"\d{1,2}:\d{2}(:\d{2})?", v):           # a time today
        v = f"{datetime.now():%Y-%m-%d}T{v}"
    d = datetime.fromisoformat(v)
    return d.timestamp() if d.tzinfo else time.mktime(d.timetuple()) + d.microsecond / 1e6


def resolve_window(period: Optional[str] = None, since_minutes: Optional[float] = None,
                   start: Optional[str] = None, end: Optional[str] = None,
                   default: Optional[str] = "last_24h") -> Tuple[Optional[float], float, str]:
    """(since, until, human label) of a time filter. Explicit start/end win,
    then since_minutes, then the named period."""
    now = time.time()
    until = now
    if end:
        until = _parse_local(end)
    if start:
        since = _parse_local(start)
        return since, until, f"{fmt_time(since)} to {fmt_time(until)}"
    if since_minutes:
        m = max(1.0, float(since_minutes))
        return now - m * 60, until, f"last {m:g} minutes"
    p = (period or default or "all").strip().lower()
    midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    if p in PERIODS:
        return now - PERIODS[p], until, p.replace("_", " ")
    if p == "today":
        return midnight.timestamp(), until, f"today (since {midnight:%H:%M} local)"
    if p == "yesterday":
        y = midnight - timedelta(days=1)
        return y.timestamp(), midnight.timestamp(), f"yesterday ({y:%Y-%m-%d})"
    if p == "all":
        return None, until, "all stored history"
    raise ValueError(f"Unknown period {period!r} (use one of: {', '.join(PERIOD_NAMES)})")


def _in(col: str, values: Iterable) -> Tuple[str, list]:
    vals = list(values)
    if not vals:
        return "0", []
    return f"{col} IN ({','.join('?' * len(vals))})", vals


# ── service ──────────────────────────────────────────────────────────

class SituationService:
    def __init__(self, db, runtime=None, map_service=None, admin=None, cfg: Optional[dict] = None,
                 events_log: Optional[Path] = None, evidence=None):
        cfg = cfg or {}
        self.db, self.runtime, self.map, self.admin = db, runtime, map_service, admin
        self.evidence = evidence if evidence is not None else getattr(runtime, "evidence", None)
        self.gap_s = float(cfg.get("incident_gap_s", 600))
        self.tick_s = float(cfg.get("health_tick_s", 5))
        self.grace_s = float(cfg.get("health_grace_s", 20))
        self.events_log = events_log
        self.started_at = time.time()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._live_cache: Tuple[float, Optional[dict]] = (0.0, None)
        self._sites_cache: Tuple[float, Dict[str, dict]] = (0.0, {})
        # last recorded status per entity + debounce candidates
        self._recorded: Dict[Tuple[str, str], str] = {
            (r["entity_type"], r["entity_id"]): r["status"]
            for r in db.query("SELECT entity_type, entity_id, status FROM device_status")}
        self._candidate: Dict[Tuple[str, str], Tuple[str, int]] = {}

    # ── lifecycle ────────────────────────────────────────────────────

    def start(self) -> None:
        try:
            self.backfill()
        except Exception:
            logger.exception("Alert / incident backfill failed")
        if self.map is None:
            return

        def loop():
            while not self._stop.wait(self.tick_s):
                try:
                    self.record_health()
                except Exception:
                    logger.exception("Device health recording failed")
        threading.Thread(target=loop, daemon=True, name="situation-health").start()

    def stop(self) -> None:
        self._stop.set()

    # ── alerts + incidents (write) ───────────────────────────────────

    def _attach(self, conn, a: dict, now: float) -> int:
        """Put one alert into its camera's incident (opening one if needed)."""
        row = conn.execute(
            "SELECT incident_id, opened_at, last_alert_at, severity, max_confidence, object_classes "
            "FROM incidents WHERE camera_id=? AND class=? ORDER BY last_alert_at DESC LIMIT 1",
            (a["camera_id"], a["class"])).fetchone()
        ts, obj = a["ts_epoch"], a.get("object_class")
        if row and 0 <= ts - row[2] <= self.gap_s or (row and row[1] <= ts <= row[2]):
            inc, _, last, sev, maxc, objs = row
            objs = set(json.loads(objs or "[]"))
            if obj:
                objs.add(obj)
            sev = a.get("severity") if SEV_RANK.get(a.get("severity"), -1) > SEV_RANK.get(sev, -1) else sev
            conf = a.get("confidence")
            maxc = conf if maxc is None or (conf is not None and conf > maxc) else maxc
            newest = ts >= last
            active = max(ts, last) >= now - self.gap_s
            conn.execute(
                "UPDATE incidents SET alert_count=alert_count+1, severity=?, max_confidence=?, object_classes=?, "
                "last_alert_at=?, last_alert_id=CASE WHEN ? THEN ? ELSE last_alert_id END, status=?, closed_at=? "
                "WHERE incident_id=?",
                (sev, maxc, json.dumps(sorted(objs)), max(ts, last), newest, a["alert_id"],
                 "active" if active else "closed", None if active else max(ts, last) + self.gap_s, inc))
            return inc
        active = ts >= now - self.gap_s
        return conn.execute(
            "INSERT INTO incidents(camera_id, class, status, severity, opened_at, last_alert_at, closed_at, "
            "alert_count, first_alert_id, last_alert_id, max_confidence, object_classes) "
            "VALUES (?,?,?,?,?,?,?,1,?,?,?,?)",
            (a["camera_id"], a["class"], "active" if active else "closed", a.get("severity"), ts, ts,
             None if active else ts + self.gap_s, a["alert_id"], a["alert_id"], a.get("confidence"),
             json.dumps([obj] if obj else []))).lastrowid

    _ALERT_COLS = ("alert_id", "camera_id", "class", "event_type", "label", "detection_mode", "object_class",
                   "confidence", "severity", "track_id", "zone_id", "ts", "ts_epoch", "snapshot_path")

    def _insert_alert(self, conn, a: dict, now: float) -> int:
        inc = self._attach(conn, a, now)
        conn.execute(
            f"INSERT OR REPLACE INTO alerts({', '.join(self._ALERT_COLS)}, incident_id) "
            f"VALUES ({', '.join('?' * (len(self._ALERT_COLS) + 1))})",
            (*[a.get(k) for k in self._ALERT_COLS], inc))
        return inc

    def record_alert(self, alert: dict, ev: dict) -> Optional[str]:
        """A raised alert (runtime.on_event): persist it and fold it into an incident.
        Returns the incident reference."""
        a = {
            "alert_id": alert["event_id"], "camera_id": alert["camera_id"], "class": alert["class"],
            "event_type": alert["event_type"], "label": alert.get("label"), "detection_mode": alert["detection_mode"],
            "object_class": alert.get("object_class") or ("person" if alert["detection_mode"] == "intrusion" else None),
            "confidence": alert.get("confidence"), "severity": alert.get("severity"), "track_id": alert.get("object_id"),
            "zone_id": alert.get("zone_id"), "ts": alert["ts"], "ts_epoch": iso_to_epoch(alert["ts"]),
            "snapshot_path": (ev.get("snapshot") or {}).get("file"),
        }
        now = time.time()
        inc = self.db.transaction(lambda conn: self._insert_alert(conn, a, now))
        return incident_ref(inc)

    def backfill(self) -> int:
        """One-time migration: raised alerts already stored as events become
        alerts + incidents. A raised alert's event carries its evidence
        snapshot or restricted-zone stamp; suppressed (cooldown / schedule)
        alert-type events carry neither and are not alerts."""
        if self.db.query_one("SELECT 1 AS x FROM alerts LIMIT 1"):
            return 0
        types, args = _in("event_type", ALERT_TYPES)
        rows = self.db.query(
            f"SELECT id, payload FROM events WHERE {types} AND (json_extract(payload, '$.snapshot') IS NOT NULL "
            "OR json_extract(payload, '$.restricted_zone') IS NOT NULL) ORDER BY timestamp", args)
        if not rows:
            return 0
        severities = self._logged_severities()
        policy = {}
        if self.admin is not None:
            policy = {k: v.get("severity") for k, v in (self.admin.cfg["alerts"]["policies"] or {}).items()}
        alerts = []
        for r in rows:
            ev = json.loads(r["payload"])
            cls, label = ALERT_TYPES[ev["event_type"]]
            conf = ev.get("confidence")
            alerts.append({
                "alert_id": r["id"], "camera_id": ev["camera_id"], "class": cls, "event_type": ev["event_type"],
                "label": label or (ev.get("anomaly_type") or ev["event_type"]).lower().replace("_", " "),
                "detection_mode": ev["detection_mode"],
                "object_class": ev.get("object_class") or ("person" if ev["detection_mode"] == "intrusion" else None),
                "confidence": round((conf if conf is not None else 0.9) * 100, 1),
                "severity": severities.get((r["id"], ev["timestamp"])) or policy.get(ev["event_type"]),
                "track_id": ev.get("track_id"), "zone_id": ev.get("zone_id"), "ts": ev["timestamp"],
                "ts_epoch": iso_to_epoch(ev["timestamp"]), "snapshot_path": (ev.get("snapshot") or {}).get("file"),
            })
        now = time.time()

        def write(conn):
            for a in alerts:
                self._insert_alert(conn, a, now)
        self.db.transaction(write)
        n_inc = self.db.query_one("SELECT COUNT(*) AS n FROM incidents")["n"]
        logger.info("Backfilled %d alerts into %d incidents from the events table", len(alerts), n_inc)
        return len(alerts)

    def _logged_severities(self) -> Dict[Tuple[int, str], str]:
        """Severity each alert was raised with, from the JSONL event log
        (keyed by event id + timestamp: ids may repeat across database restores)."""
        out: Dict[Tuple[int, str], str] = {}
        if not self.events_log or not self.events_log.is_file():
            return out
        try:
            with open(self.events_log, "rb") as f:
                for line in f:
                    if not line.startswith(b'{"type": "alert"'):
                        continue
                    try:
                        a = json.loads(line)
                    except ValueError:
                        continue
                    if a.get("severity") and a.get("event_id"):
                        out[(a["event_id"], a["ts"])] = a["severity"]
        except OSError:
            logger.warning("Could not read %s for alert severities", self.events_log)
        return out

    def acknowledge(self, alert_ids: List[int], by: str) -> int:
        ids, args = _in("alert_id", alert_ids)
        return self.db.execute(f"UPDATE alerts SET ack_by=?, ack_at=? WHERE {ids} AND ack_by IS NULL",
                               (by, time.time(), *args))

    def sweep(self) -> None:
        """Close incidents whose gap has expired."""
        now = time.time()
        self.db.execute("UPDATE incidents SET status='closed', closed_at=last_alert_at + ? "
                        "WHERE status='active' AND last_alert_at < ?", (self.gap_s, now - self.gap_s))

    # ── device health (write) ────────────────────────────────────────

    def _collect_health(self) -> Dict[Tuple[str, str], Tuple[str, Optional[str], dict]]:
        live = self.live(max_age=0)
        out = {}
        for cid, c in live["cameras"].items():
            out[("camera", cid)] = (c["status"], c["issue"], {k: c.get(k) for k in (
                "pipeline_state", "pipeline_error", "detection_mode", "stream_status", "stream_reason", "nvr_id",
                "channel", "frame_age_s")})
        for nid, n in live["recorders"].items():
            out[("recorder", nid)] = (n["status"], n["issue"], {k: n.get(k) for k in (
                "company_id", "assigned", "bound", "streaming", "affected")})
        for nid, n in live["ingest_nvrs"].items():
            out[("nvr", nid)] = (n["status"], n["issue"], {k: n.get(k) for k in (
                "channels_bound", "channels_connected", "failing")})
        return out

    def record_health(self) -> int:
        """Persist health transitions (debounced over two checks, after a start-up grace)."""
        now = time.time()
        self.sweep()
        if now - self.started_at < self.grace_s:
            return 0
        changes = []
        for key, (status, issue, detail) in self._collect_health().items():
            if self._recorded.get(key) == status:
                self._candidate.pop(key, None)
                continue
            cand = self._candidate.get(key)
            seen = cand[1] + 1 if cand and cand[0] == status else 1
            self._candidate[key] = (status, seen)
            if seen >= 2 or key not in self._recorded:
                changes.append((key, status, issue, detail))
        if not changes:
            return 0

        def write(conn):
            for (etype, eid), status, issue, detail in changes:
                prev = self._recorded.get((etype, eid))
                d = json.dumps(detail, default=str)
                conn.execute("INSERT INTO device_health(entity_type, entity_id, status, previous, issue, detail, ts) "
                             "VALUES (?,?,?,?,?,?,?)", (etype, eid, status, prev, issue, d, now))
                conn.execute(
                    "INSERT INTO device_status(entity_type, entity_id, status, issue, detail, since, checked_at) "
                    "VALUES (?,?,?,?,?,?,?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET status=excluded.status, "
                    "issue=excluded.issue, detail=excluded.detail, since=excluded.since, checked_at=excluded.checked_at",
                    (etype, eid, status, issue, d, now, now))
        self.db.transaction(write)
        for (etype, eid), status, _, _ in changes:
            self._recorded[(etype, eid)] = status
            self._candidate.pop((etype, eid), None)
        if len(changes) < 20:
            for (etype, eid), status, issue, _ in changes:
                logger.info("Health %s %s → %s%s", etype, eid, status, f" ({issue})" if issue else "")
        else:
            logger.info("Health: %d transitions recorded", len(changes))
        return len(changes)

    # ── live view (read) ─────────────────────────────────────────────

    def sites(self) -> Dict[str, dict]:
        """Camera → name, post, company (cached 10 s)."""
        ts, cached = self._sites_cache
        if cached and time.time() - ts < 10:
            return cached
        units = {u["unit_id"]: u for u in self.db.map_units()}
        out = {}
        for c in self.db.query("SELECT camera_id, name, post_id, nvr_id, channel, source_type, detection_mode, "
                               "source_id FROM cameras"):
            post = units.get(c["post_id"]) if c["post_id"] else None
            co = units.get(post["parent_id"]) if post else None
            out[c["camera_id"]] = {**c, "post_name": post["name"] if post else None,
                                   "company_id": co["unit_id"] if co else None,
                                   "company_name": co["name"] if co else None}
        self._sites_cache = (time.time(), out)
        return out

    def live(self, max_age: float = 2.0) -> dict:
        """Current health of every camera, company recorder and ingest NVR —
        from the running pipeline when there is one, else the last persisted state."""
        ts, cached = self._live_cache
        if cached is not None and time.time() - ts <= max_age:
            return cached
        view = self._live_runtime() if self.map is not None else self._live_persisted()
        self._live_cache = (time.time(), view)
        return view

    def _live_runtime(self) -> dict:
        hv = self.map.health_view()
        sites = self.sites()
        cams = {}
        for cid, h in hv["cameras"].items():
            rc = self.runtime.cams.get(camera_key(cid)) if self.runtime is not None else None
            s = sites.get(cid, {})
            stream = (rc or {}).get("stream") or {}
            cams[cid] = {
                "status": h["health"], "issue": h["issue"], "map_status": h["status"],
                "source_bound": h["source_bound"], "pipeline_state": h["pipeline_state"],
                "pipeline_error": h["pipeline_error"], "detection_mode": h["detection_mode"], "fps": h["fps"],
                "frame_age_s": h["frame_age_s"], "decoding": h["decoding"], "recording": h["recording"],
                "stream_status": stream.get("status") if rc else None, "stream_reason": stream.get("reason") if rc else None,
                "stream_since": stream.get("since") if rc else None, "reconnects": stream.get("reconnects") if rc else None,
                "nvr_id": s.get("nvr_id"), "channel": s.get("channel"),
            }
        recorders = {nid: {**n, "status": n["status"]} for nid, n in hv["nvrs"].items()}
        ingest = {}
        if self.runtime is not None and getattr(self.runtime, "media", None) is not None:
            for nid, nvr in self.runtime.media.nvrs.items():
                bound = [c for c in self.runtime.cams.values() if c.get("nvr_id") == nid]
                ok = [c for c in bound if c["stream"]["status"] in CONNECTED_STREAM]
                failing = [{"camera_id": c["camera_id"], "channel": c.get("channel"), "stream_status": c["stream"]["status"],
                            "reason": c["stream"].get("reason")} for c in bound if c not in ok]
                status = OFFLINE if not ok else ONLINE if len(ok) == len(bound) else DEGRADED
                pub = nvr.public()
                ingest[nid] = {
                    "status": status, "name": pub["name"], "vendor": pub.get("vendor"), "type": pub.get("type"),
                    "host": pub.get("host"), "channels": pub.get("channels"),
                    "credentials_configured": pub.get("credentials_configured"),
                    "channels_bound": len(bound), "channels_connected": len(ok), "failing": failing,
                    "issue": (None if status == ONLINE else "No camera channels bound" if not bound else
                              "No channel is streaming" if not ok else
                              f"{len(failing)} of {len(bound)} channels not streaming"),
                }
        return {"live": True, "checked_at": hv["checked_at"], "cameras": cams, "recorders": recorders,
                "ingest_nvrs": ingest, "storage": hv.get("storage")}

    def _live_persisted(self) -> dict:
        rows = self.db.query("SELECT * FROM device_status")
        out = {"camera": {}, "recorder": {}, "nvr": {}}
        checked = 0.0
        for r in rows:
            d = json.loads(r["detail"] or "{}")
            out.setdefault(r["entity_type"], {})[r["entity_id"]] = {**d, "status": r["status"], "issue": r["issue"],
                                                                    "since": r["since"]}
            checked = max(checked, r["checked_at"])
        for cid, s in self.sites().items():
            c = out["camera"].setdefault(cid, {"status": "UNKNOWN", "issue": "No health has been recorded yet"})
            c.setdefault("source_bound", bool(s.get("source_id")))
        return {"live": False, "checked_at": checked or None, "cameras": out["camera"], "recorders": out["recorder"],
                "ingest_nvrs": out["nvr"], "storage": None,
                "note": "AI pipeline is not running: last recorded device health is shown"}

    def _since(self, etype: str, eid: str) -> dict:
        """When the entity entered its current status. A status recorded without a
        previous one (monitoring just started) has no known start: only when it was
        first observed."""
        r = self.db.query_one("SELECT status, previous, ts FROM device_health WHERE entity_type=? AND entity_id=? "
                              "ORDER BY ts DESC LIMIT 1", (etype, eid))
        if r is None:
            return {}
        if r["previous"]:
            return {"status_since": fmt_time(r["ts"]), "previous_status": r["previous"]}
        return {"status_since": f"unknown: unchanged since health monitoring began at {fmt_time(r['ts'])}"}

    def history(self, etype: str, eid: str, limit: int = 8) -> List[dict]:
        rows = self.db.query("SELECT status, previous, issue, ts FROM device_health WHERE entity_type=? AND entity_id=? "
                             "ORDER BY ts DESC LIMIT ?", (etype, eid, limit))
        return [{"time": fmt_time(r["ts"]), "status": r["status"], "from": r["previous"] or "(monitoring started)",
                 "issue": r["issue"]} for r in rows]

    def status_at(self, etype: str, eid: str, epoch: float) -> Optional[dict]:
        r = self.db.query_one("SELECT status, issue, ts FROM device_health WHERE entity_type=? AND entity_id=? AND ts<=? "
                              "ORDER BY ts DESC LIMIT 1", (etype, eid, epoch))
        return {"status": r["status"], "issue": r["issue"], "recorded_since": fmt_time(r["ts"])} if r else None

    # ── read model: shared by REST + agent tools ─────────────────────

    def _scope(self, allowed: Optional[Set[str]], camera_ids: Iterable[str]) -> List[str]:
        return [c for c in camera_ids if allowed is None or c in allowed]

    def _alert_out(self, r: dict, sites: Dict[str, dict]) -> dict:
        s = sites.get(r["camera_id"], {})
        snap = bool(r.get("snapshot_path")) and self.evidence is not None and self.evidence.path(r["snapshot_path"]) is not None
        return {
            "alert_id": alert_id(r["alert_id"]), "time": fmt_time(r["ts_epoch"]), "camera_id": r["camera_id"],
            "camera_name": s.get("name"), "type": r["label"] or ALERT_LABELS.get(r["event_type"], r["event_type"]),
            "class": r["class"], "object": r["object_class"], "confidence_pct": r["confidence"],
            "severity": r["severity"], "track_id": r["track_id"],
            "incident_id": incident_ref(r["incident_id"]) if r.get("incident_id") else None,
            "acknowledged_by": r.get("ack_by"), "snapshot": snap,
        }

    def _incident_out(self, r: dict, sites: Dict[str, dict], now: float) -> dict:
        s = sites.get(r["camera_id"], {})
        active = r["status"] == "active"
        return {
            "incident_id": incident_ref(r["incident_id"]), "status": r["status"], "class": r["class"],
            "camera_id": r["camera_id"], "camera_name": s.get("name"), "post": s.get("post_name"),
            "company": s.get("company_name"), "severity": r["severity"], "alerts": r["alert_count"],
            "unacknowledged": r.get("unacked"),
            "opened": fmt_time(r["opened_at"]), "last_alert": fmt_time(r["last_alert_at"]),
            "last_alert_ago": fmt_duration(now - r["last_alert_at"]),
            "duration": fmt_duration((r["last_alert_at"] if not active else now) - r["opened_at"]),
            "closed": fmt_time(r["closed_at"]) if r["closed_at"] else None,
            "objects": json.loads(r["object_classes"] or "[]"), "max_confidence_pct": r["max_confidence"],
            "latest_alert_id": alert_id(r["last_alert_id"]),
        }

    def _camera_filter(self, camera_id: Optional[str], area: Optional[str],
                       allowed: Optional[Set[str]]) -> Optional[List[str]]:
        """Camera ids a query is restricted to (None = no restriction)."""
        cams: Optional[Set[str]] = None
        if camera_id:
            cid = normalize_camera_id(camera_id)
            if not cid:
                raise ValueError(f"{camera_id!r} is not a camera id (expected e.g. CAM-09)")
            cams = {cid}
        if area:
            needle = area.strip().lower()
            sites = self.sites()
            hit = {cid for cid, s in sites.items() if any(
                needle in (s.get(k) or "").lower() for k in ("name", "post_name", "company_name", "post_id", "company_id"))}
            cams = hit if cams is None else cams & hit
        if allowed is not None:
            cams = set(allowed) if cams is None else cams & allowed
        return None if cams is None else sorted(cams)

    def system_status(self, allowed: Optional[Set[str]] = None) -> dict:
        self.sweep()
        now = time.time()
        live = self.live()
        sites = self.sites()
        cams = {cid: c for cid, c in live["cameras"].items() if allowed is None or cid in allowed}
        bound = {cid: c for cid, c in cams.items() if c.get("source_bound")}
        by = lambda st: sorted(cid for cid, c in bound.items() if c["status"] == st)
        faults = [{"camera_id": cid, "camera_name": sites.get(cid, {}).get("name"), "status": c["status"],
                   "issue": c["issue"]} for cid, c in sorted(bound.items()) if c["status"] != ONLINE]
        running = [cid for cid, c in bound.items() if c.get("pipeline_state") == "running"]
        modes: Dict[str, int] = {}
        for cid in running:
            m = bound[cid].get("detection_mode") or "none"
            modes[m] = modes.get(m, 0) + 1
        pipe_errors = [{"camera_id": cid, "error": c.get("pipeline_error")} for cid, c in sorted(bound.items())
                       if c.get("pipeline_state") == "error"]

        cf = self._camera_filter(None, None, allowed)
        where, args = ("1", []) if cf is None else _in("camera_id", cf)
        midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        counts = self.db.query_one(
            f"SELECT SUM(ts_epoch >= ?) AS m15, SUM(ts_epoch >= ?) AS h1, SUM(ts_epoch >= ?) AS today, "
            f"MAX(ts_epoch) AS newest FROM alerts WHERE ts_epoch >= ? AND {where}",
            (now - 900, now - 3600, midnight, min(midnight, now - 3600), *args)) or {}
        active = self.db.query(
            f"SELECT i.*, (SELECT COUNT(*) FROM alerts a WHERE a.incident_id=i.incident_id AND a.ack_by IS NULL) AS unacked "
            f"FROM incidents i WHERE status='active' AND {where} ORDER BY last_alert_at DESC", args)
        newest = counts.get("newest") or self.db.query_one(
            f"SELECT MAX(ts_epoch) AS t FROM alerts WHERE {where}", args)["t"]
        recorders = {k: v for k, v in live["recorders"].items()}
        ingest = live["ingest_nvrs"]
        nvr_faults = ([{"nvr_id": k, "kind": "ingest NVR", "name": v.get("name"), "status": v["status"],
                        "issue": v.get("issue")} for k, v in sorted(ingest.items()) if v["status"] != ONLINE] +
                      [{"nvr_id": k, "kind": "company recorder", "name": v.get("name"), "status": v["status"],
                        "issue": v.get("issue")} for k, v in sorted(recorders.items()) if v["status"] != ONLINE])
        out = {
            "as_of": fmt_time(now), "data_source": "live pipeline" if live["live"] else "last recorded state",
            "cameras": {
                "registered": len(cams), "with_video_source": len(bound), "without_video_source": len(cams) - len(bound),
                "online": len(by(ONLINE)), "degraded": len(by(DEGRADED)), "offline": len(by(OFFLINE)),
                "alerting_now": sorted({r["camera_id"] for r in active}),
            },
            "camera_faults": faults[:15], "camera_faults_total": len(faults),
            "ai_pipelines": {"running": len(running), "by_mode": modes, "errors": pipe_errors},
            "nvrs": {"ingest_nvrs": {k: v["status"] for k, v in sorted(ingest.items())},
                     "company_recorders": {k: v["status"] for k, v in sorted(recorders.items())},
                     "faults": nvr_faults},
            "alerts": {"last_15_min": counts.get("m15") or 0, "last_hour": counts.get("h1") or 0,
                       "today": counts.get("today") or 0, "most_recent": fmt_time(newest) if newest else None},
            "active_incidents": [self._incident_out(r, sites, now) for r in active[:8]],
            "active_incidents_total": len(active),
            "incident_rule": f"an incident stays active until {fmt_duration(self.gap_s)} pass without a new alert",
        }
        if not live["live"]:
            out["note"] = live.get("note")
        return out

    def active_alerts(self, alert_class: Optional[str] = None, camera_id: Optional[str] = None,
                      limit: int = 10, allowed: Optional[Set[str]] = None) -> dict:
        self.sweep()
        now = time.time()
        sites = self.sites()
        cf = self._camera_filter(camera_id, None, allowed)
        conds, args = ["i.status='active'"], []
        if cf is not None:
            w, a = _in("i.camera_id", cf)
            conds.append(w)
            args += a
        if alert_class:
            conds.append("i.class=?")
            args.append(self._class(alert_class))
        incs = self.db.query(
            "SELECT i.*, (SELECT COUNT(*) FROM alerts a WHERE a.incident_id=i.incident_id AND a.ack_by IS NULL) AS unacked "
            f"FROM incidents i WHERE {' AND '.join(conds)} ORDER BY i.last_alert_at DESC", args)
        ids = [r["incident_id"] for r in incs]
        latest = []
        if ids:
            w, a = _in("incident_id", ids)
            latest = self.db.query(f"SELECT * FROM alerts WHERE {w} ORDER BY ts_epoch DESC LIMIT ?",
                                   (*a, max(1, min(int(limit), 25))))
        return {
            "as_of": fmt_time(now),
            "definition": f"active = alerts of incidents with a new alert in the last {fmt_duration(self.gap_s)}",
            "filters": {"class": alert_class, "camera_id": camera_id},
            "active_incidents": len(incs), "active_alerts": sum(r["alert_count"] for r in incs),
            "unacknowledged": sum(r["unacked"] for r in incs),
            "incidents": [self._incident_out(r, sites, now) for r in incs[:15]],
            "latest_alerts": [self._alert_out(r, sites) for r in latest],
        }

    @staticmethod
    def _class(value: str) -> str:
        v = value.strip().lower()
        if v in ("intrusion", "perimeter_breach", "perimeter breach", "breach", "intrusions"):
            return "intrusion"
        if v in ("anomaly", "anomalies", "behavioural anomaly", "behavioral anomaly"):
            return "anomaly"
        raise ValueError(f"Unknown alert class {value!r} (intrusion | anomaly)")

    def search_alerts(self, alert_class: Optional[str] = None, camera_id: Optional[str] = None,
                      period: Optional[str] = None, since_minutes: Optional[float] = None,
                      start: Optional[str] = None, end: Optional[str] = None, object_class: Optional[str] = None,
                      min_confidence: Optional[float] = None, severity: Optional[str] = None,
                      area: Optional[str] = None, acknowledged: Optional[bool] = None, limit: int = 10,
                      allowed: Optional[Set[str]] = None) -> dict:
        since, until, label = resolve_window(period, since_minutes, start, end)
        sites = self.sites()
        conds, args = ["ts_epoch <= ?"], [until]
        if since is not None:
            conds.append("ts_epoch >= ?")
            args.append(since)
        cf = self._camera_filter(camera_id, area, allowed)
        if cf is not None:
            w, a = _in("camera_id", cf)
            conds.append(w)
            args += a
        if alert_class:
            conds.append("class=?")
            args.append(self._class(alert_class))
        if object_class:
            conds.append("LOWER(object_class)=?")
            args.append(object_class.strip().lower().rstrip("s"))
        if min_confidence is not None:
            conds.append("confidence >= ?")
            args.append(float(min_confidence) * (100 if float(min_confidence) <= 1 else 1))
        if severity:
            conds.append("severity=?")
            args.append({"medium": "med"}.get(severity.lower(), severity.lower()))
        if acknowledged is not None:
            conds.append("ack_by IS NOT NULL" if acknowledged else "ack_by IS NULL")
        where = " AND ".join(conds)
        tot = self.db.query_one(f"SELECT COUNT(*) AS n, MIN(ts_epoch) AS first, MAX(ts_epoch) AS last, "
                                f"COUNT(DISTINCT incident_id) AS incidents FROM alerts WHERE {where}", args)
        by_class = {r["class"]: r["n"] for r in self.db.query(
            f"SELECT class, COUNT(*) AS n FROM alerts WHERE {where} GROUP BY class", args)}
        by_cam = self.db.query(f"SELECT camera_id, COUNT(*) AS n, MAX(ts_epoch) AS last FROM alerts WHERE {where} "
                               "GROUP BY camera_id ORDER BY n DESC", args)
        by_obj = {(r["object_class"] or "unknown"): r["n"] for r in self.db.query(
            f"SELECT object_class, COUNT(*) AS n FROM alerts WHERE {where} GROUP BY object_class", args)}
        newest = self.db.query(f"SELECT * FROM alerts WHERE {where} ORDER BY ts_epoch DESC LIMIT ?",
                               (*args, max(1, min(int(limit), 25))))
        out = {
            "window": label, "from": fmt_time(since) if since else None, "to": fmt_time(until),
            "filters": {k: v for k, v in {"class": alert_class, "camera_id": camera_id, "object": object_class,
                                          "min_confidence": min_confidence, "severity": severity, "area": area,
                                          "acknowledged": acknowledged}.items() if v is not None},
            "total_alerts": tot["n"], "incident_groups_active_or_closed": tot["incidents"],
            "first_alert": fmt_time(tot["first"]), "last_alert": fmt_time(tot["last"]),
            "by_class": by_class, "by_object": by_obj,
            "by_camera": [{"camera_id": r["camera_id"], "camera_name": sites.get(r["camera_id"], {}).get("name"),
                           "alerts": r["n"], "last_alert": fmt_time(r["last"])} for r in by_cam[:12]],
            "cameras_with_alerts": len(by_cam),
            "newest_alerts": [self._alert_out(r, sites) for r in newest],
        }
        if not tot["n"]:
            # Nothing in the window: when did the latest alert matching the other filters happen?
            wider = " AND ".join(c for c in conds if not c.startswith("ts_epoch"))
            wargs = args[1 + (since is not None):]
            prev = self.db.query_one(f"SELECT * FROM alerts WHERE {wider or '1'} ORDER BY ts_epoch DESC LIMIT 1", wargs)
            out["latest_matching_alert_before_window"] = self._alert_out(prev, sites) if prev else None
        if since is not None and until - since <= 48 * 3600 and tot["n"]:
            rows = self.db.query(f"SELECT CAST((ts_epoch - ?) / 3600 AS INTEGER) AS b, COUNT(*) AS n FROM alerts "
                                 f"WHERE {where} GROUP BY b ORDER BY b", (since, *args))
            out["by_hour"] = [{"hour_starting": time.strftime("%H:%M", time.localtime(since + r["b"] * 3600)),
                               "alerts": r["n"]} for r in rows]
        return out

    def list_incidents(self, status: Optional[str] = None, camera_id: Optional[str] = None,
                       period: Optional[str] = None, limit: int = 20, allowed: Optional[Set[str]] = None) -> dict:
        self.sweep()
        now = time.time()
        since, until, label = resolve_window(period, default="all")
        conds, args = ["i.opened_at <= ?"], [until]
        if since is not None:
            conds.append("i.last_alert_at >= ?")
            args.append(since)
        if status:
            conds.append("i.status=?")
            args.append(status.lower())
        cf = self._camera_filter(camera_id, None, allowed)
        if cf is not None:
            w, a = _in("i.camera_id", cf)
            conds.append(w)
            args += a
        rows = self.db.query(
            "SELECT i.*, (SELECT COUNT(*) FROM alerts a WHERE a.incident_id=i.incident_id AND a.ack_by IS NULL) AS unacked "
            f"FROM incidents i WHERE {' AND '.join(conds)} ORDER BY i.last_alert_at DESC LIMIT ?",
            (*args, max(1, min(int(limit), 100))))
        sites = self.sites()
        return {"window": label, "incidents": [self._incident_out(r, sites, now) for r in rows]}

    def incident_details(self, incident_id=None, alert_id_=None, camera_id: Optional[str] = None,
                         allowed: Optional[Set[str]] = None) -> dict:
        self.sweep()
        now = time.time()
        requested = None
        if alert_id_:
            aid = parse_alert_id(str(alert_id_))
            requested = self.db.query_one("SELECT * FROM alerts WHERE alert_id=?", (aid,))
            if requested is None:
                return {"error": f"No alert {alert_id(aid)} is stored"}
            iid = requested["incident_id"]
        elif incident_id:
            iid = parse_incident_id(incident_id)
        else:
            cf = self._camera_filter(camera_id, None, allowed)
            where, args = ("1", []) if cf is None else _in("camera_id", cf)
            r = self.db.query_one(f"SELECT incident_id FROM incidents WHERE {where} "
                                  "ORDER BY (status='active') DESC, last_alert_at DESC LIMIT 1", args)
            if r is None:
                return {"error": "No incident is stored" + (f" for {camera_id}" if camera_id else "")}
            iid = r["incident_id"]
        inc = self.db.query_one(
            "SELECT i.*, (SELECT COUNT(*) FROM alerts a WHERE a.incident_id=i.incident_id AND a.ack_by IS NULL) AS unacked "
            "FROM incidents i WHERE incident_id=?", (iid,))
        if inc is None:
            return {"error": f"No incident {incident_ref(iid)} is stored"}
        if allowed is not None and inc["camera_id"] not in allowed:
            return {"error": f"{incident_ref(iid)} is outside your area of responsibility"}
        sites = self.sites()
        cam = inc["camera_id"]
        s = sites.get(cam, {})
        first = self.db.query_one("SELECT * FROM alerts WHERE alert_id=?", (inc["first_alert_id"],))
        recent = self.db.query("SELECT * FROM alerts WHERE incident_id=? ORDER BY ts_epoch DESC LIMIT 6", (iid,))
        tracks = self.db.query_one("SELECT COUNT(DISTINCT track_id) AS n FROM alerts WHERE incident_id=?", (iid,))["n"]
        live_cam = self.live()["cameras"].get(cam, {})
        lo, hi = inc["opened_at"] - self.gap_s, inc["last_alert_at"] + self.gap_s
        related_ids = {r["camera_b"] if r["camera_a"] == cam else r["camera_a"]: r["relation"]
                       for r in self.db.relationships(cam) if r["relation"] in ("overlap", "adjacent", "same_post")}
        related = []
        if related_ids:
            w, a = _in("camera_id", related_ids)
            for r in self.db.query(f"SELECT camera_id, COUNT(*) AS n, MIN(ts_epoch) AS first FROM alerts "
                                   f"WHERE {w} AND ts_epoch BETWEEN ? AND ? GROUP BY camera_id", (*a, lo, hi)):
                related.append({"camera_id": r["camera_id"], "camera_name": sites.get(r["camera_id"], {}).get("name"),
                                "relation": related_ids[r["camera_id"]], "alerts_in_window": r["n"],
                                "first_alert": fmt_time(r["first"])})
        nvr = live_cam.get("nvr_id") or s.get("nvr_id")
        nvr_live = self.live()["ingest_nvrs"].get(nvr) if nvr else None
        rz = None
        if inc["class"] == "intrusion":
            geom = self.db.geometry(cam)
            rz = {"zone_id": (first or {}).get("zone_id"), "zone_points": len(geom["zone"] or [])}
        out = {
            "incident": self._incident_out(inc, sites, now),
            "site": {"camera_id": cam, "camera_name": s.get("name"), "post": s.get("post_name"),
                     "company": s.get("company_name")},
            "what": (f"{inc['alert_count']} {inc['class']} alert(s) on {cam}, {len(json.loads(inc['object_classes'] or '[]')) or 'unknown'} "
                     f"object type(s), {tracks} distinct tracked object(s)"),
            "first_alert": self._alert_out(first, sites) if first else None,
            "most_recent_alerts": [self._alert_out(r, sites) for r in recent],
            "distinct_tracked_objects": tracks,
            "restricted_zone": rz,
            "evidence": {"snapshots_stored": self.db.query_one(
                "SELECT COUNT(*) AS n FROM alerts WHERE incident_id=? AND snapshot_path IS NOT NULL", (iid,))["n"],
                "note": "annotated frames are viewable from each alert in the Alert console"},
            "camera_health_now": {k: live_cam.get(k) for k in ("status", "issue", "pipeline_state", "detection_mode",
                                                               "stream_status")} if live_cam else None,
            "camera_health_at_incident_start": self.status_at("camera", cam, inc["opened_at"])
            or "no health transition recorded before the incident",
            "nvr": {"nvr_id": nvr, "status": nvr_live["status"], "issue": nvr_live.get("issue")} if nvr_live else
            ({"nvr_id": nvr, "status": "unknown"} if nvr else None),
            "related_cameras_alerting_in_window": related,
        }
        if requested is not None:
            out["requested_alert"] = self._alert_out(requested, sites)
        return out

    def camera_status(self, camera_id: Optional[str] = None, status: Optional[str] = None,
                      allowed: Optional[Set[str]] = None) -> dict:
        now = time.time()
        live = self.live()
        sites = self.sites()
        if camera_id:
            cid = normalize_camera_id(camera_id)
            if cid is None:
                # a camera name ("ammunition dump")
                matches = [k for k, s in sites.items() if camera_id.strip().lower() in (s.get("name") or "").lower()]
                if len(matches) != 1:
                    return {"error": f"No single camera matches {camera_id!r}",
                            "matches": [{"camera_id": m, "name": sites[m]["name"]} for m in sorted(matches)[:10]]}
                cid = matches[0]
            if cid not in sites:
                return {"error": f"Camera {cid} is not registered in the Command Centre"}
            if allowed is not None and cid not in allowed:
                return {"error": f"{cid} is outside your area of responsibility"}
            return self._camera_detail(cid, live, sites, now)

        st = (status or "all").strip().lower()
        cams = {cid: c for cid, c in live["cameras"].items() if allowed is None or cid in allowed}
        bound = {cid: c for cid, c in cams.items() if c.get("source_bound")}
        alerting = {r["camera_id"] for r in self.db.query("SELECT DISTINCT camera_id FROM incidents WHERE status='active'")}
        unbound = sorted(cid for cid in cams if cid not in bound)

        def row(cid):
            c = cams[cid]
            return {"camera_id": cid, "name": sites.get(cid, {}).get("name"), "status": c["status"], "issue": c["issue"],
                    "detection_mode": c.get("detection_mode"), "pipeline": c.get("pipeline_state"),
                    "nvr": c.get("nvr_id"), "alerting": cid in alerting}

        if st in ("online", "degraded", "offline"):
            sel = sorted(cid for cid, c in bound.items() if c["status"] == st.upper())
        elif st == "alerting":
            sel = sorted(cid for cid in bound if cid in alerting)
        elif st in ("no_source", "unbound"):
            sel = []
        elif st == "all":
            sel = sorted(bound)
        else:
            raise ValueError(f"Unknown status filter {status!r} (online | degraded | offline | alerting | all)")
        return {
            "as_of": fmt_time(now), "data_source": "live pipeline" if live["live"] else "last recorded state",
            "summary": {"registered": len(cams), "with_video_source": len(bound),
                        "online": sum(c["status"] == ONLINE for c in bound.values()),
                        "degraded": sum(c["status"] == DEGRADED for c in bound.values()),
                        "offline": sum(c["status"] == OFFLINE for c in bound.values()),
                        "alerting": len(alerting & set(bound)),
                        "without_video_source": len(unbound)},
            "filter": st,
            "cameras": [row(cid) for cid in sel[:40]],
            "truncated": len(sel) > 40,
            "cameras_without_video_source": {
                "count": len(unbound),
                "note": "registered on the map but not bound to any NVR channel, so they have no video and are always offline",
                "ids": unbound if st in ("no_source", "unbound", "offline") and len(unbound) <= 60 else unbound[:8],
            },
        }

    def _camera_detail(self, cid: str, live: dict, sites: Dict[str, dict], now: float) -> dict:
        c = live["cameras"].get(cid, {})
        s = sites.get(cid, {})
        day = self.db.query_one("SELECT COUNT(*) AS n, MAX(ts_epoch) AS last FROM alerts WHERE camera_id=? AND ts_epoch>=?",
                                (cid, now - 86400))
        last_any = self.db.query_one("SELECT * FROM alerts WHERE camera_id=? ORDER BY ts_epoch DESC LIMIT 1", (cid,))
        inc = self.db.query_one(
            "SELECT i.*, (SELECT COUNT(*) FROM alerts a WHERE a.incident_id=i.incident_id AND a.ack_by IS NULL) AS unacked "
            "FROM incidents i WHERE camera_id=? AND status='active' ORDER BY last_alert_at DESC LIMIT 1", (cid,))
        ev = self.db.query("SELECT event_type, COUNT(*) AS n, MAX(timestamp) AS last FROM events WHERE camera_id=? "
                           "AND timestamp >= ? GROUP BY event_type", (cid, epoch_to_iso(now - 3600)))
        last_ev = self.db.query_one("SELECT event_type, timestamp FROM events WHERE camera_id=? ORDER BY id DESC LIMIT 1",
                                    (cid,))
        nvr = s.get("nvr_id")
        nvr_live = live["ingest_nvrs"].get(nvr) if nvr else None
        out = {
            "camera_id": cid, "name": s.get("name"), "as_of": fmt_time(now),
            "data_source": "live pipeline" if live["live"] else "last recorded state",
            "site": {"post": s.get("post_name"), "company": s.get("company_name")},
            "video_source": ({"nvr_id": nvr, "channel": s.get("channel"), "type": s.get("source_type")}
                             if s.get("source_id") else "not bound to any NVR channel (no video)"),
            "health": {"status": c.get("status", "unknown"), "issue": c.get("issue"), **self._since("camera", cid),
                       "stream_status": c.get("stream_status"), "stream_reason": c.get("stream_reason"),
                       "stream_reconnects": c.get("reconnects"), "frame_age_s": c.get("frame_age_s"),
                       "fps": c.get("fps")},
            "ai_pipeline": {"detection_mode": c.get("detection_mode") or s.get("detection_mode"),
                            "state": c.get("pipeline_state"), "error": c.get("pipeline_error"),
                            "recording": c.get("recording")},
            "nvr_status": ({"nvr_id": nvr, "name": nvr_live.get("name"), "status": nvr_live["status"],
                            "issue": nvr_live.get("issue")} if nvr_live else None),
            "health_history": self.history("camera", cid, 6),
            "alerts": {"last_24h": day["n"], "last_alert": self._alert_out(last_any, sites) if last_any else None,
                       "active_incident": self._incident_out(inc, sites, now) if inc else None},
            "events_last_hour": {r["event_type"]: r["n"] for r in ev},
            "last_event": ({"type": last_ev["event_type"], "time": fmt_time(iso_to_epoch(last_ev["timestamp"]))}
                           if last_ev else None),
        }
        return out

    def nvr_status(self, nvr_id: Optional[str] = None, allowed: Optional[Set[str]] = None) -> dict:
        now = time.time()
        live = self.live()
        sites = self.sites()
        want = nvr_id.strip().upper().replace(" ", "-") if nvr_id else None
        if want and re.fullmatch(r"NVR-?\d+", want):
            want = f"NVR-{int(re.sub(r'\D', '', want)):02d}"
        ingest, recorders = [], []
        for nid, n in sorted(live["ingest_nvrs"].items()):
            if want and nid != want:
                continue
            cams = sorted(cid for cid, s in sites.items() if s.get("nvr_id") == nid)
            ingest.append({
                "nvr_id": nid, "kind": "ingest NVR (physical recorder the camera video is pulled from)",
                "name": n.get("name"), "vendor": n.get("vendor"), "status": n["status"], "issue": n.get("issue"),
                **self._since("nvr", nid), "channels_bound": n.get("channels_bound"),
                "channels_streaming": n.get("channels_connected"), "failing_channels": (n.get("failing") or [])[:12],
                "cameras": cams if len(cams) <= 25 else cams[:25], "credentials_configured": n.get("credentials_configured"),
                "health_history": self.history("nvr", nid, 5),
            })
        for nid, n in sorted(live["recorders"].items()):
            if want and nid != want:
                continue
            if allowed is not None and not set(n.get("cameras") or n.get("affected") or []) & allowed:
                continue
            recorders.append({
                "nvr_id": nid, "kind": "company recorder (Devices registry, health from its company's camera ingest)",
                "name": n.get("name"), "company": n.get("company_id"), "status": n["status"], "issue": n.get("issue"),
                **self._since("recorder", nid), "cameras_assigned": n.get("assigned"),
                "cameras_with_video": n.get("bound"), "cameras_streaming": n.get("streaming"),
                "affected_cameras": (n.get("affected") or [])[:15], "health_history": self.history("recorder", nid, 4),
            })
        if want and not ingest and not recorders:
            return {"error": f"No NVR {nvr_id!r} is registered",
                    "known_nvrs": sorted(set(live["ingest_nvrs"]) | set(live["recorders"]))}
        faults = [n["nvr_id"] + f" ({n['kind'].split(' (')[0]})" for n in ingest + recorders if n["status"] != ONLINE]
        return {"as_of": fmt_time(now), "data_source": "live pipeline" if live["live"] else "last recorded state",
                "faulty": faults, "ingest_nvrs": ingest, "company_recorders": recorders,
                "note": "NVR-01 exists both as an ingest NVR (CP Plus) and as company 01's recorder; they are different devices"
                if any(n["nvr_id"] == "NVR-01" for n in ingest) and any(n["nvr_id"] == "NVR-01" for n in recorders) else None}

    def recent_events(self, minutes: float = 15, camera_id: Optional[str] = None, event_type: Optional[str] = None,
                      limit: int = 10, allowed: Optional[Set[str]] = None) -> dict:
        minutes = max(1.0, min(float(minutes or 15), 7 * 24 * 60))
        now = time.time()
        since_iso = epoch_to_iso(now - minutes * 60)
        sites = self.sites()
        conds, args = ["timestamp >= ?"], [since_iso]
        cf = self._camera_filter(camera_id, None, allowed)
        if cf is not None:
            w, a = _in("camera_id", cf)
            conds.append(w)
            args += a
        if event_type:
            conds.append("event_type=?")
            args.append(event_type.strip().upper().replace(" ", "_"))
        where = " AND ".join(conds)
        by_type = {r["event_type"]: r["n"] for r in self.db.query(
            f"SELECT event_type, COUNT(*) AS n FROM events WHERE {where} GROUP BY event_type ORDER BY n DESC", args)}
        by_cam = self.db.query(f"SELECT camera_id, COUNT(*) AS n FROM events WHERE {where} GROUP BY camera_id "
                               "ORDER BY n DESC LIMIT 12", args)
        plates = self.db.query(f"SELECT plate_text, camera_id, MAX(timestamp) AS last, COUNT(*) AS n FROM events "
                               f"WHERE {where} AND event_type='PLATE_READ' AND plate_text IS NOT NULL "
                               "GROUP BY plate_text, camera_id ORDER BY last DESC LIMIT 10", args)
        samples = self.db.query(f"SELECT id, camera_id, event_type, detection_mode, timestamp, track_id, confidence, "
                                f"vehicle_type, plate_text, payload FROM events WHERE {where} ORDER BY id DESC LIMIT ?",
                                (*args, max(1, min(int(limit), 20))))
        alerts_n = self.db.query_one("SELECT COUNT(*) AS n FROM alerts WHERE ts_epoch >= ?" +
                                     ("" if cf is None else " AND " + _in("camera_id", cf)[0]),
                                     (now - minutes * 60, *([] if cf is None else cf)))["n"]

        def sample(r):
            p = json.loads(r["payload"])
            return {k: v for k, v in {
                "event_id": r["id"], "time": fmt_time(iso_to_epoch(r["timestamp"])), "camera_id": r["camera_id"],
                "type": r["event_type"], "mode": r["detection_mode"], "track_id": r["track_id"],
                "confidence_pct": round(r["confidence"] * 100, 1) if r["confidence"] is not None else None,
                "object": p.get("object_class") or r["vehicle_type"], "plate": r["plate_text"],
                "anomaly": p.get("anomaly_type"), "alert_id": alert_id(r["id"]) if r["event_type"] in ALERT_TYPES and (
                    p.get("snapshot") or p.get("restricted_zone")) else None,
            }.items() if v is not None}

        last = self.db.query_one("SELECT MAX(timestamp) AS t FROM events")["t"]
        return {
            "window": f"last {minutes:g} minutes", "from": fmt_time(now - minutes * 60), "to": fmt_time(now),
            "filters": {k: v for k, v in {"camera_id": camera_id, "event_type": event_type}.items() if v},
            "total_events": sum(by_type.values()), "by_type": by_type,
            "event_type_meaning": {"PERIMETER_BREACH": "person entered a restricted zone", "ANOMALY": "behavioural anomaly",
                                   "VEHICLE_OBSERVED": "vehicle tracked by ANPR", "PLATE_READ": "number plate read",
                                   "VEHICLE_COUNT": "vehicle crossed a counting line",
                                   "PERSON_COUNT": "person crossed a counting line"},
            "alerts_raised": alerts_n,
            "by_camera": [{"camera_id": r["camera_id"], "camera_name": sites.get(r["camera_id"], {}).get("name"),
                           "events": r["n"]} for r in by_cam],
            "plates_read": [{"plate": r["plate_text"], "camera_id": r["camera_id"], "reads": r["n"],
                             "last_seen": fmt_time(iso_to_epoch(r["last"]))} for r in plates],
            "newest_events": [sample(r) for r in samples],
            "newest_event_stored": fmt_time(iso_to_epoch(last)) if last else None,
        }

    def alert_extra(self, event_id: int) -> dict:
        """Severity, acknowledgement and incident of one alert (for alert detail views)."""
        r = self.db.query_one("SELECT severity, ack_by, ack_at, incident_id FROM alerts WHERE alert_id=?", (event_id,))
        if r is None:
            return {}
        return {"severity": r["severity"], "acknowledged_by": r["ack_by"], "acknowledged_at": r["ack_at"],
                "incident_id": incident_ref(r["incident_id"]) if r["incident_id"] else None}
