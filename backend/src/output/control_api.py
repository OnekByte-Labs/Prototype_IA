"""
/api/v1 — runtime detection-mode control, pipeline health, events and the
command-center WebSocket.

  GET    /api/v1/detection-modes
  GET    /api/v1/cameras
  GET    /api/v1/cameras/{camera_id}/detection-mode
  PATCH  /api/v1/cameras/{camera_id}/detection-mode   {"mode": "intrusion"}
  POST   /api/v1/cameras/{camera_id}/pipeline/restart
  GET    /api/v1/pipelines/health
  GET    /api/v1/diagnostics      decoders / RTSP connections / pipelines / resources / latencies
  GET    /api/v1/streams                      live stream status per camera + media server + NVRs
  POST   /api/v1/cameras/{camera_id}/webrtc?profile=sub|main|main_h264   WHEP offer (application/sdp) → answer
  DELETE /api/v1/cameras/{camera_id}/webrtc/{session_id}                  end a WebRTC session
  GET    /api/v1/events?camera_id=&limit=&after_id=
  GET    /api/v1/alerts/{alert_id}            full stored detail of one alert (INC-000123 or 123)
  GET    /api/v1/alerts/{alert_id}/snapshot   the annotated frame the alert fired on (JPEG)
  WS     /api/v1/ws        pipeline_state / event / alert / geometry / map_status / map_config pushes
"""

import asyncio

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from src.pipelines.base import DETECTION_MODES, PIPELINE_STATES
from src.runtime import CameraControlService, ModeConflict, parse_alert_id


class DetectionModeRequest(BaseModel):
    mode: str


def build_router(service: CameraControlService) -> APIRouter:
    r = APIRouter(prefix="/api/v1")

    @r.get("/detection-modes")
    def modes():
        return {"modes": [{"value": k, "label": v} for k, v in DETECTION_MODES.items()],
                "states": list(PIPELINE_STATES)}

    @r.get("/cameras")
    def cameras(request: Request):
        return service.describe_cameras(str(request.base_url).rstrip("/"))

    @r.get("/cameras/{camera_id}/detection-mode")
    def get_mode(camera_id: str):
        try:
            return service.public(service.get(camera_id))
        except (KeyError, ValueError):
            raise HTTPException(404, f"Unknown camera {camera_id}")

    def authorized(request: Request, perm: str, camera_id: str):
        """RBAC for camera mutations (the admin layer is always attached in live mode)."""
        if service.admin is None:
            return None
        from src.admin.api import principal
        p = principal(service.admin, request)
        service.admin.require_camera(p, perm, service.get(camera_id)["camera_id"])
        return p

    @r.patch("/cameras/{camera_id}/detection-mode", status_code=202)
    def set_mode(camera_id: str, body: DetectionModeRequest, request: Request):
        from src.admin.auth import AuthError
        try:
            p = authorized(request, "detection.manage", camera_id)
            if p is not None:
                # Same path as Admin ▸ AI model assignment (audited, capacity-checked)
                return service.admin.assign_mode(p, camera_id, body.mode.strip().lower(), force=True)
            return service.request_mode(camera_id, body.mode.strip().lower())
        except AuthError as e:
            raise HTTPException(e.status, str(e))
        except ValueError as e:
            raise HTTPException(422, str(e))
        except KeyError:
            raise HTTPException(404, f"Unknown camera {camera_id}")
        except ModeConflict as e:
            raise HTTPException(409, str(e))

    @r.post("/cameras/{camera_id}/pipeline/restart", status_code=202)
    def restart(camera_id: str, request: Request):
        from src.admin.auth import AuthError
        try:
            p = authorized(request, "detection.manage", camera_id)
            res = service.restart(camera_id)
            if p is not None:
                service.admin.audit(p, "pipeline.restart", f"camera:{res['camera_id']}")
            return res
        except AuthError as e:
            raise HTTPException(e.status, str(e))
        except (KeyError, ValueError):
            raise HTTPException(404, f"Unknown camera {camera_id}")

    from src.diagnostics import Diagnostics
    diag = Diagnostics(service)

    @r.get("/diagnostics")
    def diagnostics():
        """What is actually running: decoders, RTSP connections, pipelines,
        browser streams, per-component CPU / RAM / VRAM and stage latencies."""
        return diag.snapshot()

    @r.get("/pipelines/health")
    def health():
        return service.health_view()

    @r.get("/streams")
    def streams():
        return service.streams_view()

    def viewer(request: Request, camera_id: str) -> None:
        """Any signed-in user may watch cameras inside their scope."""
        if service.admin is None:
            return
        from src.admin.api import principal
        from src.admin.auth import AuthError
        try:
            p = principal(service.admin, request)
            if not service.admin.camera_in_scope(p, service.get(camera_id)["camera_id"]):
                raise AuthError(403, f"{camera_id} is outside your {p.scope_type} scope")
        except AuthError as e:
            raise HTTPException(e.status, str(e))

    @r.post("/cameras/{camera_id}/webrtc")
    async def webrtc_offer(camera_id: str, request: Request, profile: str = "sub"):
        """WHEP proxy: the browser never talks to the media server's HTTP API
        directly (media then flows browser ↔ media server over ICE/UDP)."""
        try:
            path = service.webrtc_path(camera_id, profile)
        except KeyError:
            raise HTTPException(404, f"Unknown camera {camera_id}")
        except ValueError as e:
            raise HTTPException(422, str(e))
        except LookupError as e:
            raise HTTPException(409, str(e))
        viewer(request, camera_id)
        sdp = (await request.body()).decode(errors="replace")
        if not sdp.startswith("v=0"):
            raise HTTPException(400, "Body must be an SDP offer (application/sdp)")
        status, answer, session = await run_in_threadpool(service.media.whep_offer, path, sdp)
        if status not in (200, 201):
            raise HTTPException(502 if status >= 500 else status, f"media server: {answer.strip()[:200]}")
        return Response(answer, status_code=201, media_type="application/sdp",
                        headers={"X-Session-Id": session or "", "Cache-Control": "no-store"})

    @r.delete("/cameras/{camera_id}/webrtc/{session_id}", status_code=204)
    async def webrtc_close(camera_id: str, session_id: str, request: Request, profile: str = "sub"):
        try:
            path = service.webrtc_path(camera_id, profile)
        except (KeyError, ValueError, LookupError):
            raise HTTPException(404, f"No WebRTC stream for {camera_id}")
        viewer(request, camera_id)
        await run_in_threadpool(service.media.whep_delete, path, session_id)
        return Response(status_code=204)

    @r.get("/events")
    def events(camera_id: str = None, limit: int = 100, after_id: int = 0):
        return service.db.events(camera_id=camera_id, limit=min(limit, 1000), after_id=after_id)

    def _alert(alert_id: str) -> dict:
        try:
            detail = service.alert_detail(parse_alert_id(alert_id))
        except ValueError:
            raise HTTPException(404, f"Unknown alert {alert_id}")
        if detail is None:
            raise HTTPException(404, f"Unknown alert {alert_id}")
        return detail

    @r.get("/alerts/{alert_id}")
    def alert(alert_id: str):
        return _alert(alert_id)

    @r.get("/alerts/{alert_id}/snapshot")
    def alert_snapshot(alert_id: str):
        _alert(alert_id)
        ev = service.db.event(parse_alert_id(alert_id))
        path = service.evidence.path((ev.get("snapshot") or {}).get("file")) if service.evidence else None
        if path is None:
            raise HTTPException(404, f"No evidence stored for {alert_id}")
        # Evidence never changes once written
        return FileResponse(path, media_type="image/jpeg",
                            headers={"Cache-Control": "private, max-age=86400, immutable"})

    @r.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        if service.ws.loop is None:
            service.ws.attach(asyncio.get_running_loop())
        q = service.ws.subscribe()
        try:
            await websocket.send_json({"type": "snapshot",
                                       "cameras": [service.public(c) for c in service.cams.values()]})
            if service.map is not None:
                await websocket.send_json(service.map.status_message())

            async def pump():
                while True:
                    await websocket.send_text(await q.get())

            async def drain():            # detect client disconnects
                while True:
                    await websocket.receive_text()

            done, pending = await asyncio.wait(
                [asyncio.create_task(pump()), asyncio.create_task(drain())],
                return_when=asyncio.FIRST_EXCEPTION)
            for t in pending:
                t.cancel()
            for t in done:
                t.exception()   # consume the (expected) disconnect so asyncio doesn't log it
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            service.ws.unsubscribe(q)

    return r
