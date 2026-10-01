"""
/api/v1/auth/*   sign-in, sign-out, current user, password change
/api/v1/admin/*  administration console API (every route authorized server-side)
/api/v1/alerts/{id}/feedback   operator confirmed / false-alarm feedback

Sessions: ``X-Session-Token`` header (set by the Next.js proxy from its
httpOnly cookie) or the ``iscc_session`` cookie.
"""

import json
import time
from typing import Optional

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from src.runtime import parse_alert_id

from . import backup as bk
from . import ops
from .auth import PERMISSIONS, AuthError, Principal
from .config import ConfigError
from .service import AdminService

COOKIE = "iscc_session"


def client_ip(request: Request) -> Optional[str]:
    host = request.client.host if request.client else None
    fwd = request.headers.get("x-forwarded-for")
    if fwd and host in ("127.0.0.1", "::1", "localhost"):
        return fwd.split(",")[0].strip()[:64]
    return host


def token_of(request: Request) -> Optional[str]:
    return request.headers.get("x-session-token") or request.cookies.get(COOKIE)


def principal(svc: AdminService, request: Request, allow_must_change: bool = False) -> Principal:
    p = svc.auth.authenticate(token_of(request), client_ip(request))
    if p.must_change_password and not allow_must_change:
        raise AuthError(403, "Password change required before continuing")
    return p


def _err(e: Exception) -> JSONResponse:
    if isinstance(e, AuthError):
        return JSONResponse({"detail": str(e)}, status_code=e.status)
    from src.db import MapRevisionConflict
    if isinstance(e, MapRevisionConflict):
        return JSONResponse({"detail": str(e)}, status_code=409)
    if isinstance(e, KeyError):
        return JSONResponse({"detail": f"Not found: {e.args[0] if e.args else ''}"}, status_code=404)
    if isinstance(e, (ValueError, ConfigError)):
        return JSONResponse({"detail": str(e)}, status_code=422)
    raise e


def guarded(fn):
    """Map domain errors to HTTP statuses. Stays a plain (sync) function so
    FastAPI runs it in its threadpool — admin work (nvidia-smi, hashing,
    backups) must never block the event loop that serves streams/WebSocket."""
    import functools

    @functools.wraps(fn)
    def wrapper(*a, **kw):
        try:
            return fn(*a, **kw)
        except Exception as e:
            from src.db import MapRevisionConflict
            if isinstance(e, (AuthError, KeyError, ValueError, ConfigError, MapRevisionConflict)):
                return _err(e)
            raise
    return wrapper


def build_admin_router(svc: AdminService) -> APIRouter:
    r = APIRouter()

    def P(request: Request, perm: str = "admin.view") -> Principal:
        p = principal(svc, request)
        svc.require(p, perm)
        return p

    # ── auth ─────────────────────────────────────────────────────────

    @r.post("/api/v1/auth/login")
    @guarded
    def login(request: Request, body: dict = Body(...)):
        res = svc.auth.login(str(body.get("username", "")), str(body.get("password", "")), client_ip(request),
                             request.headers.get("user-agent"))
        svc.publish("sessions")
        return res

    @r.post("/api/v1/auth/logout")
    @guarded
    def logout(request: Request):
        p = principal(svc, request, allow_must_change=True)
        svc.auth.logout(p)
        svc.audit(p, "auth.logout", f"session:{p.session_id}")
        svc.publish("sessions")
        return {"ok": True}

    @r.get("/api/v1/auth/me")
    @guarded
    def me(request: Request):
        p = principal(svc, request, allow_must_change=True)
        return p.public() | {"site": svc.cfg["system"], "policy": {"password_min_length":
                                                                    svc.cfg["security"]["password_min_length"]}}

    @r.post("/api/v1/auth/verify")
    @guarded
    def verify(request: Request, body: dict = Body(...)):
        p = principal(svc, request, allow_must_change=True)
        svc.auth.verify_current(p, str(body.get("password", "")))
        return {"ok": True}

    @r.post("/api/v1/auth/password")
    @guarded
    def password(request: Request, body: dict = Body(...)):
        p = principal(svc, request, allow_must_change=True)
        svc.auth.change_password(p, str(body.get("current", "")), str(body.get("new", "")))
        svc.publish("users")
        return {"ok": True}

    # ── alert feedback (model improvement queue input) ───────────────

    @r.get("/api/v1/alerts/{alert_id}/feedback")
    @guarded
    def get_feedback(alert_id: str, request: Request):
        principal(svc, request)
        return svc.db.feedback_for(parse_alert_id(alert_id)) or {}

    @r.post("/api/v1/alerts/{alert_id}/feedback")
    @guarded
    def post_feedback(alert_id: str, request: Request, body: dict = Body(...)):
        p = principal(svc, request)
        return svc.submit_feedback(p, parse_alert_id(alert_id), body.get("verdict"), body.get("note"))

    # ── admin: overview / hierarchy ──────────────────────────────────

    A = "/api/v1/admin"

    @r.get(f"{A}/overview")
    @guarded
    def overview(request: Request):
        P(request)
        return svc.overview()

    @r.get(f"{A}/hierarchy")
    @guarded
    def hierarchy(request: Request):
        P(request)
        return svc.hierarchy()

    @r.post(f"{A}/hierarchy/preview")
    @guarded
    def hierarchy_preview(request: Request, body: dict = Body(...)):
        P(request)
        return svc.hierarchy_change(None, body, apply=False)

    @r.post(f"{A}/hierarchy/apply")
    @guarded
    def hierarchy_apply(request: Request, body: dict = Body(...)):
        p = P(request, "hierarchy.manage")
        return svc.hierarchy_change(p, body, apply=True)

    # ── users / roles / sessions ─────────────────────────────────────

    @r.get(f"{A}/users")
    @guarded
    def users(request: Request):
        p = P(request)
        own = svc.store.q("SELECT id FROM users WHERE id=?", (p.user_id,))
        rows = svc.users()
        return {"users": rows if p.can("users.manage") or p.can("audit.view") else
                [u for u in rows if u["id"] in {o["id"] for o in own}],
                "roles": svc.roles(), "permissions": PERMISSIONS,
                "units": [{"id": u["unit_id"], "type": u["unit_type"], "name": u["name"], "parent_id": u["parent_id"]}
                          for u in svc.db.map_units() if u["unit_type"] != "battalion"]}

    @r.post(f"{A}/users")
    @guarded
    def create_user(request: Request, body: dict = Body(...)):
        return svc.create_user(P(request, "users.manage"), body)

    @r.patch(f"{A}/users/{{uid}}")
    @guarded
    def update_user(uid: int, request: Request, body: dict = Body(...)):
        return svc.update_user(P(request, "users.manage"), uid, body)

    @r.post(f"{A}/users/{{uid}}/password")
    @guarded
    def reset_password(uid: int, request: Request, body: dict = Body(...)):
        svc.reset_password(P(request, "users.manage"), uid, str(body.get("password", "")))
        return {"ok": True}

    @r.put(f"{A}/roles/{{name}}")
    @guarded
    def save_role(name: str, request: Request, body: dict = Body(...)):
        return svc.save_role(P(request, "roles.manage"), body | {"name": name})

    @r.delete(f"{A}/roles/{{name}}")
    @guarded
    def delete_role(name: str, request: Request):
        svc.delete_role(P(request, "roles.manage"), name)
        return {"ok": True}

    @r.get(f"{A}/sessions")
    @guarded
    def sessions(request: Request):
        p = P(request)
        rows = svc.auth.active_sessions()
        if not p.can("sessions.manage"):
            rows = [s for s in rows if s["user_id"] == p.user_id]
        return {"sessions": rows, "current": p.session_id, "now": time.time()}

    @r.delete(f"{A}/sessions/{{sid}}")
    @guarded
    def revoke(sid: str, request: Request):
        p = principal(svc, request)
        s = svc.store.one("SELECT user_id FROM sessions WHERE id=?", (sid,))
        if s is None:
            raise KeyError(sid)
        if s["user_id"] != p.user_id:
            svc.require(p, "sessions.manage", global_scope=True, resource=f"session:{sid}")
        done = svc.auth.revoke(sid, p.username, "revoked by administrator" if s["user_id"] != p.user_id else "revoked by user")
        if done is None:
            raise ValueError("Session already ended")
        svc.audit(p, "session.revoke", f"session:{sid}", prev={"user_id": done["user_id"], "ip": done["ip"]})
        svc.publish("sessions")
        return {"ok": True}

    # ── devices / NVRs ───────────────────────────────────────────────

    @r.get(f"{A}/devices")
    @guarded
    def devices(request: Request):
        return ops.devices_view(svc, P(request))

    @r.patch(f"{A}/devices/{{camera_id}}")
    @guarded
    def update_device(camera_id: str, request: Request, body: dict = Body(...)):
        return ops.update_device(svc, principal(svc, request), camera_id, body)

    @r.get(f"{A}/nvrs/{{nvr_id}}/impact")
    @guarded
    def nvr_impact(nvr_id: str, request: Request):
        P(request)
        return ops.nvr_impact(svc, nvr_id)

    # ── detection / models / compute ─────────────────────────────────

    @r.get(f"{A}/detection")
    @guarded
    def detection(request: Request):
        p = P(request)
        scope = svc.scoped_camera_ids(p)
        cams = [c | {"geometry": svc.db.geometry(c["camera_id"])} for c in svc._cams()
                if scope is None or c["camera_id"] in scope]
        return {"cameras": cams, "detection": svc.cfg["detection"], "alerts": svc.cfg["alerts"],
                "schedules": svc.cfg["schedules"], "schema": svc.config_schema(),
                "suppressed": dict(svc.suppressed), "version": svc.active()["version"]}

    @r.get(f"{A}/models")
    @guarded
    def models(request: Request):
        P(request)
        return svc.models_view()

    @r.post(f"{A}/models/{{name}}/validate")
    @guarded
    def validate_model(name: str, request: Request):
        return svc.validate_model(P(request, "detection.manage"), name)

    @r.post(f"{A}/assignments/preview")
    @guarded
    def assignment_preview(request: Request, body: dict = Body(...)):
        p = P(request)
        if not svc.camera_in_scope(p, body.get("camera_id", "")):
            raise AuthError(403, "Camera outside your scope")
        return svc.assignment_preview(body["camera_id"], body["mode"])

    @r.post(f"{A}/assignments")
    @guarded
    def assign(request: Request, body: dict = Body(...)):
        p = principal(svc, request)
        return svc.assign_mode(p, body["camera_id"], body["mode"], force=bool(body.get("force")))

    @r.get(f"{A}/compute")
    @guarded
    def compute(request: Request):
        P(request)
        return svc.compute_view()

    # ── integrations / network ───────────────────────────────────────

    @r.get(f"{A}/integrations")
    @guarded
    def integrations(request: Request):
        P(request)
        return ops.integrations_view(svc)

    @r.put(f"{A}/integrations/{{nvr_id}}")
    @guarded
    def put_integration(nvr_id: str, request: Request, body: dict = Body(...)):
        return ops.update_integration(svc, P(request, "integrations.manage"), nvr_id, body)

    @r.post(f"{A}/integrations/{{nvr_id}}/probe")
    @guarded
    def probe(nvr_id: str, request: Request):
        return ops.probe_integration(svc, P(request, "integrations.manage"), nvr_id)

    @r.post(f"{A}/integrations/{{nvr_id}}/sync")
    @guarded
    def sync(nvr_id: str, request: Request, body: dict = Body(default={})):
        p = P(request)
        return ops.sync_channels(svc, p, nvr_id, apply=bool(body.get("apply")))

    @r.post(f"{A}/integrations/discover")
    @guarded
    def discover(request: Request):
        return ops.discovery(svc, P(request, "integrations.manage"))

    @r.get(f"{A}/network")
    @guarded
    def network(request: Request):
        P(request)
        return ops.network_view(svc)

    # ── security / audit ─────────────────────────────────────────────

    @r.get(f"{A}/security")
    @guarded
    def security(request: Request):
        p = P(request)
        v = svc.security_view()
        if not (p.can("sessions.manage") or p.can("security.manage")):
            v["sessions"] = [s for s in v["sessions"] if s["user_id"] == p.user_id]
            v["attempts"] = []
        return v

    @r.post(f"{A}/security/integrity/baseline")
    @guarded
    def baseline(request: Request):
        p = P(request, "security.manage")
        svc.require(p, "security.manage", global_scope=True)
        svc._baseline_integrity(p.username, p)
        return svc.integrity()

    @r.get(f"{A}/audit")
    @guarded
    def audit(request: Request, limit: int = 200, before: Optional[int] = None, user: str = "", action: str = "",
              result: str = "", q: str = ""):
        P(request, "audit.view")
        sql, args = "SELECT * FROM audit WHERE 1=1", []
        if before:
            sql += " AND id < ?"
            args.append(before)
        if user:
            sql += " AND user = ?"
            args.append(user)
        if action:
            sql += " AND action LIKE ?"
            args.append(action + "%")
        if result:
            sql += " AND result = ?"
            args.append(result)
        if q:
            sql += " AND (resource LIKE ? OR detail LIKE ? OR new LIKE ? OR prev LIKE ?)"
            args += [f"%{q}%"] * 4
        rows = svc.store.q(sql + " ORDER BY id DESC LIMIT ?", (*args, min(max(limit, 1), 1000)))
        actions = [a["action"] for a in svc.store.q("SELECT DISTINCT action FROM audit ORDER BY action")]
        users = [a["user"] for a in svc.store.q("SELECT DISTINCT user FROM audit ORDER BY user")]
        total = svc.store.one("SELECT COUNT(*) AS n FROM audit")["n"]
        return {"entries": rows, "actions": actions, "users": users, "total": total}

    @r.get(f"{A}/audit/verify")
    @guarded
    def audit_verify(request: Request):
        P(request, "audit.view")
        return svc.audit_status()

    @r.get(f"{A}/audit/export")
    @guarded
    def audit_export(request: Request):
        p = P(request, "audit.view")
        rows = svc.store.q("SELECT * FROM audit ORDER BY id")
        svc.audit(p, "audit.export", "audit", new={"entries": len(rows)})
        return PlainTextResponse("\n".join(json.dumps(x) for x in rows) + "\n", media_type="application/x-ndjson",
                                 headers={"Content-Disposition": f"attachment; filename=audit-{int(time.time())}.jsonl"})

    # ── storage / backups ────────────────────────────────────────────

    @r.get(f"{A}/storage")
    @guarded
    def storage(request: Request):
        P(request)
        return svc.storage_view()

    @r.post(f"{A}/storage/retention/run")
    @guarded
    def retention(request: Request):
        p = P(request, "config.manage")
        svc.require(p, "config.manage", global_scope=True)
        return svc.run_retention(p)

    @r.get(f"{A}/backups")
    @guarded
    def backups(request: Request):
        P(request)
        return {"backups": bk.list_backups(svc), "kinds": list(bk.KINDS)}

    @r.post(f"{A}/backups")
    @guarded
    def create_backup(request: Request, body: dict = Body(...)):
        p = P(request, "backup.manage")
        svc.require(p, "backup.manage", global_scope=True)
        return bk.create_backup(svc, p, body.get("kind", ""), str(body.get("note") or ""))

    @r.post(f"{A}/backups/{{bid}}/verify")
    @guarded
    def verify_backup(bid: str, request: Request):
        P(request, "backup.manage")
        return bk.verify_backup(svc, bid)

    @r.post(f"{A}/backups/{{bid}}/restore")
    @guarded
    def restore_backup(bid: str, request: Request, body: dict = Body(default={})):
        return bk.restore_backup(svc, P(request, "backup.manage"), bid, confirm=bool(body.get("confirm")))

    @r.delete(f"{A}/backups/{{bid}}")
    @guarded
    def delete_backup(bid: str, request: Request):
        p = P(request, "backup.manage")
        svc.require(p, "backup.manage", global_scope=True)
        bk.delete_backup(svc, p, bid)
        return {"ok": True}

    # ── configuration versions ───────────────────────────────────────

    @r.get(f"{A}/config")
    @guarded
    def config(request: Request):
        P(request)
        return {"active": svc.active(), "schema": svc.config_schema()}

    @r.get(f"{A}/config/versions")
    @guarded
    def versions(request: Request):
        P(request)
        return {"versions": svc.versions(), "active": svc.active()["version"]}

    @r.get(f"{A}/config/versions/{{v}}")
    @guarded
    def version(v: int, request: Request):
        P(request)
        doc = svc.version_doc(v)
        if doc is None:
            raise KeyError(v)
        return {"version": v, "doc": doc}

    @r.get(f"{A}/config/diff")
    @guarded
    def config_diff(a: int, b: int, request: Request):
        P(request)
        return {"a": a, "b": b, "changes": svc.diff_versions(a, b)}

    @r.post(f"{A}/config/preview")
    @guarded
    def config_preview(request: Request, body: dict = Body(...)):
        P(request)
        return svc.preview_config(body.get("doc") or {})

    @r.post(f"{A}/config/apply")
    @guarded
    def config_apply(request: Request, body: dict = Body(...)):
        p = principal(svc, request)
        return svc.apply_config(p, body.get("doc") or {}, str(body.get("comment") or ""))

    @r.post(f"{A}/config/rollback")
    @guarded
    def config_rollback(request: Request, body: dict = Body(...)):
        p = principal(svc, request)
        return svc.rollback(p, int(body["version"]), str(body.get("comment") or ""))

    @r.post(f"{A}/config/rollback/preview")
    @guarded
    def rollback_preview(request: Request, body: dict = Body(...)):
        P(request)
        doc = svc.version_doc(int(body["version"]))
        if doc is None:
            raise KeyError(body["version"])
        return svc.preview_config(doc)

    @r.get(f"{A}/readiness")
    @guarded
    def readiness(request: Request):
        P(request)
        return svc.readiness()

    # ── model improvement queue ──────────────────────────────────────

    @r.get(f"{A}/feedback")
    @guarded
    def feedback(request: Request, status: str = ""):
        P(request)
        rows = svc.db.feedback(status=status or None)
        counts = {}
        for f in svc.db.feedback():
            counts[f["status"]] = counts.get(f["status"], 0) + 1
        return {"items": rows, "counts": counts}

    @r.post(f"{A}/feedback/{{fid}}/review")
    @guarded
    def review(fid: int, request: Request, body: dict = Body(...)):
        return svc.review_feedback(P(request, "feedback.review"), fid, body.get("status"), body.get("note"))

    @r.get(f"{A}/feedback/dataset")
    @guarded
    def dataset(request: Request):
        P(request, "feedback.review")
        return svc.feedback_dataset()

    return r
