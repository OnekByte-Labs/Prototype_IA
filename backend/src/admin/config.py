"""
Versioned system configuration: schema, validation and diff.

The active configuration is the newest row in admin.db config_versions. It is
seeded once from the values the system was already running with
(pipeline.yaml), so the first version changes nothing. Applying a version is
done by AdminService (pushes detection thresholds to the inference workers,
alert policy to the event gate, retention to the stores, …).
"""

import copy
import re
from typing import Any, Dict, List, Tuple

SEVERITIES = ("high", "med", "low")
ALERT_EVENT_TYPES = ("PERIMETER_BREACH", "ANOMALY")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$|^24:00$")

# path → (type, min, max, description, permission)
FIELDS: Dict[str, Tuple[type, Any, Any, str, str]] = {
    "detection.detect_interval": (int, 1, 10, "Run the detector every Nth frame (tracker predicts between)", "config.manage"),
    "detection.intrusion_confirm_frames": (int, 1, 60, "Frames inside the restricted zone before PERIMETER_BREACH", "config.manage"),
    "detection.anpr_max_per_frame": (int, 1, 10, "Vehicles sent through plate detection per detector frame", "config.manage"),
    "detection.anpr_min_vehicle_px": (int, 20, 400, "Minimum vehicle box height (px) for a plate read", "config.manage"),
    "detection.anpr_min_plate_conf": (float, 0.1, 0.99, "Minimum LPRNet mean character confidence", "config.manage"),
    "detection.anomaly_warmup_s": (int, 0, 3600, "Baseline learning time before anomaly rules arm (s)", "config.manage"),
    "detection.anomaly_loiter_s": (int, 5, 3600, "Loitering threshold (s)", "config.manage"),
    "detection.anomaly_speed_k": (float, 1.0, 20.0, "Abnormal-motion robust z threshold (median + k·MAD)", "config.manage"),
    "detection.anomaly_min_speed": (float, 0.1, 20.0, "Abnormal-motion speed floor (body-heights/s)", "config.manage"),
    "retention.evidence_max_files": (int, 100, 1_000_000, "Alert evidence snapshots kept (oldest pruned)", "config.manage"),
    "retention.event_retention_days": (int, 0, 3650, "Delete detection events older than N days (0 = keep all)", "config.manage"),
    "retention.backup_keep": (int, 1, 500, "Backups kept per kind (oldest deleted)", "config.manage"),
    "security.password_min_length": (int, 8, 128, "Minimum password length", "security.manage"),
    "security.lockout_threshold": (int, 3, 50, "Failed logins before the account locks", "security.manage"),
    "security.lockout_minutes": (int, 1, 1440, "Lockout duration (min)", "security.manage"),
    "security.session_ttl_hours": (int, 1, 168, "Absolute session lifetime (h)", "security.manage"),
    "security.idle_timeout_minutes": (int, 5, 1440, "Idle session timeout (min)", "security.manage"),
    "sync.offline_validity_hours": (int, 1, 720, "How long an edge site may run on its last synced policy (h)", "config.manage"),
    "sync.ack_timeout_s": (int, 5, 600, "Worker must acknowledge a new policy within (s)", "config.manage"),
    "capacity.gpu_util_warn_pct": (int, 10, 100, "Warn when projected GPU utilization exceeds (%)", "config.manage"),
    "capacity.vram_warn_pct": (int, 10, 100, "Warn when projected VRAM use exceeds (%)", "config.manage"),
    "capacity.storage_warn_pct": (int, 10, 100, "Warn when the recording volume exceeds (%)", "config.manage"),
    "integrations.probe_timeout_s": (float, 0.5, 30, "NVR / RTSP / ONVIF probe timeout (s)", "config.manage"),
    "integrations.discovery_timeout_s": (float, 1, 30, "ONVIF WS-Discovery listen time (s)", "config.manage"),
}
STRING_FIELDS = {
    "system.site_name": ("Site / installation name shown to operators", "config.manage"),
    "system.classification": ("Classification banner text", "config.manage"),
}

# Which pipelines read each detection field (at pipeline start → restart on change)
DETECTION_MODES_FOR = {
    "detect_interval": ("intrusion", "anpr", "vehicle_counting", "person_counting", "anomaly"),
    "intrusion_confirm_frames": ("intrusion",),
    "anpr_max_per_frame": ("anpr",), "anpr_min_vehicle_px": ("anpr",), "anpr_min_plate_conf": ("anpr",),
    "anomaly_warmup_s": ("anomaly",), "anomaly_loiter_s": ("anomaly",), "anomaly_speed_k": ("anomaly",),
    "anomaly_min_speed": ("anomaly",),
}


def default_config(pipeline_cfg: dict) -> dict:
    """The configuration the system was running with before versioning."""
    p = dict(pipeline_cfg.get("pipelines") or {})
    ev = pipeline_cfg.get("evidence") or {}
    return {
        "system": {"site_name": "ISCC Command Center", "classification": "RESTRICTED"},
        "detection": {
            "detect_interval": int(pipeline_cfg.get("detect_interval", 2)),
            "intrusion_confirm_frames": int(p.get("intrusion_confirm_frames", 5)),
            "anpr_max_per_frame": int(p.get("anpr_max_per_frame", 2)),
            "anpr_min_vehicle_px": int(p.get("anpr_min_vehicle_px", 80)),
            "anpr_min_plate_conf": float(p.get("anpr_min_plate_conf", 0.6)),
            "anomaly_warmup_s": int(p.get("anomaly_warmup_s", 60)),
            "anomaly_loiter_s": int(p.get("anomaly_loiter_s", 20)),
            "anomaly_speed_k": float(p.get("anomaly_speed_k", 4.0)),
            "anomaly_min_speed": float(p.get("anomaly_min_speed", 1.2)),
        },
        # Existing behaviour: every alert event raises an alert (no cooldown)
        "alerts": {"policies": {
            "PERIMETER_BREACH": {"enabled": True, "severity": "high", "cooldown_s": 0},
            "ANOMALY": {"enabled": True, "severity": "med", "cooldown_s": 0},
        }},
        # camera_id → list of armed windows; cameras not listed are always armed
        "schedules": {},
        "retention": {"evidence_max_files": int(ev.get("max_files", 5000)), "event_retention_days": 0,
                      "backup_keep": 20},
        "security": {"password_min_length": 12, "lockout_threshold": 5, "lockout_minutes": 15,
                     "session_ttl_hours": 12, "idle_timeout_minutes": 60},
        "sync": {"offline_validity_hours": 72, "ack_timeout_s": 30},
        "capacity": {"gpu_util_warn_pct": 85, "vram_warn_pct": 90, "storage_warn_pct": 85},
        "integrations": {"probe_timeout_s": 3.0, "discovery_timeout_s": 3.0},
    }


class ConfigError(ValueError):
    pass


def _get(doc: dict, path: str):
    cur = doc
    for k in path.split("."):
        if not isinstance(cur, dict) or k not in cur:
            raise KeyError(path)
        cur = cur[k]
    return cur


def _set(doc: dict, path: str, value) -> None:
    keys = path.split(".")
    cur = doc
    for k in keys[:-1]:
        cur = cur.setdefault(k, {})
    cur[keys[-1]] = value


def validate(doc: dict, base: dict) -> dict:
    """Normalize a proposed document (missing keys fall back to ``base``)."""
    if not isinstance(doc, dict):
        raise ConfigError("Configuration must be an object")
    out = copy.deepcopy(base)
    for path, (typ, lo, hi, _, _) in FIELDS.items():
        try:
            v = _get(doc, path)
        except KeyError:
            continue
        try:
            v = typ(v)
        except (TypeError, ValueError):
            raise ConfigError(f"{path} must be a {typ.__name__}")
        if isinstance(v, bool) or not lo <= v <= hi:
            raise ConfigError(f"{path} must be within [{lo}, {hi}]")
        _set(out, path, v)
    for path in STRING_FIELDS:
        try:
            v = _get(doc, path)
        except KeyError:
            continue
        v = str(v).strip()
        if not v or len(v) > 80:
            raise ConfigError(f"{path} must be 1–80 characters")
        _set(out, path, v)
    pol = (doc.get("alerts") or {}).get("policies")
    if pol is not None:
        if not isinstance(pol, dict):
            raise ConfigError("alerts.policies must be an object")
        for et, p in pol.items():
            if et not in ALERT_EVENT_TYPES:
                raise ConfigError(f"Unknown alert event type {et}")
            sev = p.get("severity")
            if sev not in SEVERITIES:
                raise ConfigError(f"{et}: severity must be one of {', '.join(SEVERITIES)}")
            cd = p.get("cooldown_s")
            if not isinstance(cd, (int, float)) or isinstance(cd, bool) or not 0 <= cd <= 86400:
                raise ConfigError(f"{et}: cooldown must be 0–86400 s")
            out["alerts"]["policies"][et] = {"enabled": bool(p.get("enabled", True)), "severity": sev,
                                             "cooldown_s": int(cd)}
    sch = doc.get("schedules")
    if sch is not None:
        if not isinstance(sch, dict):
            raise ConfigError("schedules must be an object")
        clean = {}
        for cam, windows in sch.items():
            if not re.match(r"^CAM-\d{2,3}$", str(cam)):
                raise ConfigError(f"Unknown camera id {cam}")
            if not isinstance(windows, list) or not windows:
                raise ConfigError(f"{cam}: schedule needs at least one armed window (remove it for always-armed)")
            ws = []
            for w in windows:
                days = sorted({int(d) for d in (w.get("days") or [])})
                if not days or any(d < 0 or d > 6 for d in days):
                    raise ConfigError(f"{cam}: days must be 0 (Mon) … 6 (Sun)")
                s, e = str(w.get("start", "")), str(w.get("end", ""))
                if not TIME_RE.match(s) or not TIME_RE.match(e) or s == e:
                    raise ConfigError(f"{cam}: start/end must be HH:MM and differ")
                ws.append({"days": days, "start": s, "end": e})
            clean[cam] = ws
        out["schedules"] = clean
    return out


def flatten(doc: Any, prefix: str = "") -> Dict[str, Any]:
    if isinstance(doc, dict):
        out = {}
        for k, v in doc.items():
            out.update(flatten(v, f"{prefix}.{k}" if prefix else k))
        return out if out or not prefix else {prefix: {}}
    return {prefix: doc}


def diff(old: dict, new: dict) -> List[dict]:
    a, b = flatten(old), flatten(new)
    out = []
    for path in sorted(set(a) | set(b)):
        if a.get(path, None) != b.get(path, None) or (path in a) != (path in b):
            out.append({"path": path, "old": a.get(path), "new": b.get(path),
                        "change": "added" if path not in a else "removed" if path not in b else "changed"})
    return out


def required_permissions(changes: List[dict]) -> set:
    perms = set()
    for c in changes:
        spec = FIELDS.get(c["path"]) or STRING_FIELDS.get(c["path"])
        perms.add(spec[-1] if spec else "config.manage")
        if c["path"].startswith("schedules."):
            perms.add("detection.manage")
    return perms


def armed(schedule: List[dict], weekday: int, hhmm: str) -> bool:
    """Is a camera armed at (weekday 0=Mon, 'HH:MM')? Windows may wrap midnight."""
    for w in schedule:
        s, e = w["start"], w["end"]
        if s < e:
            if weekday in w["days"] and s <= hhmm < e:
                return True
        else:                               # overnight window: start day → next day
            if (weekday in w["days"] and hhmm >= s) or (((weekday - 1) % 7) in w["days"] and hhmm < e):
                return True
    return False
