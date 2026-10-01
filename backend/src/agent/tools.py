"""
Argus Agent tools: the only way the model sees operational data. Each tool is
a thin call into SituationService (the same read model as the REST API), run
inside the operator's camera scope. Results are compact JSON (None / empty
values dropped) so a small local model can read them.
"""

import json
import time
from typing import Any, Callable, Dict, Optional, Set

from src.situation import PERIOD_NAMES

_STR = {"type": "string"}


def _fn(name: str, description: str, properties: Dict[str, dict], required=()) -> dict:
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties, "required": list(required)}}}


CAMERA_ID = {"type": "string", "description": "Camera ID, e.g. CAM-09"}
ALERT_CLASS = {"type": "string", "enum": ["intrusion", "anomaly"],
               "description": "Only if the operator asks for one class. intrusion = perimeter breach of a restricted "
                              "zone; anomaly = behavioural anomaly"}

TOOLS = [
    _fn("get_system_status",
        "Overall situation right now: how many cameras are online / degraded / offline and which have faults, AI "
        "pipelines, NVR health, alert counts for the last 15 minutes / hour / today, and the active incidents. Use for "
        "'what is happening now', overviews and situation summaries.", {}),
    _fn("get_active_alerts",
        "Alerts that are active right now (incidents still receiving alerts), grouped into incidents, with the latest "
        "alerts. Use for 'show active alerts', 'current intrusions'.",
        {"alert_class": ALERT_CLASS, "camera_id": CAMERA_ID,
         "limit": {"type": "integer", "description": "How many latest alerts to list (default 10)"}}),
    _fn("search_alerts",
        "Search and count stored alerts in a time window (history). Use for 'how many alerts today', 'what happened in "
        "the last 15 minutes', 'which cameras generated alerts recently' ('recently' = last_hour unless the operator says "
        "otherwise), alerts on one camera or place. Returns totals, per-camera and per-hour counts and the newest alerts; "
        "if the window is empty it reports when the latest matching alert happened.",
        {"period": {"type": "string", "enum": list(PERIOD_NAMES), "description": "Time window (default last_24h)"},
         "since_minutes": {"type": "number", "description": "Alternative to period: alerts in the last N minutes"},
         "start": {"type": "string", "description": "Optional start, local time ISO e.g. 2026-10-01T14:00"},
         "end": {"type": "string", "description": "Optional end, local time ISO"},
         "alert_class": ALERT_CLASS, "camera_id": CAMERA_ID,
         "object_class": {"type": "string", "description": "Detected object, e.g. person"},
         "min_confidence": {"type": "number", "description": "Minimum confidence in percent (0-100)"},
         "severity": {"type": "string", "enum": ["low", "med", "high"]},
         "area": {"type": "string", "description": "Place name to match camera / post / company names, e.g. 'ammunition'"},
         "limit": {"type": "integer", "description": "How many newest alerts to list (default 10)"}}),
    _fn("get_camera_status",
        "Camera health. With camera_id: one camera in detail - live status, the concrete fault ('issue'), stream, AI "
        "pipeline, its NVR, health history and recent alerts (use for 'why is CAM-09 not working'). Without camera_id: "
        "list cameras filtered by status (use for 'which cameras are offline').",
        {"camera_id": {"type": "string", "description": "Camera ID (e.g. CAM-09) or camera name"},
         "status": {"type": "string", "enum": ["online", "degraded", "offline", "alerting", "all"],
                    "description": "Filter for the list (default all)"}}),
    _fn("get_nvr_status",
        "NVR health: ingest NVRs (physical recorders the camera video is pulled from) and company recorders, with "
        "faults, failing channels and affected cameras. Use for 'are there NVR faults'.",
        {"nvr_id": {"type": "string", "description": "Optional NVR ID, e.g. NVR-01 or HIK-01"}}),
    _fn("get_incident_details",
        "Full detail of one incident (a group of alerts from one camera): timeline, alerts, objects, evidence, camera "
        "and NVR health, and other cameras alerting at the same time. Pass incident_id (INCD-...) or alert_id (INC-...) "
        "or camera_id (its latest incident); with no argument returns the most recent active incident.",
        {"incident_id": {"type": "string", "description": "Incident ID, e.g. INCD-000042"},
         "alert_id": {"type": "string", "description": "Alert ID, e.g. INC-390473"}, "camera_id": CAMERA_ID}),
    _fn("get_recent_events",
        "All detection events in the last N minutes across every detection mode (perimeter breaches, anomalies, "
        "vehicles, number plates, people / vehicle line counting): counts by type and camera, plates read, newest events.",
        {"minutes": {"type": "number", "description": "Window in minutes (default 15)"}, "camera_id": CAMERA_ID,
         "event_type": {"type": "string", "enum": ["PERIMETER_BREACH", "ANOMALY", "VEHICLE_OBSERVED", "PLATE_READ",
                                                   "VEHICLE_COUNT", "PERSON_COUNT"]},
         "limit": {"type": "integer", "description": "How many newest events to list (default 10)"}}),
]
TOOL_NAMES = {t["function"]["name"] for t in TOOLS}


def _clean(v: Any) -> Any:
    """Drop None / empty values recursively (smaller context for the model)."""
    if isinstance(v, dict):
        out = {k: _clean(x) for k, x in v.items()}
        return {k: x for k, x in out.items() if x is not None and x != [] and x != {} and x != ""}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def _args(raw: Any) -> dict:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "{}")
        except ValueError:
            raw = {}
    return {k: v for k, v in (raw or {}).items() if v not in (None, "", "null", "None")}


def _num(v, cast=float):
    try:
        return cast(v)
    except (TypeError, ValueError):
        return None


def run_tool(situation, name: str, raw_args: Any, allowed: Optional[Set[str]]) -> dict:
    """Execute one tool call → {"ok", "result" | "error", "ms", "args"}."""
    a = _args(raw_args)
    t0 = time.perf_counter()
    calls: Dict[str, Callable[[], dict]] = {
        "get_system_status": lambda: situation.system_status(allowed=allowed),
        "get_active_alerts": lambda: situation.active_alerts(
            alert_class=a.get("alert_class"), camera_id=a.get("camera_id"),
            limit=_num(a.get("limit"), int) or 10, allowed=allowed),
        "search_alerts": lambda: situation.search_alerts(
            alert_class=a.get("alert_class"), camera_id=a.get("camera_id"), period=a.get("period"),
            since_minutes=_num(a.get("since_minutes")), start=a.get("start"), end=a.get("end"),
            object_class=a.get("object_class"), min_confidence=_num(a.get("min_confidence")),
            severity=a.get("severity"), area=a.get("area"), limit=_num(a.get("limit"), int) or 10, allowed=allowed),
        "get_camera_status": lambda: situation.camera_status(
            camera_id=a.get("camera_id"), status=a.get("status"), allowed=allowed),
        "get_nvr_status": lambda: situation.nvr_status(nvr_id=a.get("nvr_id"), allowed=allowed),
        "get_incident_details": lambda: situation.incident_details(
            incident_id=a.get("incident_id"), alert_id_=a.get("alert_id"), camera_id=a.get("camera_id"),
            allowed=allowed),
        "get_recent_events": lambda: situation.recent_events(
            minutes=_num(a.get("minutes")) or 15, camera_id=a.get("camera_id"), event_type=a.get("event_type"),
            limit=_num(a.get("limit"), int) or 10, allowed=allowed),
    }
    if name not in calls:
        return {"ok": False, "error": f"Unknown tool {name!r}", "ms": 0, "args": a}
    try:
        result = _clean(calls[name]())
        ok = not (isinstance(result, dict) and result.get("error"))
        return {"ok": ok, "result": result, "ms": round((time.perf_counter() - t0) * 1000, 1), "args": a}
    except ValueError as e:
        return {"ok": False, "error": str(e), "ms": round((time.perf_counter() - t0) * 1000, 1), "args": a}
