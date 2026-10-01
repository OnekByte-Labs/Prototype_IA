"""
Command-center database (SQLite, stdlib — no extra service to run).

Source of truth for:
  cameras          camera ↔ video source binding (recorded clip and/or NVR channel +
                   subtype, the source type in use, live stream status) and the
                   ACTIVE detection mode
  camera_geometry  per-camera restricted zone / counting line (native pixels)
  events           every normalized detection event (all modes)
  map_units        tactical hierarchy: battalion → companies → posts (lat/lon)
  cameras (placement columns) post_id, latitude, longitude, bearing, fov_angle, range_m
  camera_relationships  derived camera↔camera links (overlap / adjacent /
                   same post / same company), recomputed on every map save
  nvrs             network video recorders (one per company in the seed); health is
                   derived from the live ingest of the company's cameras
  map_meta         map configuration revision (optimistic concurrency) + seed version
  alerts           every raised operator alert (row id = its event's id), severity,
                   evidence path, acknowledgement and the incident it belongs to
  incidents        alerts of one camera + class grouped while they keep coming
                   (see situation.py); active until the gap expires
  device_status    current health of every camera / ingest NVR / company recorder
  device_health    health transition history of the same entities
  agent_*          Argus Agent conversations and messages

First start seeds cameras from configs/cameras.yaml and migrates the zones/
lines that previously lived in configs/pipeline.yaml (keyed by stream id);
the map hierarchy is generated from configs/map.yaml's seed (synthetic
positions) by gis.generate_seed_layout and written with apply_map_seed.
Only the main process opens the database; workers get their configuration
from it through the pipeline manager's control channel.
"""

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import yaml

logger = logging.getLogger("db")

BACKEND = Path(__file__).resolve().parents[1]
DB_PATH = BACKEND / "data" / "command_center.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS cameras (
    camera_id       TEXT PRIMARY KEY,          -- CAM-07
    name            TEXT NOT NULL,
    source_id       TEXT NOT NULL,             -- streams.yaml id
    detection_mode  TEXT NOT NULL DEFAULT 'none',
    mode_updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS camera_geometry (
    camera_id   TEXT PRIMARY KEY REFERENCES cameras(camera_id),
    zone        TEXT,                          -- JSON [[x,y],...] restricted / counting zone
    line        TEXT,                          -- JSON [[x,y],...] counting line
    buffer_px   INTEGER NOT NULL DEFAULT 0,
    updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id        TEXT NOT NULL,
    detection_mode   TEXT NOT NULL,
    event_type       TEXT NOT NULL,
    timestamp        TEXT NOT NULL,
    track_id         INTEGER,
    confidence       REAL,
    bounding_box     TEXT,
    zone_id          TEXT,
    vehicle_type     TEXT,
    plate_text       TEXT,
    plate_confidence REAL,
    payload          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_camera_time ON events(camera_id, id);
CREATE TABLE IF NOT EXISTS map_units (
    unit_id     TEXT PRIMARY KEY,              -- BN-HQ / COY-A / POST-A1
    unit_type   TEXT NOT NULL CHECK (unit_type IN ('battalion', 'company', 'post')),
    parent_id   TEXT REFERENCES map_units(unit_id),
    name        TEXT NOT NULL,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    boundary    TEXT,                          -- battalion only: JSON [[lat,lon],...] AOR
    sort_order  INTEGER NOT NULL DEFAULT 0,
    updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS camera_relationships (
    camera_a      TEXT NOT NULL,               -- camera_a < camera_b
    camera_b      TEXT NOT NULL,
    relation      TEXT NOT NULL,               -- overlap | adjacent | same_post | same_company
    distance_m    REAL NOT NULL,
    overlap_m2    REAL NOT NULL DEFAULT 0,
    overlap_ratio REAL NOT NULL DEFAULT 0,     -- overlap / smaller FOV area
    bearing_delta REAL NOT NULL DEFAULT 0,     -- |bearing_a - bearing_b| (0..180)
    computed_at   REAL NOT NULL,
    PRIMARY KEY (camera_a, camera_b, relation)
);
CREATE TABLE IF NOT EXISTS nvrs (
    nvr_id      TEXT PRIMARY KEY,
    company_id  TEXT REFERENCES map_units(unit_id),
    name        TEXT NOT NULL,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS map_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nvr_integrations (
    nvr_id          TEXT PRIMARY KEY,           -- survives map saves (nvrs rows are rewritten)
    protocol        TEXT NOT NULL DEFAULT 'none',   -- onvif | rtsp | vendor_sdk | none
    vendor          TEXT,
    host            TEXT,
    port            INTEGER,
    username        TEXT,
    rtsp_path       TEXT,
    channels        INTEGER,
    updated_at      REAL NOT NULL,
    updated_by      TEXT,
    last_probe_at   REAL,
    last_probe_ok   INTEGER,
    last_probe_ms   REAL,
    last_probe      TEXT,                       -- JSON result
    last_sync_at    REAL,
    last_sync       TEXT                        -- JSON channel synchronization result
);
CREATE TABLE IF NOT EXISTS alert_feedback (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     INTEGER NOT NULL UNIQUE,       -- the alert's events row
    camera_id    TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    detection_mode TEXT NOT NULL,
    verdict      TEXT NOT NULL,                 -- confirmed | false_alarm
    note         TEXT,
    submitted_by TEXT NOT NULL,
    submitted_at REAL NOT NULL,
    snapshot     TEXT,                          -- copy under outputs/training_candidates
    event        TEXT NOT NULL,                 -- JSON copy of the event (survives retention)
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected
    reviewed_by  TEXT,
    reviewed_at  REAL,
    review_note  TEXT
);
CREATE INDEX IF NOT EXISTS events_time ON events(timestamp);
CREATE TABLE IF NOT EXISTS incidents (
    incident_id     INTEGER PRIMARY KEY AUTOINCREMENT,   -- INCD-000042
    camera_id       TEXT NOT NULL,
    class           TEXT NOT NULL,                       -- intrusion | anomaly
    status          TEXT NOT NULL DEFAULT 'active',      -- active | closed
    severity        TEXT,                                -- highest severity of its alerts
    opened_at       REAL NOT NULL,                       -- epoch s of the first alert
    last_alert_at   REAL NOT NULL,
    closed_at       REAL,
    alert_count     INTEGER NOT NULL DEFAULT 0,
    first_alert_id  INTEGER NOT NULL,
    last_alert_id   INTEGER NOT NULL,
    max_confidence  REAL,
    object_classes  TEXT                                 -- JSON list
);
CREATE INDEX IF NOT EXISTS incidents_open ON incidents(camera_id, class, status);
CREATE INDEX IF NOT EXISTS incidents_time ON incidents(last_alert_at);
CREATE TABLE IF NOT EXISTS alerts (
    alert_id        INTEGER PRIMARY KEY,                 -- = events.id of the alert's event (INC-000123)
    camera_id       TEXT NOT NULL,
    class           TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    label           TEXT,
    detection_mode  TEXT NOT NULL,
    object_class    TEXT,
    confidence      REAL,                                -- percent
    severity        TEXT,
    track_id        INTEGER,
    zone_id         TEXT,
    ts              TEXT NOT NULL,                       -- ISO-8601 UTC (as the event)
    ts_epoch        REAL NOT NULL,
    snapshot_path   TEXT,                                -- relative to outputs/evidence (file on disk)
    incident_id     INTEGER REFERENCES incidents(incident_id),
    ack_by          TEXT,
    ack_at          REAL
);
CREATE INDEX IF NOT EXISTS alerts_time ON alerts(ts_epoch);
CREATE INDEX IF NOT EXISTS alerts_camera_time ON alerts(camera_id, ts_epoch);
CREATE INDEX IF NOT EXISTS alerts_incident ON alerts(incident_id);
CREATE TABLE IF NOT EXISTS device_status (
    entity_type     TEXT NOT NULL,                       -- camera | nvr (ingest NVR) | recorder (company NVR)
    entity_id       TEXT NOT NULL,
    status          TEXT NOT NULL,                       -- ONLINE | DEGRADED | OFFLINE
    issue           TEXT,
    detail          TEXT,                                -- JSON
    since           REAL NOT NULL,
    checked_at      REAL NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
);
CREATE TABLE IF NOT EXISTS device_health (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    status          TEXT NOT NULL,
    previous        TEXT,
    issue           TEXT,
    detail          TEXT,                                -- JSON
    ts              REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS device_health_entity ON device_health(entity_type, entity_id, ts);
CREATE INDEX IF NOT EXISTS device_health_time ON device_health(ts);
CREATE TABLE IF NOT EXISTS agent_conversations (
    conversation_id TEXT PRIMARY KEY,
    username        TEXT NOT NULL,
    title           TEXT NOT NULL,
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_conversations_user ON agent_conversations(username, updated_at);
CREATE TABLE IF NOT EXISTS agent_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES agent_conversations(conversation_id) ON DELETE CASCADE,
    role            TEXT NOT NULL,                       -- user | assistant
    content         TEXT NOT NULL,
    tool_calls      TEXT,                                -- JSON [{name, arguments, ok, ms, summary}]
    sources         TEXT,                                -- JSON [{kind, id, label, href}]
    status          TEXT NOT NULL DEFAULT 'complete',    -- complete | stopped | error
    created_at      REAL NOT NULL,
    duration_ms     REAL
);
CREATE INDEX IF NOT EXISTS agent_messages_conv ON agent_messages(conversation_id, id);
"""

# Map placement columns added to the existing cameras table
CAMERA_MAP_COLUMNS = {
    "post_id": "TEXT", "latitude": "REAL", "longitude": "REAL",
    "bearing": "REAL NOT NULL DEFAULT 0", "fov_angle": "REAL NOT NULL DEFAULT 60",
    "range_m": "REAL NOT NULL DEFAULT 300",
    # Device registry metadata (administration); NULL = not recorded
    "ip": "TEXT", "model": "TEXT", "firmware": "TEXT", "stream_url": "TEXT", "stream_protocol": "TEXT",
    "nvr_channel": "INTEGER", "device_updated_at": "REAL", "device_updated_by": "TEXT",
    # Ingest binding (camera registry): NVR + channel + stream subtype, the source
    # type actually used (rtsp | recorded | none) and the live stream status.
    # Credentials are never stored here (environment only, see src/sources/nvr.py).
    "nvr_id": "TEXT", "channel": "INTEGER", "subtype": "INTEGER NOT NULL DEFAULT 1",
    "source_type": "TEXT NOT NULL DEFAULT 'recorded'", "stream_status": "TEXT", "stream_status_at": "REAL",
}
CAMERA_FIELDS = ("camera_id", "name", "source_id", "detection_mode", "mode_updated_at",
                 "nvr_id", "channel", "subtype", "source_type", "stream_status")
DEVICE_FIELDS = ("ip", "model", "firmware", "stream_url", "stream_protocol", "nvr_channel")
NVR_INTEGRATION_FIELDS = ("protocol", "vendor", "host", "port", "username", "rtsp_path", "channels")
MAP_CAMERA_FIELDS = ("camera_id", "name", "source_id", "detection_mode", "post_id", "latitude", "longitude",
                     "bearing", "fov_angle", "range_m")
UNIT_FIELDS = ("unit_id", "unit_type", "parent_id", "name", "latitude", "longitude", "boundary", "sort_order")
NVR_FIELDS = ("nvr_id", "company_id", "name", "latitude", "longitude")


class MapRevisionConflict(Exception):
    pass

# Where each migrated stream's zones/lines belonged before cameras existed
LEGACY_STREAM_CAMERA = {"cam_01": "CAM-01", "cam_02": "CAM-02", "cam_09": "CAM-09",
                        "feed_intel_people_detection": "CAM-16"}


class Database:
    def __init__(self, path: Path = DB_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)
            have = {r[1] for r in self._conn.execute("PRAGMA table_info(cameras)")}
            for col, decl in CAMERA_MAP_COLUMNS.items():
                if col not in have:
                    self._conn.execute(f"ALTER TABLE cameras ADD COLUMN {col} {decl}")
        self.path = path

    # ── generic read / write (operational queries, agent store) ─────

    def query(self, sql: str, args: Iterable = ()) -> List[dict]:
        with self._lock:
            cur = self._conn.execute(sql, tuple(args))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
        return [dict(zip(cols, r)) for r in rows]

    def query_one(self, sql: str, args: Iterable = ()) -> Optional[dict]:
        rows = self.query(sql, args)
        return rows[0] if rows else None

    def execute(self, sql: str, args: Iterable = ()) -> int:
        """Run one statement; returns lastrowid (INSERT) or rowcount."""
        with self._lock:
            cur = self._conn.execute(sql, tuple(args))
        return cur.lastrowid if sql.lstrip().upper().startswith("INSERT") else cur.rowcount

    def transaction(self, fn):
        """Run ``fn(conn)`` inside one IMMEDIATE transaction (under the db lock)."""
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                out = fn(self._conn)
                self._conn.execute("COMMIT")
                return out
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise

    # ── seeding / migration ──────────────────────────────────────────

    def seed(self, cameras_yaml: Path, pipeline_cfg: dict) -> None:
        from src.sources.media_server import path_name
        cams = yaml.safe_load(cameras_yaml.read_text())["cameras"]
        now = time.time()
        with self._lock:
            for c in cams:
                # Video source = the camera's live NVR channel on the media server;
                # cameras without one have no source (there are no recorded feeds)
                src = (path_name(c["nvr"], int(c["channel"]), "" if int(c.get("subtype", 1)) == 1 else "main")
                       if c.get("nvr") and c.get("channel") else "")
                # Existing rows keep their operator-selected mode (DB is the truth)
                self._conn.execute(
                    "INSERT OR IGNORE INTO cameras(camera_id, name, source_id, detection_mode, mode_updated_at) "
                    "VALUES (?,?,?,?,?)", (c["id"], c["name"], src, c.get("default_mode", "none"), now))
                self._conn.execute("UPDATE cameras SET name=?, source_id=? WHERE camera_id=?",
                                   (c["name"], src, c["id"]))
                # Live binding follows the config
                self._conn.execute("UPDATE cameras SET nvr_id=?, channel=?, subtype=? WHERE camera_id=?",
                                   (c.get("nvr"), c.get("channel"), int(c.get("subtype", 1)), c["id"]))
            migrated = 0
            for sid, cfg in (pipeline_cfg.get("analytics") or {}).items():
                cam = LEGACY_STREAM_CAMERA.get(sid)
                if not cam or self._conn.execute(
                        "SELECT 1 FROM camera_geometry WHERE camera_id=?", (cam,)).fetchone():
                    continue
                zone = cfg.get("zone") if cfg.get("type") == "intrusion_zone" else None
                line = cfg.get("line")
                self._conn.execute(
                    "INSERT INTO camera_geometry(camera_id, zone, line, buffer_px, updated_at) VALUES (?,?,?,?,?)",
                    (cam, json.dumps(zone) if zone else None, json.dumps(line) if line else None,
                     int(cfg.get("buffer_px", 0) or 0), now))
                migrated += 1
        if migrated:
            logger.info("Migrated %d zone/line configs from pipeline.yaml into the database", migrated)

    # ── cameras / modes ──────────────────────────────────────────────

    def cameras(self) -> List[dict]:
        with self._lock:
            rows = self._conn.execute(
                f"SELECT {', '.join(CAMERA_FIELDS)} FROM cameras "
                "ORDER BY CAST(substr(camera_id, 5) AS INTEGER)").fetchall()
        return [dict(zip(CAMERA_FIELDS, r)) for r in rows]

    def set_source_types(self, types: Dict[str, str]) -> None:
        """Source type each camera is ingested with this run (rtsp | none)."""
        with self._lock:
            self._conn.executemany("UPDATE cameras SET source_type=? WHERE camera_id=?",
                                   [(t, cid) for cid, t in types.items()])

    def set_stream_status(self, camera_id: str, status: Optional[str]) -> None:
        with self._lock:
            self._conn.execute("UPDATE cameras SET stream_status=?, stream_status_at=? WHERE camera_id=?",
                               (status, time.time(), camera_id))

    def set_mode(self, camera_id: str, mode: str) -> None:
        with self._lock:
            cur = self._conn.execute("UPDATE cameras SET detection_mode=?, mode_updated_at=? WHERE camera_id=?",
                                     (mode, time.time(), camera_id))
        if cur.rowcount != 1:
            raise KeyError(camera_id)

    # ── geometry ─────────────────────────────────────────────────────

    def geometry(self, camera_id: str) -> dict:
        with self._lock:
            r = self._conn.execute("SELECT zone, line, buffer_px FROM camera_geometry WHERE camera_id=?",
                                   (camera_id,)).fetchone()
        if not r:
            return {"zone": None, "line": None, "buffer_px": 0}
        return {"zone": json.loads(r[0]) if r[0] else None, "line": json.loads(r[1]) if r[1] else None,
                "buffer_px": r[2]}

    def set_geometry(self, camera_id: str, zone=..., line=...) -> dict:
        """Replace the camera's zone and/or line (``...`` = leave unchanged,
        ``None`` = delete)."""
        cur = self.geometry(camera_id)
        if zone is not ...:
            cur["zone"] = zone
        if line is not ...:
            cur["line"] = line
        with self._lock:
            self._conn.execute(
                "INSERT INTO camera_geometry(camera_id, zone, line, buffer_px, updated_at) VALUES (?,?,?,?,?) "
                "ON CONFLICT(camera_id) DO UPDATE SET zone=excluded.zone, line=excluded.line, "
                "updated_at=excluded.updated_at",
                (camera_id, json.dumps(cur["zone"]) if cur["zone"] else None,
                 json.dumps(cur["line"]) if cur["line"] else None, cur["buffer_px"], time.time()))
        return cur

    # ── events ───────────────────────────────────────────────────────

    @staticmethod
    def _event_row(e: dict) -> tuple:
        return (
            e["camera_id"], e["detection_mode"], e["event_type"], e["timestamp"], e.get("track_id"),
            e.get("confidence"), json.dumps(e.get("bounding_box")) if e.get("bounding_box") else None,
            e.get("zone_id"), e.get("vehicle_type"), e.get("plate_text"), e.get("plate_confidence"),
            json.dumps(e),
        )

    _INSERT_EVENT = ("INSERT INTO events(camera_id, detection_mode, event_type, timestamp, track_id, confidence, "
                     "bounding_box, zone_id, vehicle_type, plate_text, plate_confidence, payload) "
                     "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")

    def insert_events(self, events: Iterable[dict]) -> None:
        rows = [self._event_row(e) for e in events]
        if not rows:
            return
        with self._lock:
            self._conn.executemany(self._INSERT_EVENT, rows)

    def insert_event(self, event: dict) -> int:
        """Insert one event immediately and return its id (alerts use it as their durable id)."""
        with self._lock:
            return self._conn.execute(self._INSERT_EVENT, self._event_row(event)).lastrowid

    def event(self, event_id: int) -> Optional[dict]:
        with self._lock:
            r = self._conn.execute("SELECT id, payload FROM events WHERE id = ?", (event_id,)).fetchone()
        return {"id": r[0], **json.loads(r[1])} if r else None

    def camera_site(self, camera_id: str) -> dict:
        """Camera name + its place in the tactical hierarchy (post → company → battalion)."""
        with self._lock:
            r = self._conn.execute(
                "SELECT c.name, c.latitude, c.longitude, p.unit_id, p.name, co.unit_id, co.name, bn.unit_id, bn.name "
                "FROM cameras c "
                "LEFT JOIN map_units p ON p.unit_id = c.post_id "
                "LEFT JOIN map_units co ON co.unit_id = p.parent_id "
                "LEFT JOIN map_units bn ON bn.unit_id = co.parent_id "
                "WHERE c.camera_id = ?", (camera_id,)).fetchone()
        if not r:
            return {}
        return dict(zip(("camera_name", "latitude", "longitude", "post_id", "post_name", "company_id",
                         "company_name", "battalion_id", "battalion_name"), r))

    def events(self, camera_id: Optional[str] = None, limit: int = 100, after_id: int = 0) -> List[dict]:
        q = "SELECT id, payload FROM events WHERE id > ?"
        args: list = [after_id]
        if camera_id:
            q += " AND camera_id = ?"
            args.append(camera_id)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            rows = self._conn.execute(q, args).fetchall()
        return [{"id": i, **json.loads(p)} for i, p in reversed(rows)]

    def event_counts(self, since_iso: str) -> Dict[str, Dict[str, int]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT camera_id, detection_mode, event_type, COUNT(*) FROM events WHERE timestamp >= ? "
                "GROUP BY camera_id, detection_mode, event_type", (since_iso,)).fetchall()
        out: Dict[str, Dict[str, int]] = {}
        for cam, mode, et, n in rows:
            out.setdefault(cam, {})[f"{mode}:{et}"] = n
        return out

    def event_stats(self) -> dict:
        with self._lock:
            n, first, last = self._conn.execute("SELECT COUNT(*), MIN(timestamp), MAX(timestamp) FROM events").fetchone()
        return {"count": n, "oldest": first, "newest": last}

    def events_older_than(self, cutoff_iso: str) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM events WHERE timestamp < ?", (cutoff_iso,)).fetchone()[0]

    def prune_events(self, cutoff_iso: str, batch: int = 5000) -> int:
        """Delete events older than the cutoff in small batches (keeps the collector responsive)."""
        total = 0
        while True:
            with self._lock:
                n = self._conn.execute(
                    "DELETE FROM events WHERE id IN (SELECT id FROM events WHERE timestamp < ? LIMIT ?)",
                    (cutoff_iso, batch)).rowcount
            total += n
            if n < batch:
                return total

    def recent_event_counts(self, since_iso: str, camera_ids: Optional[List[str]] = None) -> Dict[str, int]:
        q = "SELECT camera_id, COUNT(*) FROM events WHERE timestamp >= ?"
        args: list = [since_iso]
        if camera_ids:
            q += f" AND camera_id IN ({','.join('?' * len(camera_ids))})"
            args += camera_ids
        with self._lock:
            return dict(self._conn.execute(q + " GROUP BY camera_id", args).fetchall())

    # ── device registry ──────────────────────────────────────────────

    def devices(self) -> List[dict]:
        cols = ("camera_id", "name", "source_id", "detection_mode", "post_id", "latitude", "longitude") + DEVICE_FIELDS \
            + ("device_updated_at", "device_updated_by")
        with self._lock:
            rows = self._conn.execute(f"SELECT {', '.join(cols)} FROM cameras "
                                      "ORDER BY CAST(substr(camera_id, 5) AS INTEGER)").fetchall()
        return [dict(zip(cols, r)) for r in rows]

    def update_device(self, camera_id: str, fields: dict, by: str) -> dict:
        sets = {k: fields[k] for k in DEVICE_FIELDS if k in fields}
        if "name" in fields:
            sets["name"] = fields["name"]
        with self._lock:
            before = self._conn.execute(
                f"SELECT name, {', '.join(DEVICE_FIELDS)} FROM cameras WHERE camera_id=?", (camera_id,)).fetchone()
            if before is None:
                raise KeyError(camera_id)
            if sets:
                self._conn.execute(
                    f"UPDATE cameras SET {', '.join(f'{k}=?' for k in sets)}, device_updated_at=?, device_updated_by=? "
                    "WHERE camera_id=?", (*sets.values(), time.time(), by, camera_id))
        return dict(zip(("name",) + DEVICE_FIELDS, before))

    def nvr_integrations(self) -> Dict[str, dict]:
        with self._lock:
            cur = self._conn.execute("SELECT * FROM nvr_integrations")
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
        out = {}
        for r in rows:
            d = dict(zip(cols, r))
            for k in ("last_probe", "last_sync"):
                d[k] = json.loads(d[k]) if d[k] else None
            out[d["nvr_id"]] = d
        return out

    def upsert_nvr_integration(self, nvr_id: str, fields: dict, by: str) -> Optional[dict]:
        before = self.nvr_integrations().get(nvr_id)
        vals = {k: fields.get(k, before.get(k) if before else None) for k in NVR_INTEGRATION_FIELDS}
        vals["protocol"] = vals["protocol"] or "none"
        with self._lock:
            self._conn.execute(
                f"INSERT INTO nvr_integrations(nvr_id, {', '.join(NVR_INTEGRATION_FIELDS)}, updated_at, updated_by) "
                f"VALUES (?, {', '.join('?' * len(NVR_INTEGRATION_FIELDS))}, ?, ?) ON CONFLICT(nvr_id) DO UPDATE SET "
                + ", ".join(f"{k}=excluded.{k}" for k in NVR_INTEGRATION_FIELDS)
                + ", updated_at=excluded.updated_at, updated_by=excluded.updated_by",
                (nvr_id, *vals.values(), time.time(), by))
        return before

    def record_nvr_probe(self, nvr_id: str, result: dict) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO nvr_integrations(nvr_id, protocol, updated_at, last_probe_at, last_probe_ok, last_probe_ms, "
                "last_probe) VALUES (?, 'none', ?, ?, ?, ?, ?) ON CONFLICT(nvr_id) DO UPDATE SET "
                "last_probe_at=excluded.last_probe_at, last_probe_ok=excluded.last_probe_ok, "
                "last_probe_ms=excluded.last_probe_ms, last_probe=excluded.last_probe",
                (nvr_id, time.time(), time.time(), int(bool(result.get("ok"))), result.get("latency_ms"),
                 json.dumps(result)))

    def record_nvr_sync(self, nvr_id: str, result: dict, channel_map: Dict[str, int]) -> None:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute(
                    "INSERT INTO nvr_integrations(nvr_id, protocol, updated_at, last_sync_at, last_sync) "
                    "VALUES (?, 'none', ?, ?, ?) ON CONFLICT(nvr_id) DO UPDATE SET last_sync_at=excluded.last_sync_at, "
                    "last_sync=excluded.last_sync", (nvr_id, time.time(), time.time(), json.dumps(result)))
                for cam, ch in channel_map.items():
                    self._conn.execute("UPDATE cameras SET nvr_channel=? WHERE camera_id=?", (ch, cam))
                self._conn.execute("COMMIT")
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise

    # ── model improvement queue ──────────────────────────────────────

    FEEDBACK_COLS = ("id", "event_id", "camera_id", "event_type", "detection_mode", "verdict", "note", "submitted_by",
                     "submitted_at", "snapshot", "event", "status", "reviewed_by", "reviewed_at", "review_note")

    def feedback(self, status: Optional[str] = None, limit: int = 500) -> List[dict]:
        q = f"SELECT {', '.join(self.FEEDBACK_COLS)} FROM alert_feedback"
        args: list = []
        if status:
            q += " WHERE status=?"
            args.append(status)
        with self._lock:
            rows = self._conn.execute(q + " ORDER BY id DESC LIMIT ?", (*args, limit)).fetchall()
        out = []
        for r in rows:
            d = dict(zip(self.FEEDBACK_COLS, r))
            d["event"] = json.loads(d["event"])
            out.append(d)
        return out

    def feedback_for(self, event_id: int) -> Optional[dict]:
        with self._lock:
            r = self._conn.execute(f"SELECT {', '.join(self.FEEDBACK_COLS)} FROM alert_feedback WHERE event_id=?",
                                   (event_id,)).fetchone()
        if not r:
            return None
        d = dict(zip(self.FEEDBACK_COLS, r))
        d["event"] = json.loads(d["event"])
        return d

    def upsert_feedback(self, ev: dict, verdict: str, note: Optional[str], by: str, snapshot: Optional[str]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO alert_feedback(event_id, camera_id, event_type, detection_mode, verdict, note, submitted_by, "
                "submitted_at, snapshot, event, status) VALUES (?,?,?,?,?,?,?,?,?,?,'pending') "
                "ON CONFLICT(event_id) DO UPDATE SET verdict=excluded.verdict, note=excluded.note, "
                "submitted_by=excluded.submitted_by, submitted_at=excluded.submitted_at, "
                "snapshot=COALESCE(excluded.snapshot, alert_feedback.snapshot), status='pending', reviewed_by=NULL, "
                "reviewed_at=NULL, review_note=NULL",
                (ev["id"], ev["camera_id"], ev["event_type"], ev["detection_mode"], verdict, note, by, time.time(),
                 snapshot, json.dumps(ev)))

    def review_feedback(self, fid: int, status: str, by: str, note: Optional[str]) -> Optional[dict]:
        with self._lock:
            r = self._conn.execute("SELECT status, verdict FROM alert_feedback WHERE id=?", (fid,)).fetchone()
            if r is None:
                return None
            self._conn.execute("UPDATE alert_feedback SET status=?, reviewed_by=?, reviewed_at=?, review_note=? "
                               "WHERE id=?", (status, by, time.time(), note, fid))
        return {"status": r[0], "verdict": r[1]}

    # ── backup / restore ─────────────────────────────────────────────

    def backup_to(self, dest: Path) -> None:
        """Consistent online copy (SQLite backup API)."""
        dst = sqlite3.connect(str(dest))
        try:
            with self._lock:
                self._conn.backup(dst)
        finally:
            dst.close()

    def restore_from(self, src_path: Path) -> None:
        """Replace this database's contents with a backup, online."""
        src = sqlite3.connect(str(src_path))
        try:
            with self._lock:
                src.backup(self._conn)
                self._conn.executescript(SCHEMA)          # tables added since the backup
                have = {r[1] for r in self._conn.execute("PRAGMA table_info(cameras)")}
                for col, decl in CAMERA_MAP_COLUMNS.items():
                    if col not in have:
                        self._conn.execute(f"ALTER TABLE cameras ADD COLUMN {col} {decl}")
        finally:
            src.close()

    # ── tactical map ─────────────────────────────────────────────────

    def map_seed_version(self) -> int:
        """Seed version the map was generated from (1 = the pre-versioning seed,
        0 = never seeded)."""
        with self._lock:
            r = self._conn.execute("SELECT value FROM map_meta WHERE key='seed_version'").fetchone()
            if r:
                return int(r[0])
            return 1 if self._conn.execute("SELECT 1 FROM map_units LIMIT 1").fetchone() else 0

    def apply_map_seed(self, layout: dict, version: int) -> int:
        """Replace the whole map with a generated seed layout: registers any new
        (unbound) cameras, clears every placement, writes units / NVRs /
        camera placements and bumps the revision. Returns the new revision."""
        now = time.time()
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                r = self._conn.execute("SELECT value FROM map_meta WHERE key='revision'").fetchone()
                rev = (int(r[0]) if r else 0) + 1
                # Video-less prototype cameras: (re)register the seed's, drop the ones it no longer places
                reg = [c["camera_id"] for c in layout["register"]]
                keep = ",".join("?" * len(reg)) or "''"
                self._conn.execute(f"DELETE FROM camera_geometry WHERE camera_id IN (SELECT camera_id FROM cameras "
                                   f"WHERE source_id='' AND camera_id NOT IN ({keep}))", reg)
                self._conn.execute(f"DELETE FROM cameras WHERE source_id='' AND camera_id NOT IN ({keep})", reg)
                self._conn.executemany(
                    "INSERT INTO cameras(camera_id, name, source_id, detection_mode, mode_updated_at) VALUES (?,?,?,?,?) "
                    "ON CONFLICT(camera_id) DO UPDATE SET name=excluded.name",
                    [(c["camera_id"], c["name"], "", "none", now) for c in layout["register"]])
                self._conn.execute("UPDATE cameras SET post_id=NULL, latitude=NULL, longitude=NULL")
                self._conn.execute("DELETE FROM nvrs")
                self._conn.execute("DELETE FROM camera_relationships")
                self._conn.execute("DELETE FROM map_units")
                self._write_units(layout["units"], now)
                self._write_nvrs(layout["nvrs"], now)
                self._write_cameras(layout["cameras"])
                self._conn.executemany("INSERT OR REPLACE INTO map_meta(key, value) VALUES (?, ?)",
                                       [("revision", str(rev)), ("seed_version", str(version))])
                self._conn.execute("COMMIT")
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
        return rev

    def _write_units(self, units: List[dict], now: float) -> None:
        rank = {"battalion": 0, "company": 1, "post": 2}     # parents before children
        self._conn.executemany(
            "INSERT INTO map_units(unit_id, unit_type, parent_id, name, latitude, longitude, boundary, "
            "sort_order, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            [(u["unit_id"], u["unit_type"], u["parent_id"], u["name"], u["latitude"], u["longitude"],
              json.dumps(u["boundary"]) if u.get("boundary") else None, u.get("sort_order", 0), now)
             for u in sorted(units, key=lambda u: rank[u["unit_type"]])])

    def _write_nvrs(self, nvrs: List[dict], now: float) -> None:
        self._conn.executemany(
            "INSERT INTO nvrs(nvr_id, company_id, name, latitude, longitude, updated_at) VALUES (?,?,?,?,?,?)",
            [(n["nvr_id"], n["company_id"], n["name"], n["latitude"], n["longitude"], now) for n in nvrs])

    def _write_cameras(self, cameras: List[dict]) -> None:
        for c in cameras:
            cur = self._conn.execute(
                "UPDATE cameras SET post_id=?, latitude=?, longitude=?, bearing=?, fov_angle=?, range_m=? "
                "WHERE camera_id=?",
                (c["post_id"], c["latitude"], c["longitude"], c["bearing"], c["fov_angle"], c["range_m"],
                 c["camera_id"]))
            if cur.rowcount != 1:
                raise KeyError(c["camera_id"])

    def map_revision(self) -> int:
        with self._lock:
            r = self._conn.execute("SELECT value FROM map_meta WHERE key='revision'").fetchone()
        return int(r[0]) if r else 0

    def map_units(self) -> List[dict]:
        with self._lock:
            rows = self._conn.execute(
                f"SELECT {', '.join(UNIT_FIELDS)} FROM map_units ORDER BY unit_type, sort_order, unit_id").fetchall()
        out = []
        for r in rows:
            u = dict(zip(UNIT_FIELDS, r))
            u["boundary"] = json.loads(u["boundary"]) if u["boundary"] else None
            out.append(u)
        return out

    def map_cameras(self) -> List[dict]:
        with self._lock:
            rows = self._conn.execute(
                f"SELECT {', '.join(MAP_CAMERA_FIELDS)} FROM cameras "
                "ORDER BY CAST(substr(camera_id, 5) AS INTEGER)").fetchall()
        return [dict(zip(MAP_CAMERA_FIELDS, r)) for r in rows]

    def map_nvrs(self) -> List[dict]:
        with self._lock:
            rows = self._conn.execute(f"SELECT {', '.join(NVR_FIELDS)} FROM nvrs ORDER BY nvr_id").fetchall()
        return [dict(zip(NVR_FIELDS, r)) for r in rows]

    def save_map(self, expected_revision: int, units: List[dict], cameras: List[dict],
                 relationships: List[dict], nvrs: List[dict]) -> int:
        """Atomically replace the hierarchy, NVRs, camera placements and derived
        relationships. Raises MapRevisionConflict if someone saved since
        ``expected_revision`` was read."""
        now = time.time()
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                r = self._conn.execute("SELECT value FROM map_meta WHERE key='revision'").fetchone()
                current = int(r[0]) if r else 0
                if current != expected_revision:
                    raise MapRevisionConflict(f"map was changed elsewhere (revision {current}, "
                                              f"you edited {expected_revision})")
                self._conn.execute("UPDATE cameras SET post_id=NULL")        # FK-safe before units go
                self._conn.execute("DELETE FROM nvrs")
                self._conn.execute("DELETE FROM map_units")
                self._write_units(units, now)
                self._write_nvrs(nvrs, now)
                self._write_cameras(cameras)
                self._write_relationships(relationships, now)
                self._conn.execute("INSERT OR REPLACE INTO map_meta(key, value) VALUES ('revision', ?)",
                                   (str(current + 1),))
                self._conn.execute("COMMIT")
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
        return current + 1

    def _write_relationships(self, rels: List[dict], now: float) -> None:
        self._conn.execute("DELETE FROM camera_relationships")
        self._conn.executemany(
            "INSERT INTO camera_relationships(camera_a, camera_b, relation, distance_m, overlap_m2, overlap_ratio, "
            "bearing_delta, computed_at) VALUES (?,?,?,?,?,?,?,?)",
            [(r["camera_a"], r["camera_b"], r["relation"], r["distance_m"], r.get("overlap_m2", 0.0),
              r.get("overlap_ratio", 0.0), r.get("bearing_delta", 0.0), now) for r in rels])

    def replace_relationships(self, rels: List[dict]) -> None:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._write_relationships(rels, time.time())
                self._conn.execute("COMMIT")
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise

    def relationships(self, camera_id: Optional[str] = None) -> List[dict]:
        fields = ("camera_a", "camera_b", "relation", "distance_m", "overlap_m2", "overlap_ratio", "bearing_delta")
        q = f"SELECT {', '.join(fields)} FROM camera_relationships"
        args: list = []
        if camera_id:
            q += " WHERE camera_a = ? OR camera_b = ?"
            args = [camera_id, camera_id]
        with self._lock:
            rows = self._conn.execute(q + " ORDER BY camera_a, camera_b, relation", args).fetchall()
        return [dict(zip(fields, r)) for r in rows]
