"""
Administration database (backend/data/admin.db).

Kept apart from command_center.db on purpose: restoring the operational
database from a backup must never rewind user accounts, sessions, the audit
trail or configuration history.

  users / roles / sessions / login_attempts   authentication + RBAC
  audit                                       append-only, hash-chained
  config_versions                             versioned system configuration
  config_acks                                 per-worker applied config version
  backups                                     backup history
  model_versions                              model file versions seen
"""

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

BACKEND = Path(__file__).resolve().parents[2]
ADMIN_DB_PATH = BACKEND / "data" / "admin.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS roles (
    name         TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    permissions  TEXT NOT NULL,              -- JSON list
    builtin      INTEGER NOT NULL DEFAULT 0,
    updated_at   REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name         TEXT NOT NULL,
    service_no           TEXT NOT NULL DEFAULT '',
    role                 TEXT NOT NULL REFERENCES roles(name),
    scope_type           TEXT NOT NULL DEFAULT 'battalion',   -- battalion | company | post
    scope_id             TEXT,
    status               TEXT NOT NULL DEFAULT 'active',      -- active | disabled
    must_change_password INTEGER NOT NULL DEFAULT 1,
    password_hash        TEXT NOT NULL,
    password_changed_at  REAL,
    failed_count         INTEGER NOT NULL DEFAULT 0,
    locked_until         REAL,
    last_login_at        REAL,
    last_login_ip        TEXT,
    created_at           REAL NOT NULL,
    updated_at           REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,               -- public id (revocation)
    token_hash   TEXT NOT NULL UNIQUE,           -- sha256 of the bearer token
    user_id      INTEGER NOT NULL REFERENCES users(id),
    created_at   REAL NOT NULL,
    last_seen    REAL NOT NULL,
    expires_at   REAL NOT NULL,
    ip           TEXT,
    user_agent   TEXT,
    revoked_at   REAL,
    revoked_by   TEXT,
    revoke_reason TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS login_attempts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        REAL NOT NULL,
    username  TEXT NOT NULL,
    ip        TEXT,
    success   INTEGER NOT NULL,
    reason    TEXT
);
CREATE TABLE IF NOT EXISTS audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         REAL NOT NULL,
    user       TEXT NOT NULL,
    user_id    INTEGER,
    action     TEXT NOT NULL,
    resource   TEXT NOT NULL,
    prev       TEXT,
    new        TEXT,
    result     TEXT NOT NULL,                  -- success | denied | failed
    detail     TEXT,
    ip         TEXT,
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
CREATE TABLE IF NOT EXISTS config_versions (
    version     INTEGER PRIMARY KEY,
    created_at  REAL NOT NULL,
    author      TEXT NOT NULL,
    kind        TEXT NOT NULL,                  -- seed | apply | rollback | restore
    comment     TEXT NOT NULL DEFAULT '',
    based_on    INTEGER,
    doc         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS config_acks (
    worker     INTEGER PRIMARY KEY,
    version    INTEGER NOT NULL,
    acked_at   REAL NOT NULL,
    cameras    TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS backups (
    id           TEXT PRIMARY KEY,
    created_at   REAL NOT NULL,
    author       TEXT NOT NULL,
    kind         TEXT NOT NULL,                 -- config | database | audit
    path         TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    sha256       TEXT,
    status       TEXT NOT NULL,                 -- ok | failed | deleted
    detail       TEXT,
    restored_at  REAL,
    restored_by  TEXT
);
CREATE TABLE IF NOT EXISTS model_versions (
    name        TEXT NOT NULL,
    sha256      TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    first_seen  REAL NOT NULL,
    validated_at REAL,
    validation  TEXT,
    PRIMARY KEY (name, sha256)
);
"""

GENESIS = "0" * 64


class AdminStore:
    """Thread-safe access to admin.db (one connection, serialized)."""

    def __init__(self, path: Path = ADMIN_DB_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self.lock = threading.RLock()
        with self.lock:
            self._conn.executescript(SCHEMA)

    # ── generic helpers ─────────────────────────────────────────────

    def q(self, sql: str, args=()) -> List[dict]:
        with self.lock:
            return [dict(r) for r in self._conn.execute(sql, args).fetchall()]

    def one(self, sql: str, args=()) -> Optional[dict]:
        with self.lock:
            r = self._conn.execute(sql, args).fetchone()
        return dict(r) if r else None

    def x(self, sql: str, args=()) -> sqlite3.Cursor:
        with self.lock:
            return self._conn.execute(sql, args)

    def tx(self):
        """``with store.tx() as c:`` — an IMMEDIATE transaction under the lock."""
        store = self

        class _Tx:
            def __enter__(self):
                store.lock.acquire()
                store._conn.execute("BEGIN IMMEDIATE")
                return store._conn

            def __exit__(self, et, ev, tb):
                try:
                    store._conn.execute("ROLLBACK" if et else "COMMIT")
                finally:
                    store.lock.release()
                return False
        return _Tx()

    # ── audit (append-only, hash-chained) ───────────────────────────

    @staticmethod
    def _entry_hash(prev_hash: str, e: Dict[str, Any]) -> str:
        canon = json.dumps([e["ts"], e["user"], e["action"], e["resource"], e["prev"], e["new"],
                            e["result"], e["detail"], e["ip"]], sort_keys=True, separators=(",", ":"))
        return hashlib.sha256((prev_hash + canon).encode()).hexdigest()

    def audit(self, user: str, action: str, resource: str, prev: Any = None, new: Any = None,
              result: str = "success", detail: Optional[str] = None, ip: Optional[str] = None,
              user_id: Optional[int] = None) -> dict:
        e = {"ts": round(time.time(), 6), "user": user, "action": action, "resource": resource,
             "prev": json.dumps(prev, sort_keys=True, default=str) if prev is not None else None,
             "new": json.dumps(new, sort_keys=True, default=str) if new is not None else None,
             "result": result, "detail": detail, "ip": ip}
        with self.tx() as c:
            r = c.execute("SELECT hash FROM audit ORDER BY id DESC LIMIT 1").fetchone()
            prev_hash = r[0] if r else GENESIS
            h = self._entry_hash(prev_hash, e)
            cur = c.execute(
                "INSERT INTO audit(ts, user, user_id, action, resource, prev, new, result, detail, ip, prev_hash, hash) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (e["ts"], user, user_id, action, resource, e["prev"], e["new"], result, detail, ip, prev_hash, h))
        return {"id": cur.lastrowid, **e, "hash": h}

    def verify_audit(self) -> dict:
        """Recompute the chain; any edited/deleted row breaks it."""
        prev = GENESIS
        n = 0
        with self.lock:
            rows = self._conn.execute(
                "SELECT id, ts, user, action, resource, prev, new, result, detail, ip, prev_hash, hash "
                "FROM audit ORDER BY id").fetchall()
        for r in rows:
            e = dict(r)
            if e["prev_hash"] != prev or self._entry_hash(prev, e) != e["hash"]:
                return {"ok": False, "entries": len(rows), "verified": n, "broken_at": e["id"]}
            prev = e["hash"]
            n += 1
        return {"ok": True, "entries": len(rows), "verified": n, "head": prev}
