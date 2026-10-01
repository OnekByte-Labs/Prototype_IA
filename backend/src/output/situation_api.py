"""
/api/v1 — operational situation (the same read model the Argus Agent's tools use).

  GET  /api/v1/status                       current system status (cameras, NVRs, pipelines, alerts, incidents)
  GET  /api/v1/alerts?active=&class=&camera_id=&period=&since_minutes=&start=&end=&object_class=&min_confidence=&severity=&area=&limit=
                                            alert search (active=1: alerts of active incidents)
  POST /api/v1/alerts/{alert_id}/ack        acknowledge an alert (persisted)
  GET  /api/v1/incidents?status=&camera_id=&period=&limit=
  GET  /api/v1/incidents/{incident_id}      incident detail (INCD-000042 or 42)
  GET  /api/v1/health/cameras?status=       camera health list (online | degraded | offline | alerting | all)
  GET  /api/v1/health/cameras/{camera_id}   one camera: health, stream, pipeline, NVR, history, alerts
  GET  /api/v1/health/nvrs                  ingest NVRs + company recorders
  GET  /api/v1/health/nvrs/{nvr_id}
  GET  /api/v1/events/recent?minutes=&camera_id=&event_type=&limit=

Every route needs a signed-in session (when the administration layer is
attached) and only returns cameras inside the user's scope.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.runtime import parse_alert_id


class AckRequest(BaseModel):
    note: Optional[str] = None


def build_situation_router(situation, admin=None) -> APIRouter:
    r = APIRouter(prefix="/api/v1")

    def scope(request: Request):
        """(principal, allowed camera ids | None)."""
        if admin is None:
            return None, None
        from src.admin.api import principal
        from src.admin.auth import AuthError
        try:
            p = principal(admin, request)
        except AuthError as e:
            raise HTTPException(e.status, str(e))
        return p, admin.scoped_camera_ids(p)

    def run(fn, *a, **kw):
        try:
            out = fn(*a, **kw)
        except ValueError as e:
            raise HTTPException(422, str(e))
        if isinstance(out, dict) and out.get("error"):
            raise HTTPException(404, out["error"])
        return out

    @r.get("/status")
    def status(request: Request):
        _, allowed = scope(request)
        return run(situation.system_status, allowed=allowed)

    @r.get("/alerts")
    def alerts(request: Request, active: bool = False, alert_class: Optional[str] = None, camera_id: Optional[str] = None,
               period: Optional[str] = None, since_minutes: Optional[float] = None, start: Optional[str] = None,
               end: Optional[str] = None, object_class: Optional[str] = None, min_confidence: Optional[float] = None,
               severity: Optional[str] = None, area: Optional[str] = None, limit: int = 10):
        _, allowed = scope(request)
        alert_class = alert_class or request.query_params.get("class")
        if active:
            return run(situation.active_alerts, alert_class=alert_class, camera_id=camera_id, limit=limit, allowed=allowed)
        return run(situation.search_alerts, alert_class=alert_class, camera_id=camera_id, period=period,
                   since_minutes=since_minutes, start=start, end=end, object_class=object_class,
                   min_confidence=min_confidence, severity=severity, area=area, limit=limit, allowed=allowed)

    @r.post("/alerts/{alert_id}/ack")
    def ack(alert_id: str, request: Request, body: Optional[AckRequest] = None):
        p, allowed = scope(request)
        try:
            aid = parse_alert_id(alert_id)
        except ValueError:
            raise HTTPException(404, f"Unknown alert {alert_id}")
        row = situation.db.query_one("SELECT camera_id, ack_by, ack_at FROM alerts WHERE alert_id=?", (aid,))
        if row is None:
            raise HTTPException(404, f"Unknown alert {alert_id}")
        if allowed is not None and row["camera_id"] not in allowed:
            raise HTTPException(403, f"{row['camera_id']} is outside your scope")
        by = p.display_name if p is not None else "operator"
        changed = situation.acknowledge([aid], by)
        if changed and p is not None:
            admin.audit(p, "alert.ack", f"alert:{alert_id}")
        return {"alert_id": alert_id, "acknowledged": True, "changed": bool(changed),
                **situation.alert_extra(aid)}

    @r.get("/incidents")
    def incidents(request: Request, status: Optional[str] = None, camera_id: Optional[str] = None,
                  period: Optional[str] = None, limit: int = 20):
        _, allowed = scope(request)
        return run(situation.list_incidents, status=status, camera_id=camera_id, period=period, limit=limit,
                   allowed=allowed)

    @r.get("/incidents/{incident_id}")
    def incident(incident_id: str, request: Request):
        _, allowed = scope(request)
        return run(situation.incident_details, incident_id=incident_id, allowed=allowed)

    @r.get("/health/cameras")
    def cameras(request: Request, status: Optional[str] = None):
        _, allowed = scope(request)
        return run(situation.camera_status, status=status, allowed=allowed)

    @r.get("/health/cameras/{camera_id}")
    def camera(camera_id: str, request: Request):
        _, allowed = scope(request)
        return run(situation.camera_status, camera_id=camera_id, allowed=allowed)

    @r.get("/health/nvrs")
    def nvrs(request: Request):
        _, allowed = scope(request)
        return run(situation.nvr_status, allowed=allowed)

    @r.get("/health/nvrs/{nvr_id}")
    def nvr(nvr_id: str, request: Request):
        _, allowed = scope(request)
        return run(situation.nvr_status, nvr_id=nvr_id, allowed=allowed)

    @r.get("/events/recent")
    def recent(request: Request, minutes: float = 15, camera_id: Optional[str] = None,
               event_type: Optional[str] = None, limit: int = 10):
        _, allowed = scope(request)
        return run(situation.recent_events, minutes=minutes, camera_id=camera_id, event_type=event_type, limit=limit,
                   allowed=allowed)

    return r
