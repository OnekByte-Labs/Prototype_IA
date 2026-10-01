"""
AdminService — the administration layer over the live command center.

Owns the versioned system configuration and applies it to the running system
(inference workers, alert gate, evidence/event retention, auth policy), and
computes the operational views and impact previews the console shows. Every
mutation goes through here so it is authorized, audited and pushed to
consoles over the existing WebSocket (``{"type": "admin", "topic": …}``).
"""

import hashlib
import json
import logging
import shutil
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set

import yaml

from src.pipelines import PIPELINE_CLASSES
from src.pipelines.base import DETECTION_MODES
from src.pipelines.registry import MODEL_INFO, MODELS
from src.runtime import ALERT_TYPES, camera_key

from . import config as cfgmod
from .auth import BUILTIN_ROLES, PERMISSIONS, AuthError, AuthService, Principal, hash_password
from .integrations import SecretStore
from .store import AdminStore
from .telemetry import Telemetry

logger = logging.getLogger("admin")

BACKEND = Path(__file__).resolve().parents[2]
CONFIG_FILES = ("cameras.yaml", "streams.yaml", "pipeline.yaml", "map.yaml")
TARGET_FPS = 15.0            # VideoReader target rate for every source


def iso_ago(seconds: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


class AdminService:
    def __init__(self, db, runtime, map_service, pipeline_cfg: dict, project_root: Path):
        self.db, self.runtime, self.map = db, runtime, map_service
        self.root = project_root
        self.store = AdminStore()
        self.tele = Telemetry()
        self.secrets = SecretStore()
        self._lock = threading.Lock()
        self._last_alert: Dict[tuple, float] = {}
        self.suppressed = defaultdict(int)          # reason → count since start
        self._file_hashes: Dict[str, tuple] = {}
        self.started_at = time.time()
        self._stop = threading.Event()

        if self.store.one("SELECT 1 AS x FROM config_versions LIMIT 1") is None:
            doc = cfgmod.default_config(pipeline_cfg)
            self.store.x("INSERT INTO config_versions(version, created_at, author, kind, comment, doc) "
                         "VALUES (1, ?, 'system', 'seed', 'Initial configuration (values in use before versioning)', ?)",
                         (time.time(), json.dumps(doc)))
            self.store.audit("system", "config.seed", "config:v1", new=doc)
        self._active = self._load_active()
        self.auth = AuthService(self.store, lambda: self._active["doc"]["security"],
                                BACKEND / "data" / "bootstrap_admin.txt")
        self._apply_local(self._active["doc"], None)
        self._record_model_versions()
        if self.store.one("SELECT 1 AS x FROM audit WHERE action='integrity.baseline'") is None:
            self._baseline_integrity("system")

    # ── shared snapshots ─────────────────────────────────────────────

    def health(self) -> dict:
        """Map/ingest health, shared by every view computed within ~1 s
        (a view may need it several times; computing it walks the evidence store)."""
        now = time.monotonic()
        with self._lock:
            cached = getattr(self, "_health_cache", None)
            if cached and now - cached[0] < 1.0:
                return cached[1]
        h = self.map.health_view() if self.map else {"cameras": {}, "nvrs": {}, "storage": None}
        with self._lock:
            self._health_cache = (now, h)
        return h

    def audit_status(self) -> dict:
        """Audit-chain verification, recomputed only when the chain grows."""
        head = self.store.one("SELECT MAX(id) AS id, COUNT(*) AS n FROM audit")
        key = (head["id"], head["n"])
        cached = getattr(self, "_audit_verify", None)
        if cached and cached[0] == key:
            return cached[1]
        res = self.store.verify_audit()
        self._audit_verify = (key, res)
        return res

    # ── lifecycle ────────────────────────────────────────────────────

    def start(self) -> None:
        def loop():
            while not self._stop.wait(600):
                try:
                    self.run_retention()
                except Exception:
                    logger.exception("Retention job failed")
        threading.Thread(target=loop, daemon=True, name="admin-retention").start()

    def publish(self, topic: str, **data) -> None:
        self.runtime.ws.publish({"type": "admin", "topic": topic, **data})

    def audit(self, p: Optional[Principal], action: str, resource: str, prev=None, new=None, result="success",
              detail=None) -> dict:
        e = self.store.audit(p.username if p else "system", action, resource, prev=prev, new=new, result=result,
                             detail=detail, ip=p.ip if p else None, user_id=p.user_id if p else None)
        self.publish("audit", id=e["id"], action=action)
        return e

    # ── authorization ────────────────────────────────────────────────

    def require(self, p: Principal, perm: str, global_scope: bool = False, resource: str = "") -> None:
        if not p.can(perm):
            self.audit(p, "access.denied", resource or perm, result="denied", detail=f"missing permission {perm}")
            raise AuthError(403, f"Permission required: {perm}")
        if global_scope and p.scope_type != "battalion":
            self.audit(p, "access.denied", resource or perm, result="denied",
                       detail=f"{p.scope_type}-scoped user cannot change battalion-wide settings")
            raise AuthError(403, "This change requires battalion-wide scope")

    def camera_in_scope(self, p: Principal, camera_id: str) -> bool:
        if p.scope_type == "battalion":
            return True
        site = self.db.camera_site(camera_id)
        return site.get("company_id" if p.scope_type == "company" else "post_id") == p.scope_id

    def require_camera(self, p: Principal, perm: str, camera_id: str) -> None:
        self.require(p, perm, resource=f"camera:{camera_id}")
        if not self.camera_in_scope(p, camera_id):
            self.audit(p, "access.denied", f"camera:{camera_id}", result="denied",
                       detail=f"outside {p.scope_type} scope {p.scope_id}")
            raise AuthError(403, f"{camera_id} is outside your {p.scope_type} scope ({p.scope_id})")

    def scoped_camera_ids(self, p: Principal) -> Optional[Set[str]]:
        if p.scope_type == "battalion":
            return None
        return {c["camera_id"] for c in self.db.map_cameras() if self.camera_in_scope(p, c["camera_id"])}

    # ── configuration versions ───────────────────────────────────────

    def _load_active(self) -> dict:
        r = self.store.one("SELECT * FROM config_versions ORDER BY version DESC LIMIT 1")
        r["doc"] = json.loads(r["doc"])
        return r

    @property
    def cfg(self) -> dict:
        return self._active["doc"]

    def active(self) -> dict:
        return {k: self._active[k] for k in ("version", "created_at", "author", "kind", "comment", "based_on")} | \
            {"doc": self._active["doc"]}

    def versions(self) -> List[dict]:
        rows = self.store.q("SELECT version, created_at, author, kind, comment, based_on, doc FROM config_versions "
                            "ORDER BY version DESC")
        out, docs = [], {r["version"]: json.loads(r["doc"]) for r in rows}
        for r in rows:
            prev = docs.get(r["version"] - 1)
            changes = cfgmod.diff(prev, docs[r["version"]]) if prev else []
            out.append({**{k: r[k] for k in ("version", "created_at", "author", "kind", "comment", "based_on")},
                        "changes": len(changes), "paths": [c["path"] for c in changes][:6]})
        return out

    def version_doc(self, version: int) -> Optional[dict]:
        r = self.store.one("SELECT doc FROM config_versions WHERE version=?", (version,))
        return json.loads(r["doc"]) if r else None

    def diff_versions(self, a: int, b: int) -> List[dict]:
        da, dbv = self.version_doc(a), self.version_doc(b)
        if da is None or dbv is None:
            raise KeyError("version")
        return cfgmod.diff(da, dbv)

    def config_schema(self) -> dict:
        return {"fields": {p: {"type": t.__name__, "min": lo, "max": hi, "description": d, "permission": perm}
                           for p, (t, lo, hi, d, perm) in cfgmod.FIELDS.items()},
                "strings": {p: {"description": d, "permission": perm} for p, (d, perm) in cfgmod.STRING_FIELDS.items()},
                "severities": list(cfgmod.SEVERITIES), "alert_event_types": list(cfgmod.ALERT_EVENT_TYPES)}

    def preview_config(self, proposed: dict) -> dict:
        new = cfgmod.validate(proposed, self.cfg)
        return self._impact(self.cfg, new)

    def apply_config(self, p: Principal, proposed: dict, comment: str, kind: str = "apply",
                     based_on: Optional[int] = None) -> dict:
        old = self.cfg
        new = cfgmod.validate(proposed, old)
        changes = cfgmod.diff(old, new)
        if not changes:
            raise cfgmod.ConfigError("No changes to apply")
        for perm in sorted(cfgmod.required_permissions(changes)):
            self.require(p, perm, global_scope=True, resource="config")
        impact = self._impact(old, new)
        with self.store.tx() as c:
            v = c.execute("SELECT MAX(version) FROM config_versions").fetchone()[0] + 1
            c.execute("INSERT INTO config_versions(version, created_at, author, kind, comment, based_on, doc) "
                      "VALUES (?,?,?,?,?,?,?)", (v, time.time(), p.username, kind, comment[:300], based_on,
                                                 json.dumps(new)))
        self._active = self._load_active()
        applied = self._apply_local(new, old)
        self.audit(p, f"config.{kind}", f"config:v{v}",
                   prev={c["path"]: c["old"] for c in changes}, new={c["path"]: c["new"] for c in changes},
                   detail=(comment or None))
        self.publish("config", version=v)
        return {"version": v, "changes": changes, "impact": impact, "applied": applied}

    def rollback(self, p: Principal, version: int, comment: str) -> dict:
        doc = self.version_doc(version)
        if doc is None:
            raise KeyError(f"v{version}")
        return self.apply_config(p, doc, comment or f"Rollback to v{version}", kind="rollback", based_on=version)

    def _apply_local(self, new: dict, old: Optional[dict]) -> dict:
        """Push a configuration to the running system."""
        out = {}
        ev = getattr(self.runtime, "evidence", None)
        if ev is not None:
            ev.max_files = new["retention"]["evidence_max_files"]
            ev._prune()
        restart_modes: Set[str] = set()
        if old is not None:
            for k, v in new["detection"].items():
                if old["detection"].get(k) != v:
                    restart_modes.update(cfgmod.DETECTION_MODES_FOR.get(k, ()))
        # Every worker gets every version (its acknowledgement drives offline readiness)
        msg = {"version": self._active["version"], "detection": new["detection"], "restart_modes": sorted(restart_modes)}
        self._applied_at = time.time()
        if old is not None:
            for q in self.runtime.ctrl_qs:
                q.put(("config", None, msg))
        out["restart_modes"] = sorted(restart_modes)
        out["workers_notified"] = len(self.runtime.ctrl_qs) if old is not None else 0
        return out

    def on_config_ack(self, worker: int, version: int, restarted: list) -> None:
        self.store.x("INSERT INTO config_acks(worker, version, acked_at, cameras) VALUES (?,?,?,?) "
                     "ON CONFLICT(worker) DO UPDATE SET version=excluded.version, acked_at=excluded.acked_at, "
                     "cameras=excluded.cameras", (worker, version, time.time(), json.dumps(restarted)))
        self.publish("sync", worker=worker, version=version)

    # ── alert gate (called from runtime.on_event) ────────────────────

    def alert_gate(self, ev: dict) -> Optional[str]:
        """Severity for a new alert, or None if policy suppresses it (the event itself is still stored)."""
        pol = self.cfg["alerts"]["policies"].get(ev["event_type"])
        if pol is None:
            return "med"
        if not pol["enabled"]:
            self.suppressed["disabled"] += 1
            return None
        sch = self.cfg["schedules"].get(ev["camera_id"])
        if sch:
            now = datetime.now()
            if not cfgmod.armed(sch, now.weekday(), now.strftime("%H:%M")):
                self.suppressed["schedule"] += 1
                return None
        if pol["cooldown_s"] > 0:
            key = (ev["camera_id"], ev["event_type"])
            now = time.monotonic()
            with self._lock:
                last = self._last_alert.get(key)
                if last is not None and now - last < pol["cooldown_s"]:
                    self.suppressed["cooldown"] += 1
                    return None
                self._last_alert[key] = now
        return pol["severity"]

    # ── impact analysis ──────────────────────────────────────────────

    def _cams(self) -> List[dict]:
        """Every camera with its site, runtime state and health, in one list."""
        health = self.health()["cameras"]
        out = []
        units = {u["unit_id"]: u for u in self.db.map_units()}
        for c in self.db.map_cameras():
            rc = self.runtime.cams.get(camera_key(c["camera_id"]))
            post = units.get(c["post_id"])
            co = units.get(post["parent_id"]) if post else None
            h = health.get(c["camera_id"], {})
            out.append({"camera_id": c["camera_id"], "name": c["name"], "post_id": c["post_id"],
                        "post_name": post["name"] if post else None, "company_id": co["unit_id"] if co else None,
                        "company_name": co["name"] if co else None, "source_bound": bool(c["source_id"]),
                        "mode": rc["detection_mode"] if rc else c["detection_mode"],
                        "state": rc["state"] if rc else None, "worker": self.runtime.owner.get(camera_key(c["camera_id"]))
                        if rc else None, "health": h.get("health"), "issue": h.get("issue"), "fps": h.get("fps")})
        return out

    def _users_for_cameras(self, cams: List[dict]) -> List[dict]:
        companies = {c["company_id"] for c in cams}
        posts = {c["post_id"] for c in cams}
        users = self.store.q("SELECT id, username, display_name, role, scope_type, scope_id FROM users "
                             "WHERE status='active'")
        return [u for u in users if u["scope_type"] == "battalion" or
                (u["scope_type"] == "company" and u["scope_id"] in companies) or
                (u["scope_type"] == "post" and u["scope_id"] in posts)]

    def _alert_times(self, hours: float = 24) -> Dict[tuple, List[float]]:
        """Alert-type event times per (camera, type) over the window — for replaying policy changes."""
        since = iso_ago(hours * 3600)
        with self.db._lock:
            rows = self.db._conn.execute(
                "SELECT camera_id, event_type, timestamp FROM events WHERE timestamp >= ? AND event_type IN "
                f"({','.join('?' * len(ALERT_TYPES))}) ORDER BY timestamp", (since, *ALERT_TYPES)).fetchall()
        out = defaultdict(list)
        for cam, et, ts in rows:
            out[(cam, et)].append(datetime.fromisoformat(ts))
        return out

    @staticmethod
    def _replay(times: List[datetime], pol: dict, sch: Optional[list]) -> int:
        """How many alerts this policy would have raised for these event times."""
        if not pol["enabled"]:
            return 0
        n, last = 0, None
        for t in times:
            lt = t.astimezone()
            if sch and not cfgmod.armed(sch, lt.weekday(), lt.strftime("%H:%M")):
                continue
            if pol["cooldown_s"] and last is not None and (t - last).total_seconds() < pol["cooldown_s"]:
                continue
            last = t
            n += 1
        return n

    def _impact(self, old: dict, new: dict) -> dict:
        changes = cfgmod.diff(old, new)
        cams = self._cams()
        running = [c for c in cams if c["state"] in ("running", "starting")]
        affected_cams: Dict[str, dict] = {}
        notes: List[str] = []
        pipelines: Dict[str, dict] = {}
        gpu = None
        storage = {}
        sessions = None
        paths = {c["path"] for c in changes}

        # detection thresholds → restart of every running pipeline that reads them
        modes: Set[str] = set()
        for pth in paths:
            if pth.startswith("detection."):
                modes.update(cfgmod.DETECTION_MODES_FOR.get(pth.split(".", 1)[1], ()))
        for c in running:
            if c["mode"] in modes:
                affected_cams[c["camera_id"]] = {**c, "effect": "pipeline restart (≈1–5 s without detection)"}
                pipelines.setdefault(c["mode"], {"mode": c["mode"], "label": DETECTION_MODES[c["mode"]],
                                                 "cameras": 0, "effect": "restart"})["cameras"] += 1
        if "detection.detect_interval" in paths:
            o, n = old["detection"]["detect_interval"], new["detection"]["detect_interval"]
            load = self.compute_load()
            det = sum(v["gpu_ms_per_s"] for v in load["cameras"].values())
            gpu = {"detector_runs_factor": round(o / n, 3),
                   "current_pipeline_ms_per_s": round(det, 1),
                   "projected_pipeline_ms_per_s": round(det * o / n, 1),
                   "note": "detector share of pipeline time scales with 1/detect_interval (estimate)"}

        # alert policy / schedules → replay the last 24 h of real alert events
        if any(p.startswith(("alerts.", "schedules.")) for p in paths):
            times = self._alert_times()
            replay = []
            for (cam, et), ts in times.items():
                po, pn = old["alerts"]["policies"][et], new["alerts"]["policies"][et]
                so, sn = old["schedules"].get(cam), new["schedules"].get(cam)
                a, b = self._replay(ts, po, so), self._replay(ts, pn, sn)
                if a != b:
                    replay.append({"camera_id": cam, "event_type": et, "events": len(ts), "alerts_before": a,
                                   "alerts_after": b})
                    c = next((x for x in cams if x["camera_id"] == cam), None)
                    if c:
                        affected_cams.setdefault(cam, {**c, "effect": f"alerts {a} → {b} (last 24 h replay)"})
            for pth in paths:
                if pth.startswith("schedules."):
                    cam = pth.split(".")[1]
                    c = next((x for x in cams if x["camera_id"] == cam), None)
                    if c:
                        affected_cams.setdefault(cam, {**c, "effect": "arming schedule changed"})
            notes.append("Alert changes replayed against the last 24 h of stored alert events; "
                         "events are always recorded, only alert raising changes.")
            storage["alert_replay"] = replay

        # retention → what would be deleted now
        r_old, r_new = old["retention"], new["retention"]
        ev = getattr(self.runtime, "evidence", None)
        if r_new["evidence_max_files"] != r_old["evidence_max_files"] and ev is not None:
            storage["evidence_files_deleted"] = max(0, len(ev._files) - r_new["evidence_max_files"])
        if r_new["event_retention_days"] != r_old["event_retention_days"] and r_new["event_retention_days"] > 0:
            storage["events_deleted"] = self.db.events_older_than(iso_ago(r_new["event_retention_days"] * 86400))
        if r_new["backup_keep"] < r_old["backup_keep"]:
            kept = defaultdict(int)
            for b in self.store.q("SELECT kind FROM backups WHERE status='ok'"):
                kept[b["kind"]] += 1
            storage["backups_deleted"] = sum(max(0, n - r_new["backup_keep"]) for n in kept.values())

        # security → sessions and users
        so, sn = old["security"], new["security"]
        if so != sn:
            now = time.time()
            act = self.auth.active_sessions()
            ends = [s for s in act if now - s["created_at"] > sn["session_ttl_hours"] * 3600
                    or now - s["last_seen"] > sn["idle_timeout_minutes"] * 60]
            weak = sn["password_min_length"] > so["password_min_length"]
            sessions = {"active": len(act), "would_end": [{"id": s["id"], "username": s["username"]} for s in ends],
                        "password_policy_tightened": weak}
            if weak:
                notes.append("Stronger password policy applies at each user's next password change.")

        users = self._users_for_cameras(list(affected_cams.values())) if affected_cams else []
        if sessions is not None:
            users = self.store.q("SELECT id, username, display_name, role, scope_type, scope_id FROM users "
                                 "WHERE status='active'")
        company_ids = {c["company_id"] for c in affected_cams.values() if c["company_id"]}
        nvrs = [n for n in self.db.map_nvrs() if n["company_id"] in company_ids]
        return {"changes": changes, "required_permissions": sorted(cfgmod.required_permissions(changes)),
                "cameras": sorted(affected_cams.values(), key=lambda c: c["camera_id"]),
                "nvrs": nvrs, "pipelines": list(pipelines.values()), "gpu": gpu, "storage": storage,
                "sessions": sessions, "users": users, "notes": notes}

    # ── compute / GPU ────────────────────────────────────────────────

    def _pipeline_health(self) -> Dict[str, dict]:
        out = {}
        for idx, h in self.runtime.health.items():
            for c in h.get("cameras", {}).values():
                out[c["camera_id"]] = {**c, "worker": idx}
        return out

    def compute_load(self) -> dict:
        """Measured per-camera pipeline load (fps × mean pipeline time)."""
        cams = {}
        for cid, c in self._pipeline_health().items():
            p = c.get("pipeline") or {}
            if not p or c.get("mode") in (None, "none"):
                continue
            ms, fps = p.get("avg_infer_ms") or 0.0, p.get("fps") or 0.0
            cams[cid] = {"camera_id": cid, "mode": c["mode"], "worker": c["worker"], "state": c["state"],
                         "fps": fps, "avg_ms": ms, "gpu_ms_per_s": round(ms * fps, 1),
                         "models": p.get("models", [])}
        by_mode = defaultdict(list)
        for c in cams.values():
            by_mode[c["mode"]].append(c)
        mode_avg = {m: {"cameras": len(v), "avg_ms": round(sum(x["avg_ms"] for x in v) / len(v), 2),
                        "avg_ms_per_s": round(sum(x["gpu_ms_per_s"] for x in v) / len(v), 1)} for m, v in by_mode.items()}
        return {"cameras": cams, "modes": mode_avg}

    def compute_view(self) -> dict:
        gpu = self.tele.gpu()
        load = self.compute_load()
        pids = getattr(self.runtime, "worker_pids", {})
        procs = {pr["pid"]: pr for pr in gpu.get("processes", [])}
        workers = []
        for idx, pid in sorted(pids.items()):
            h = self.runtime.health.get(idx, {})
            cams = [c for c in load["cameras"].values() if c["worker"] == idx]
            workers.append({"worker": idx, "pid": pid, "alive": self.tele.process_alive(pid),
                            "vram_mib": (procs.get(pid) or {}).get("used_mib"),
                            "models_loaded": sorted((h.get("models") or {}).keys()),
                            "providers": h.get("model_providers") or {},
                            "cameras": len(cams), "pipeline_ms_per_s": round(sum(c["gpu_ms_per_s"] for c in cams), 1)})
        g = (gpu.get("gpus") or [None])[0]
        cap = self.cfg["capacity"]
        warnings = []
        if g:
            if g["util_pct"] is not None and g["util_pct"] >= cap["gpu_util_warn_pct"]:
                warnings.append(f"GPU utilization {g['util_pct']:.0f}% ≥ {cap['gpu_util_warn_pct']}% threshold")
            if g["mem_total_mib"] and g["mem_used_mib"] / g["mem_total_mib"] * 100 >= cap["vram_warn_pct"]:
                warnings.append(f"VRAM {g['mem_used_mib']:.0f}/{g['mem_total_mib']:.0f} MiB ≥ {cap['vram_warn_pct']}%")
        pipelines = defaultdict(int)
        for c in self.runtime.cams.values():
            pipelines[c["state"]] += 1
        return {"gpu": gpu, "primary": g, "workers": workers, "cameras": sorted(load["cameras"].values(),
                key=lambda c: -c["gpu_ms_per_s"]), "modes": load["modes"], "pipeline_states": dict(pipelines),
                "thresholds": cap, "warnings": warnings}

    def _model_vram_estimate(self, name: str) -> float:
        size = sum((MODELS / f).stat().st_size for f in MODEL_INFO[name]["files"] if (MODELS / f).exists())
        return round(size / 2 ** 20 * 4 + 150, 0)    # weights ×4 (FP16 engine + activations) + session overhead

    def assignment_preview(self, camera_id: str, mode: str) -> dict:
        if mode not in DETECTION_MODES:
            raise ValueError(f"Unknown mode {mode}")
        cam = self.runtime.get(camera_id)
        key = cam["key"]
        worker = self.runtime.owner[key]
        h = self.runtime.health.get(worker, {})
        loaded = h.get("models") or {}
        need = set(PIPELINE_CLASSES[mode].model_names)
        cur = set(PIPELINE_CLASSES[cam["detection_mode"]].model_names) if cam["detection_mode"] in PIPELINE_CLASSES else set()
        loads = sorted(m for m in need if m not in loaded)
        unloads = sorted(m for m in cur - need if set(loaded.get(m, [])) <= {cam["camera_id"]})
        load = self.compute_load()
        mine = load["cameras"].get(cam["camera_id"], {}).get("gpu_ms_per_s", 0.0)
        per = (load["modes"].get(mode) or {}).get("avg_ms_per_s")
        measured = per is not None
        if per is None:
            per = 0.0 if mode == "none" else None
        gpu = self.tele.gpu()
        g = (gpu.get("gpus") or [None])[0]
        cap = self.cfg["capacity"]
        warnings, proj = [], {}
        if g:
            util_now = g["util_pct"] or 0.0
            delta_ms = (per or 0.0) - mine
            proj["gpu_util_pct"] = round(min(100.0, max(0.0, util_now + delta_ms / 10.0)), 1)
            vram_add = sum(self._model_vram_estimate(m) for m in loads)
            vram_free = sum(self._model_vram_estimate(m) for m in unloads)
            proj["vram_mib"] = round(g["mem_used_mib"] + vram_add - vram_free, 0)
            proj["vram_total_mib"] = g["mem_total_mib"]
            proj["vram_delta_mib"] = vram_add - vram_free
            if proj["gpu_util_pct"] >= cap["gpu_util_warn_pct"]:
                warnings.append(f"Projected GPU utilization {proj['gpu_util_pct']}% ≥ {cap['gpu_util_warn_pct']}%")
            if g["mem_total_mib"] and proj["vram_mib"] / g["mem_total_mib"] * 100 >= cap["vram_warn_pct"]:
                warnings.append(f"Projected VRAM {proj['vram_mib']:.0f}/{g['mem_total_mib']:.0f} MiB ≥ {cap['vram_warn_pct']}%")
        else:
            warnings.append("GPU telemetry unavailable — capacity cannot be checked")
        if per is None:
            warnings.append(f"No camera currently runs {DETECTION_MODES[mode]} — load not measured")
        site = self.db.camera_site(cam["camera_id"])
        nvr = next((n for n in self.db.map_nvrs() if n["company_id"] == site.get("company_id")), None)
        since = iso_ago(86400)
        alerts_24h = self.db.recent_event_counts(since, [cam["camera_id"]]).get(cam["camera_id"], 0)
        c = next((x for x in self._cams() if x["camera_id"] == cam["camera_id"]), {})
        return {
            "camera": {**c, "current_mode": cam["detection_mode"], "state": cam["state"]},
            "mode": mode, "mode_label": DETECTION_MODES[mode],
            "worker": worker, "models_needed": sorted(need), "models_to_load": loads, "models_to_unload": unloads,
            "load": {"current_ms_per_s": mine, "projected_ms_per_s": per, "measured": measured},
            "gpu": {"now": g, "projected": proj}, "warnings": warnings,
            "nvr": nvr, "events_24h": alerts_24h,
            "users": self._users_for_cameras([c]) if c else [],
            "effects": [f"{cam['camera_id']} pipeline {cam['detection_mode']} → {mode} (video keeps streaming)"]
            + ([f"load {', '.join(loads)} in worker {worker}"] if loads else [])
            + ([f"unload {', '.join(unloads)} from worker {worker}"] if unloads else []),
        }

    def assign_mode(self, p: Principal, camera_id: str, mode: str, force: bool = False) -> dict:
        self.require_camera(p, "detection.manage", camera_id)
        prev = self.assignment_preview(camera_id, mode)
        if prev["warnings"] and not force:
            raise AuthError(409, "Capacity warnings: " + "; ".join(prev["warnings"]) + " — confirm to proceed")
        before = self.runtime.get(camera_id)["detection_mode"]
        try:
            res = self.runtime.request_mode(camera_id, mode)
        except Exception as e:
            self.audit(p, "detection.mode", f"camera:{camera_id}", prev=before, new=mode, result="failed", detail=str(e))
            raise
        self.audit(p, "detection.mode", f"camera:{camera_id}", prev=before, new=mode,
                   detail=("; ".join(prev["warnings"]) + " (confirmed)") if prev["warnings"] else None)
        return res

    # ── models ───────────────────────────────────────────────────────

    def _file_hash(self, path: Path) -> Optional[str]:
        if not path.exists():
            return None
        st = path.stat()
        key = str(path)
        cached = self._file_hashes.get(key)
        if cached and cached[0] == (st.st_mtime, st.st_size):
            return cached[1]
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        self._file_hashes[key] = ((st.st_mtime, st.st_size), h.hexdigest())
        return h.hexdigest()

    def _model_digest(self, name: str) -> tuple:
        h, size = hashlib.sha256(), 0
        for f in MODEL_INFO[name]["files"]:
            fh = self._file_hash(MODELS / f)
            if fh is None:
                return None, 0
            h.update(fh.encode())
            size += (MODELS / f).stat().st_size
        return h.hexdigest(), size

    def _record_model_versions(self) -> None:
        for name in MODEL_INFO:
            digest, size = self._model_digest(name)
            if digest:
                self.store.x("INSERT OR IGNORE INTO model_versions(name, sha256, size_bytes, first_seen) VALUES (?,?,?,?)",
                             (name, digest, size, time.time()))

    def models_view(self) -> dict:
        self._record_model_versions()
        cams = self._cams()
        load = self.compute_load()
        out = []
        loaded_in = defaultdict(list)
        providers = defaultdict(set)
        for idx, h in self.runtime.health.items():
            for m, owners in (h.get("models") or {}).items():
                loaded_in[m].append({"worker": idx, "cameras": owners})
            for m, prov in (h.get("model_providers") or {}).items():
                providers[m].update(prov)
        for name, info in MODEL_INFO.items():
            modes = [m for m, cls in PIPELINE_CLASSES.items() if name in cls.model_names]
            digest, size = self._model_digest(name)
            vers = self.store.q("SELECT sha256, size_bytes, first_seen, validated_at, validation FROM model_versions "
                                "WHERE name=? ORDER BY first_seen DESC", (name,))
            cur = next((v for v in vers if v["sha256"] == digest), None)
            assigned = [c["camera_id"] for c in cams if c["mode"] in modes]
            perf = [load["modes"][m] | {"mode": m} for m in modes if m in load["modes"]]
            status = ("missing" if digest is None else "loaded" if loaded_in.get(name)
                      else "idle (no camera assigned)" if not assigned else "not loaded")
            out.append({
                "name": name, **info, "pipelines": modes, "files_present": digest is not None,
                "version": digest[:12] if digest else None, "sha256": digest, "size_bytes": size,
                "versions": [{**v, "validation": json.loads(v["validation"]) if v["validation"] else None,
                              "current": v["sha256"] == digest} for v in vers],
                "validated": json.loads(cur["validation"]) if cur and cur["validation"] else None,
                "validated_at": cur["validated_at"] if cur else None,
                "assigned_cameras": assigned, "loaded_in": loaded_in.get(name, []),
                "runtime": sorted(providers.get(name, [])), "performance": perf, "status": status,
                "vram_estimate_mib": self._model_vram_estimate(name) if digest else None,
            })
        return {"models": out, "modes": {m: {"label": DETECTION_MODES[m], "models": list(PIPELINE_CLASSES[m].model_names)}
                                         for m in DETECTION_MODES}}

    def validate_model(self, p: Principal, name: str) -> dict:
        if name not in MODEL_INFO:
            raise KeyError(name)
        import onnxruntime as ort
        digest, size = self._model_digest(name)
        res = {"checked_at": time.time(), "files": [], "ok": True}
        for f in MODEL_INFO[name]["files"]:
            path = MODELS / f
            item = {"file": f, "exists": path.exists()}
            if not path.exists():
                res["ok"] = False
            elif f.endswith(".onnx"):
                t0 = time.perf_counter()
                try:
                    s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
                    item.update({"loads": True, "load_ms": round((time.perf_counter() - t0) * 1000, 1),
                                 "inputs": [{"name": i.name, "shape": [str(d) for d in i.shape], "type": i.type}
                                            for i in s.get_inputs()],
                                 "outputs": [{"name": o.name, "shape": [str(d) for d in o.shape]} for o in s.get_outputs()],
                                 "opset": [f"{o.domain or 'ai.onnx'}:{o.version}" for o in
                                           __import__("onnx").load(str(path), load_external_data=False).opset_import]
                                 if __import__("importlib").util.find_spec("onnx") else None})
                    del s
                except Exception as e:
                    item.update({"loads": False, "error": str(e)[:300]})
                    res["ok"] = False
            item["sha256"] = self._file_hash(path)
            res["files"].append(item)
        res["sha256"] = digest
        if digest:
            self.store.x("UPDATE model_versions SET validated_at=?, validation=? WHERE name=? AND sha256=?",
                         (res["checked_at"], json.dumps(res), name, digest))
        self.audit(p, "model.validate", f"model:{name}", new={"version": (digest or "")[:12], "ok": res["ok"]},
                   result="success" if res["ok"] else "failed")
        self.publish("models", name=name)
        return res

    # ── offline readiness ────────────────────────────────────────────

    def readiness(self) -> dict:
        v = self._active["version"]
        acks = {a["worker"]: a for a in self.store.q("SELECT * FROM config_acks")}
        pids = getattr(self.runtime, "worker_pids", {})
        sync = self.cfg["sync"]
        now = time.time()
        applied_at = getattr(self, "_applied_at", self.started_at)
        workers = {}
        for idx in range(len(self.runtime.ctrl_qs)):
            a = acks.get(idx)
            alive = self.tele.process_alive(pids[idx]) if idx in pids else False
            if not alive:
                st = "OFFLINE"
            elif a and a["version"] == v:
                st = "SYNCED"
            elif now - applied_at < sync["ack_timeout_s"]:
                st = "PENDING"
            else:
                st = "OUT_OF_SYNC"
            workers[idx] = {"worker": idx, "alive": alive, "acked_version": a["version"] if a else None,
                            "acked_at": a["acked_at"] if a else None, "status": st}
        units = self.db.map_units()
        cams = self._cams()
        out = []
        for co in (u for u in units if u["unit_type"] == "company"):
            mine = [c for c in cams if c["company_id"] == co["unit_id"]]
            ws = sorted({c["worker"] for c in mine if c["worker"] is not None})
            if not ws:
                out.append({"company_id": co["unit_id"], "name": co["name"], "status": "NO_EDGE", "workers": [],
                            "cameras": len(mine), "bound": 0, "version": None, "last_sync": None,
                            "valid_until": None, "valid": None})
                continue
            wst = [workers[w] for w in ws]
            status = ("OFFLINE" if any(w["status"] == "OFFLINE" for w in wst) else
                      "OUT_OF_SYNC" if any(w["status"] == "OUT_OF_SYNC" for w in wst) else
                      "PENDING" if any(w["status"] == "PENDING" for w in wst) else "SYNCED")
            synced = [w["acked_at"] for w in wst if w["acked_version"] == v and w["acked_at"]]
            last = min(synced) if len(synced) == len(wst) else max((w["acked_at"] or 0) for w in wst) or None
            valid_until = last + sync["offline_validity_hours"] * 3600 if last else None
            out.append({"company_id": co["unit_id"], "name": co["name"], "status": status, "workers": ws,
                        "cameras": len(mine), "bound": sum(c["source_bound"] for c in mine),
                        "version": min((w["acked_version"] or 0) for w in wst), "last_sync": last,
                        "valid_until": valid_until, "valid": bool(valid_until and valid_until > now)})
        return {"active_version": v, "now": now, "workers": list(workers.values()), "companies": out,
                "offline_validity_hours": sync["offline_validity_hours"]}

    # ── overview / issues ────────────────────────────────────────────

    def issues(self, cams: Optional[List[dict]] = None) -> List[dict]:
        cams = cams if cams is not None else self._cams()
        out = []
        for c in cams:
            if c["source_bound"] and c["health"] in ("OFFLINE", "DEGRADED"):
                out.append({"severity": "high" if c["health"] == "OFFLINE" else "med", "area": "Camera",
                            "resource": c["camera_id"], "issue": c["issue"] or c["health"],
                            "where": f"{c['company_name'] or '—'} / {c['post_name'] or '—'}"})
            if c["state"] == "error":
                rc = self.runtime.cams.get(camera_key(c["camera_id"]))
                out.append({"severity": "high", "area": "Pipeline", "resource": c["camera_id"],
                            "issue": (rc or {}).get("error") or "pipeline error", "where": c["company_name"] or "—"})
        nh = self.health()["nvrs"]
        for nid, n in nh.items():
            if n["bound"] and n["status"] != "ONLINE":
                out.append({"severity": "high" if n["status"] == "OFFLINE" else "med", "area": "NVR", "resource": nid,
                            "issue": n.get("issue") or n["status"], "where": n["company_id"]})
        comp = self.compute_view()
        for w in comp["warnings"]:
            out.append({"severity": "med", "area": "GPU", "resource": (comp["primary"] or {}).get("name", "GPU"),
                        "issue": w, "where": "compute"})
        for w in comp["workers"]:
            if not w["alive"]:
                out.append({"severity": "high", "area": "Compute", "resource": f"worker {w['worker']}",
                            "issue": "inference worker process not running", "where": "compute"})
        st = self.tele.storage()["volume"]
        pct = st["used_bytes"] / st["total_bytes"] * 100
        if pct >= self.cfg["capacity"]["storage_warn_pct"]:
            out.append({"severity": "high", "area": "Storage", "resource": "recording volume",
                        "issue": f"{pct:.0f}% used", "where": st["path"]})
        for co in self.readiness()["companies"]:
            if co["status"] in ("OUT_OF_SYNC", "OFFLINE"):
                out.append({"severity": "med", "area": "Policy sync", "resource": co["company_id"],
                            "issue": f"edge policy {co['status'].replace('_', ' ').lower()}", "where": co["name"]})
        fails = self.store.one("SELECT COUNT(*) AS n FROM login_attempts WHERE success=0 AND ts > ?",
                               (time.time() - 86400,))["n"]
        if fails >= self.cfg["security"]["lockout_threshold"]:
            out.append({"severity": "med", "area": "Security", "resource": "authentication",
                        "issue": f"{fails} failed logins in 24 h", "where": "auth"})
        locked = self.store.q("SELECT username FROM users WHERE locked_until > ?", (time.time(),))
        for u in locked:
            out.append({"severity": "med", "area": "Security", "resource": f"user:{u['username']}",
                        "issue": "account locked after failed logins", "where": "auth"})
        pend = self.store.q("SELECT username FROM users WHERE must_change_password=1 AND status='active'")
        if pend:
            out.append({"severity": "low", "area": "Security", "resource": ", ".join(u["username"] for u in pend),
                        "issue": "temporary password not yet changed", "where": "auth"})
        fb = len(self.db.feedback(status="pending"))
        if fb:
            out.append({"severity": "low", "area": "Models", "resource": "improvement queue",
                        "issue": f"{fb} feedback item(s) awaiting review", "where": "models"})
        rank = {"high": 0, "med": 1, "low": 2}
        return sorted(out, key=lambda i: rank[i["severity"]])

    def overview(self) -> dict:
        cams = self._cams()
        health = defaultdict(int)
        for c in cams:
            health[c["health"] or "UNKNOWN"] += 1
        nh = self.health()
        nvr_status = defaultdict(int)
        for n in nh["nvrs"].values():
            nvr_status[n["status"]] += 1
        comp = self.compute_view()
        modes = defaultdict(int)
        for c in self.runtime.cams.values():
            modes[c["detection_mode"]] += 1
        net = self.tele.network()
        up = [n for n in net if n["operstate"] == "up" and not n["virtual"]]
        storage = self.tele.storage()
        return {
            "site": self.cfg["system"], "config_version": self._active["version"],
            "config_applied_at": self._active["created_at"], "config_author": self._active["author"],
            "cameras": {"registered": len(cams), "source_bound": sum(c["source_bound"] for c in cams),
                        "health": dict(health)},
            "nvrs": {"registered": len(nh["nvrs"]), "status": dict(nvr_status)},
            "pipelines": {"states": comp["pipeline_states"], "modes": dict(modes)},
            "gpu": comp["primary"], "gpu_warnings": comp["warnings"],
            "workers": [{k: w[k] for k in ("worker", "alive", "cameras", "vram_mib")} for w in comp["workers"]],
            "storage": storage["volume"],
            "network": {"interfaces_up": len(up), "physical": sum(not n["virtual"] for n in net),
                        "ws_clients": len(self.runtime.ws.clients)},
            "users": {"total": self.store.one("SELECT COUNT(*) AS n FROM users")["n"],
                      "sessions": len(self.auth.active_sessions())},
            "alerts_suppressed": dict(self.suppressed),
            "issues": self.issues(cams),
            "uptime_s": time.time() - self.started_at,
        }

    # ── hierarchy ────────────────────────────────────────────────────

    def hierarchy(self) -> dict:
        units = self.db.map_units()
        cams = self._cams()
        devices = {d["camera_id"]: d for d in self.db.devices()}
        nvrs = self.db.map_nvrs()
        users = self.store.q("SELECT username, display_name, role, scope_type, scope_id FROM users WHERE status='active'")
        bn = next((u for u in units if u["unit_type"] == "battalion"), None)
        companies = []
        for co in sorted((u for u in units if u["unit_type"] == "company"), key=lambda u: u["sort_order"]):
            posts = []
            for po in sorted((u for u in units if u["unit_type"] == "post" and u["parent_id"] == co["unit_id"]),
                             key=lambda u: u["sort_order"]):
                pc = [c | {"nvr_channel": devices.get(c["camera_id"], {}).get("nvr_channel")}
                      for c in cams if c["post_id"] == po["unit_id"]]
                posts.append({"id": po["unit_id"], "name": po["name"], "latitude": po["latitude"],
                              "longitude": po["longitude"], "cameras": pc,
                              "users": [u for u in users if u["scope_type"] == "post" and u["scope_id"] == po["unit_id"]]})
            companies.append({"id": co["unit_id"], "name": co["name"], "latitude": co["latitude"],
                              "longitude": co["longitude"], "posts": posts,
                              "nvr": next((n for n in nvrs if n["company_id"] == co["unit_id"]), None),
                              "users": [u for u in users if u["scope_type"] == "company" and u["scope_id"] == co["unit_id"]]})
        unassigned = [c for c in cams if c["post_id"] is None]
        return {"revision": self.db.map_revision(), "battalion": bn, "companies": companies, "unassigned": unassigned}

    def _map_body(self) -> dict:
        v = self.map.config_view()
        return {"revision": v["revision"],
                "battalion": {"name": v["battalion"]["name"], "latitude": v["battalion"]["latitude"],
                              "longitude": v["battalion"]["longitude"], "boundary": v["battalion"].get("boundary")},
                "companies": [{k: c[k] for k in ("id", "name", "latitude", "longitude")} for c in v["companies"]],
                "posts": [{k: c[k] for k in ("id", "parent_id", "name", "latitude", "longitude")} for c in v["posts"]],
                "cameras": [{"id": c["id"], "parent_id": c["parent_id"], "latitude": c["latitude"],
                             "longitude": c["longitude"], "bearing": c["bearing"], "fov_angle": c["fov_angle"],
                             "range": c["range"]} for c in v["cameras"]],
                "nvrs": [{k: n[k] for k in ("id", "parent_id", "name", "latitude", "longitude")} for n in v["nvrs"]]}

    def hierarchy_change(self, p: Optional[Principal], op: dict, apply: bool) -> dict:
        """Preview or apply one hierarchy operation through the map service's validated save path."""
        body = self._map_body()
        kind = op.get("op")
        cams_by_post = defaultdict(list)
        for c in body["cameras"]:
            cams_by_post[c["parent_id"]].append(c["id"])
        affected_cams: List[str] = []
        summary = ""
        if kind == "rename":
            uid, name = op["id"], str(op.get("name", "")).strip()
            lst = body["companies"] if any(c["id"] == uid for c in body["companies"]) else body["posts"]
            unit = next((u for u in lst if u["id"] == uid), None)
            if unit is None:
                raise KeyError(uid)
            summary = f"Rename {uid}: {unit['name']} → {name}"
            unit["name"] = name
        elif kind == "add_post":
            co = next((c for c in body["companies"] if c["id"] == op["company_id"]), None)
            if co is None:
                raise KeyError(op["company_id"])
            n = 1 + max([int(x["id"].split("-")[-1]) for x in body["posts"] if x["parent_id"] == co["id"]
                         and x["id"].split("-")[-1].isdigit()] or [0])
            pid = op.get("id") or f"P-{co['id'].split('-')[-1]}-{n:02d}"
            body["posts"].append({"id": pid, "parent_id": co["id"], "name": op.get("name") or f"POST {n:02d}",
                                  "latitude": float(op.get("latitude", co["latitude"])),
                                  "longitude": float(op.get("longitude", co["longitude"]))})
            summary = f"Add post {pid} to {co['id']}"
        elif kind == "add_company":
            n = 1 + max([int(c["id"].split("-")[-1]) for c in body["companies"] if c["id"].split("-")[-1].isdigit()] or [0])
            cid = op.get("id") or f"COY-{n:02d}"
            body["companies"].append({"id": cid, "name": op.get("name") or f"COMPANY {n:02d}",
                                      "latitude": float(op.get("latitude", body["battalion"]["latitude"])),
                                      "longitude": float(op.get("longitude", body["battalion"]["longitude"]))})
            summary = f"Add company {cid}"
        elif kind == "delete_post":
            pid = op["id"]
            if cams_by_post.get(pid):
                raise ValueError(f"{pid} still has {len(cams_by_post[pid])} camera(s) — reassign them first")
            body["posts"] = [x for x in body["posts"] if x["id"] != pid]
            summary = f"Delete post {pid}"
        elif kind == "delete_company":
            cid = op["id"]
            if any(x["parent_id"] == cid for x in body["posts"]):
                raise ValueError(f"{cid} still has posts — delete or move them first")
            body["companies"] = [x for x in body["companies"] if x["id"] != cid]
            summary = f"Delete company {cid}"
        elif kind == "move_camera":
            cam = next((c for c in body["cameras"] if c["id"] == op["camera_id"]), None)
            if cam is None:
                raise KeyError(op["camera_id"])
            target = op.get("post_id")
            if target is not None and not any(x["id"] == target for x in body["posts"]):
                raise KeyError(target)
            summary = f"Move {cam['id']}: {cam['parent_id'] or 'unassigned'} → {target or 'unassigned'}"
            cam["parent_id"] = target
            affected_cams = [cam["id"]]
        else:
            raise ValueError(f"Unknown hierarchy operation {kind}")

        # impact: cameras, NVR coverage, users whose scope changes
        before = {c["id"]: c["parent_id"] for c in self._map_body()["cameras"]}
        post_company = {x["id"]: x["parent_id"] for x in body["posts"]}
        old_post_company = {x["id"]: x["parent_id"] for x in self._map_body()["posts"]}
        cams_info = {c["camera_id"]: c for c in self._cams()}
        impact_cams = []
        for cid in affected_cams:
            oc, nc = old_post_company.get(before.get(cid)), post_company.get(op.get("post_id"))
            impact_cams.append({**cams_info[cid], "from_company": oc, "to_company": nc,
                                "effect": f"recorded by {nc or 'no'} NVR, visible to {nc or 'battalion'}-scoped users"
                                if oc != nc else "post reassignment within the company"})
        removed = {op.get("id")} if kind in ("delete_post", "delete_company") else set()
        users = [u for u in self.store.q("SELECT username, display_name, role, scope_type, scope_id FROM users")
                 if u["scope_id"] in removed or (impact_cams and u["scope_id"] in
                                                 {c.get("from_company") for c in impact_cams} |
                                                 {c.get("to_company") for c in impact_cams} |
                                                 {before.get(c["camera_id"]) for c in impact_cams} |
                                                 {op.get("post_id")})]
        warnings = [f"{u['username']} is scoped to {u['scope_id']}, which will no longer exist" for u in users
                    if u["scope_id"] in removed]
        result = {"summary": summary, "cameras": impact_cams, "users": users, "warnings": warnings,
                  "revision": body["revision"]}
        if not apply:
            return result
        self.require(p, "hierarchy.manage", global_scope=True, resource="hierarchy")
        if warnings and not op.get("force"):
            raise AuthError(409, "; ".join(warnings) + " — reassign those users first or confirm")
        self.map.save_internal(body)
        self.audit(p, f"hierarchy.{kind}", op.get("id") or op.get("camera_id") or op.get("company_id") or "hierarchy",
                   prev={"camera_post": {c: before.get(c) for c in affected_cams}} if affected_cams else None,
                   new=op, detail=summary)
        self.publish("hierarchy")
        return result

    # ── users / roles ────────────────────────────────────────────────

    USER_COLS = ("id", "username", "display_name", "service_no", "role", "scope_type", "scope_id", "status",
                 "must_change_password", "failed_count", "locked_until", "last_login_at", "last_login_ip",
                 "created_at", "updated_at", "password_changed_at")

    def users(self) -> List[dict]:
        rows = self.store.q(f"SELECT {', '.join(self.USER_COLS)} FROM users ORDER BY username")
        sess = defaultdict(int)
        for s in self.auth.active_sessions():
            sess[s["user_id"]] += 1
        return [r | {"active_sessions": sess[r["id"]], "locked": bool(r["locked_until"] and r["locked_until"] > time.time())}
                for r in rows]

    def roles(self) -> List[dict]:
        counts = defaultdict(int)
        for u in self.store.q("SELECT role FROM users"):
            counts[u["role"]] += 1
        return [r | {"permissions": json.loads(r["permissions"]), "users": counts[r["name"]]}
                for r in self.store.q("SELECT * FROM roles ORDER BY builtin DESC, name")]

    def _check_scope(self, scope_type: str, scope_id: Optional[str]) -> None:
        if scope_type not in ("battalion", "company", "post"):
            raise ValueError("scope must be battalion, company or post")
        if scope_type == "battalion":
            return
        if not any(u["unit_id"] == scope_id and u["unit_type"] == scope_type for u in self.db.map_units()):
            raise ValueError(f"{scope_type} '{scope_id}' does not exist")

    def _admins_left(self, excluding: int) -> int:
        return self.store.one("SELECT COUNT(*) AS n FROM users WHERE role='administrator' AND status='active' "
                              "AND scope_type='battalion' AND id != ?", (excluding,))["n"]

    def create_user(self, p: Principal, body: dict) -> dict:
        self.require(p, "users.manage", global_scope=True, resource="users")
        username = str(body.get("username", "")).strip()
        if not username or len(username) > 32 or not username.replace(".", "").replace("_", "").replace("-", "").isalnum():
            raise ValueError("username must be 1–32 letters, digits, . _ -")
        role = body.get("role")
        if not self.store.one("SELECT 1 AS x FROM roles WHERE name=?", (role,)):
            raise ValueError(f"Unknown role {role}")
        st, sid = body.get("scope_type", "battalion"), body.get("scope_id") or None
        self._check_scope(st, sid)
        pw = body.get("password") or ""
        self.auth.check_password_policy(pw)
        now = time.time()
        try:
            cur = self.store.x(
                "INSERT INTO users(username, display_name, service_no, role, scope_type, scope_id, status, "
                "must_change_password, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?, 'active', 1, ?,?,?)",
                (username, str(body.get("display_name") or username)[:64], str(body.get("service_no") or "")[:32],
                 role, st, sid if st != "battalion" else None, hash_password(pw), now, now))
        except Exception as e:
            if "UNIQUE" in str(e):
                raise ValueError(f"User {username} already exists")
            raise
        new = {"username": username, "role": role, "scope": f"{st}:{sid or '*'}"}
        self.audit(p, "user.create", f"user:{username}", new=new)
        self.publish("users")
        return {"id": cur.lastrowid, **new}

    def update_user(self, p: Principal, uid: int, body: dict) -> dict:
        self.require(p, "users.manage", global_scope=True, resource=f"user:{uid}")
        u = self.store.one("SELECT * FROM users WHERE id=?", (uid,))
        if u is None:
            raise KeyError(uid)
        sets = {}
        if "display_name" in body:
            sets["display_name"] = str(body["display_name"]).strip()[:64] or u["display_name"]
        if "service_no" in body:
            sets["service_no"] = str(body["service_no"]).strip()[:32]
        if "role" in body:
            if not self.store.one("SELECT 1 AS x FROM roles WHERE name=?", (body["role"],)):
                raise ValueError(f"Unknown role {body['role']}")
            sets["role"] = body["role"]
        if "scope_type" in body:
            self._check_scope(body["scope_type"], body.get("scope_id"))
            sets["scope_type"] = body["scope_type"]
            sets["scope_id"] = body.get("scope_id") if body["scope_type"] != "battalion" else None
        if "status" in body:
            if body["status"] not in ("active", "disabled"):
                raise ValueError("status must be active or disabled")
            sets["status"] = body["status"]
        if body.get("unlock"):
            sets["locked_until"] = None
            sets["failed_count"] = 0
        demotes = (sets.get("role", u["role"]) != "administrator" or sets.get("status", u["status"]) != "active"
                   or sets.get("scope_type", u["scope_type"]) != "battalion")
        if u["role"] == "administrator" and demotes and self._admins_left(uid) == 0:
            raise ValueError("At least one active battalion-wide administrator must remain")
        if uid == p.user_id and sets.get("status") == "disabled":
            raise ValueError("You cannot disable your own account")
        if not sets:
            raise ValueError("Nothing to change")
        self.store.x(f"UPDATE users SET {', '.join(f'{k}=?' for k in sets)}, updated_at=? WHERE id=?",
                     (*sets.values(), time.time(), uid))
        ended = 0
        if sets.get("status") == "disabled" or "role" in sets or "scope_type" in sets:
            ended = self.auth.revoke_user_sessions(uid, p.username, "account changed by administrator")
        self.audit(p, "user.update", f"user:{u['username']}", prev={k: u[k] for k in sets if k in u},
                   new=sets, detail=f"{ended} session(s) ended" if ended else None)
        self.publish("users")
        self.publish("sessions")
        return {"id": uid, **sets}

    def reset_password(self, p: Principal, uid: int, pw: str) -> None:
        self.require(p, "users.manage", global_scope=True, resource=f"user:{uid}")
        u = self.store.one("SELECT username FROM users WHERE id=?", (uid,))
        if u is None:
            raise KeyError(uid)
        self.auth.check_password_policy(pw)
        self.store.x("UPDATE users SET password_hash=?, must_change_password=1, failed_count=0, locked_until=NULL, "
                     "updated_at=? WHERE id=?", (hash_password(pw), time.time(), uid))
        n = self.auth.revoke_user_sessions(uid, p.username, "password reset")
        self.audit(p, "user.password.reset", f"user:{u['username']}", detail=f"{n} session(s) ended")
        self.publish("users")

    def save_role(self, p: Principal, body: dict) -> dict:
        self.require(p, "roles.manage", global_scope=True, resource="roles")
        name = str(body.get("name", "")).strip().lower()
        if name in BUILTIN_ROLES:
            raise ValueError("Built-in roles cannot be changed")
        if not name or not name.replace("_", "").isalnum() or len(name) > 32:
            raise ValueError("Role name must be 1–32 letters, digits or _")
        perms = sorted(set(body.get("permissions") or []))
        bad = [x for x in perms if x not in PERMISSIONS]
        if bad:
            raise ValueError(f"Unknown permission(s): {', '.join(bad)}")
        before = self.store.one("SELECT permissions FROM roles WHERE name=?", (name,))
        self.store.x("INSERT INTO roles(name, label, description, permissions, builtin, updated_at) VALUES (?,?,?,?,0,?) "
                     "ON CONFLICT(name) DO UPDATE SET label=excluded.label, description=excluded.description, "
                     "permissions=excluded.permissions, updated_at=excluded.updated_at",
                     (name, str(body.get("label") or name)[:40], str(body.get("description") or "")[:200],
                      json.dumps(perms), time.time()))
        self.audit(p, "role.update" if before else "role.create", f"role:{name}",
                   prev=json.loads(before["permissions"]) if before else None, new=perms)
        self.publish("users")
        return {"name": name, "permissions": perms}

    def delete_role(self, p: Principal, name: str) -> None:
        self.require(p, "roles.manage", global_scope=True, resource=f"role:{name}")
        if name in BUILTIN_ROLES:
            raise ValueError("Built-in roles cannot be deleted")
        n = self.store.one("SELECT COUNT(*) AS n FROM users WHERE role=?", (name,))["n"]
        if n:
            raise ValueError(f"{n} user(s) still have role {name}")
        r = self.store.one("SELECT permissions FROM roles WHERE name=?", (name,))
        if r is None:
            raise KeyError(name)
        self.store.x("DELETE FROM roles WHERE name=?", (name,))
        self.audit(p, "role.delete", f"role:{name}", prev=json.loads(r["permissions"]))
        self.publish("users")

    # ── security ─────────────────────────────────────────────────────

    def _config_file_hashes(self) -> Dict[str, str]:
        return {f: self._file_hash(BACKEND / "configs" / f) or "missing" for f in CONFIG_FILES}

    def _baseline_integrity(self, who: str, p: Optional[Principal] = None) -> None:
        hashes = self._config_file_hashes()
        if p:
            self.audit(p, "integrity.baseline", "configs", new=hashes)
        else:
            self.store.audit(who, "integrity.baseline", "configs", new=hashes)

    def integrity(self) -> dict:
        base = self.store.one("SELECT new, ts, user FROM audit WHERE action='integrity.baseline' ORDER BY id DESC LIMIT 1")
        baseline = json.loads(base["new"]) if base else {}
        cur = self._config_file_hashes()
        files = [{"file": f, "sha256": cur[f], "baseline": baseline.get(f), "ok": baseline.get(f) == cur[f]}
                 for f in CONFIG_FILES]
        return {"files": files, "ok": all(f["ok"] for f in files),
                "baseline_at": base["ts"] if base else None, "baseline_by": base["user"] if base else None}

    def security_view(self) -> dict:
        now = time.time()
        attempts = self.store.q("SELECT ts, username, ip, success, reason FROM login_attempts ORDER BY id DESC LIMIT 200")
        return {
            "policy": self.cfg["security"],
            "sessions": self.auth.active_sessions(),
            "failed_24h": sum(1 for a in attempts if not a["success"] and now - a["ts"] < 86400),
            "attempts": attempts[:100],
            "locked": self.store.q("SELECT username, locked_until FROM users WHERE locked_until > ?", (now,)),
            "must_change": self.store.q("SELECT username FROM users WHERE must_change_password=1 AND status='active'"),
            "credentials": self.secrets.status(),
            "audit_chain": self.audit_status(),
            "integrity": self.integrity(),
            "transport": {"tls": False,
                          "note": "API and console are served over HTTP on the local network; no TLS certificate "
                                  "is configured on this host"},
            "bootstrap_file_present": (BACKEND / "data" / "bootstrap_admin.txt").exists(),
            "protected": [{"path": k, "permission": v[-1]} for k, v in cfgmod.FIELDS.items()
                          if v[-1] == "security.manage"],
            "now": now,
        }

    # ── retention ────────────────────────────────────────────────────

    def run_retention(self, p: Optional[Principal] = None) -> dict:
        r = self.cfg["retention"]
        out = {"events_deleted": 0, "backups_deleted": 0, "evidence_files": None}
        if r["event_retention_days"] > 0:
            out["events_deleted"] = self.db.prune_events(iso_ago(r["event_retention_days"] * 86400))
        ev = getattr(self.runtime, "evidence", None)
        if ev is not None:
            ev._prune()
            out["evidence_files"] = len(ev._files)
        from .backup import prune_backups
        out["backups_deleted"] = prune_backups(self, r["backup_keep"])
        if out["events_deleted"] or out["backups_deleted"] or p:
            self.audit(p, "retention.run", "storage", new=out)
        return out

    def storage_view(self) -> dict:
        ev = getattr(self.runtime, "evidence", None)
        st = self.tele.storage()
        nh = self.health()
        return {**st, "events": self.db.event_stats(), "evidence_files": len(ev._files) if ev else None,
                "retention": self.cfg["retention"],
                "nvrs": [{"nvr_id": k, "company_id": v["company_id"], "storage": None,
                          "note": "no storage telemetry (no NVR integration reports disk capacity)"}
                         for k, v in nh["nvrs"].items()],
                "training_candidates": len(self.db.feedback())}

    # ── model improvement queue ──────────────────────────────────────

    def submit_feedback(self, p: Principal, event_id: int, verdict: str, note: Optional[str]) -> dict:
        if verdict not in ("confirmed", "false_alarm"):
            raise ValueError("verdict must be confirmed or false_alarm")
        ev = self.db.event(event_id)
        if ev is None or ev.get("event_type") not in ALERT_TYPES:
            raise KeyError(event_id)
        self.require_camera(p, "alerts.feedback", ev["camera_id"])
        snap = None
        src = self.runtime.evidence.path((ev.get("snapshot") or {}).get("file")) if self.runtime.evidence else None
        if src is not None:
            dest = BACKEND / "outputs" / "training_candidates" / f"{event_id}.jpg"
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)                  # survives evidence retention
            snap = dest.name
        prev = self.db.feedback_for(event_id)
        self.db.upsert_feedback(ev, verdict, (note or "")[:500] or None, p.username, snap)
        self.audit(p, "alert.feedback", f"alert:INC-{event_id:06d}", prev=prev["verdict"] if prev else None,
                   new=verdict, detail=note)
        self.publish("feedback", event_id=event_id)
        return self.db.feedback_for(event_id)

    def review_feedback(self, p: Principal, fid: int, status: str, note: Optional[str]) -> dict:
        self.require(p, "feedback.review", resource=f"feedback:{fid}")
        if status not in ("accepted", "rejected", "pending"):
            raise ValueError("status must be accepted, rejected or pending")
        before = self.db.review_feedback(fid, status, p.username, note)
        if before is None:
            raise KeyError(fid)
        self.audit(p, "feedback.review", f"feedback:{fid}", prev=before["status"], new=status, detail=note)
        self.publish("feedback")
        return {"id": fid, "status": status}

    def feedback_dataset(self) -> dict:
        """Manifest of reviewer-accepted training candidates (nothing is trained automatically)."""
        items = [f for f in self.db.feedback(status="accepted")]
        return {"generated_at": time.time(), "count": len(items), "items": [{
            "event_id": f["event_id"], "camera_id": f["camera_id"], "detection_mode": f["detection_mode"],
            "label": "true_positive" if f["verdict"] == "confirmed" else "false_positive",
            "image": f"outputs/training_candidates/{f['snapshot']}" if f["snapshot"] else None,
            "bounding_box": f["event"].get("bounding_box"), "object_class": f["event"].get("object_class"),
            "reviewed_by": f["reviewed_by"]} for f in items]}
