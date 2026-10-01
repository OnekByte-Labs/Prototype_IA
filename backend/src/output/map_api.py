"""
/api/v1/map — tactical GIS hierarchy (Battalion → Company → Post → Camera).

  GET    /api/v1/map                          hierarchy + camera placement/FOV + live status + basemaps
  PUT    /api/v1/map                          save an edited map   (X-Map-Edit-Token, revision-checked)
  POST   /api/v1/map/edit-session             {"passphrase"} → {"token", "expires_at"}
  DELETE /api/v1/map/edit-session             end the edit session
  GET    /api/v1/map/coverage?exclude_offline=  coverage gaps inside the AOR boundary (saved map)
  POST   /api/v1/map/coverage                 same, for an unsaved Edit Map draft
  GET    /api/v1/map/cameras-at?lat=&lon=     cameras whose FOV contains the point
  GET    /api/v1/map/relationships?camera_id= overlap / adjacent / same post / same company
  GET    /api/v1/map/health                   live per-camera ingest (frame age, fps) + NVR ingest
  GET    /tiles/{z}/{x}/{y}                   local (offline) basemap tiles
  GET    /dem/{z}/{x}/{y}                     local (offline) Terrarium elevation tiles

Live status changes and saved edits are pushed over the existing /api/v1/ws
(``map_status`` / ``map_config``).
"""

from typing import Optional

from fastapi import APIRouter, Body, Header, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from src.db import MapRevisionConflict
from src.gis import EditAuthError, MapService, MapValidationError


class EditSessionRequest(BaseModel):
    passphrase: str


def build_map_router(svc: MapService, admin=None) -> APIRouter:
    r = APIRouter()

    def authorize(request: Request):
        """With the admin layer attached, editing the map also needs hierarchy.manage."""
        if admin is None:
            return None
        from src.admin.api import principal
        from src.admin.auth import AuthError
        try:
            p = principal(admin, request)
            admin.require(p, "hierarchy.manage", global_scope=True, resource="map")
            return p
        except AuthError as e:
            raise HTTPException(e.status, str(e))

    @r.get("/api/v1/map")
    def get_map():
        return svc.config_view()

    @r.put("/api/v1/map")
    def put_map(request: Request, body: dict = Body(...), x_map_edit_token: Optional[str] = Header(None)):
        p = authorize(request)
        try:
            res = svc.save(body, x_map_edit_token)
            if p is not None:
                admin.audit(p, "hierarchy.map_save", "map", new={"revision": res["revision"]})
                admin.publish("hierarchy")
            return res
        except EditAuthError as e:
            raise HTTPException(401, str(e))
        except MapRevisionConflict as e:
            raise HTTPException(409, str(e))
        except (MapValidationError, KeyError) as e:
            raise HTTPException(422, str(e))

    @r.post("/api/v1/map/edit-session")
    def open_session(body: EditSessionRequest, request: Request):
        authorize(request)
        try:
            return svc.open_edit_session(body.passphrase)
        except EditAuthError as e:
            raise HTTPException(401, str(e))

    @r.delete("/api/v1/map/edit-session", status_code=204)
    def close_session(x_map_edit_token: Optional[str] = Header(None)):
        svc.close_edit_session(x_map_edit_token)

    @r.get("/api/v1/map/coverage")
    def coverage(exclude_offline: bool = False):
        return svc.coverage(exclude_offline=exclude_offline)

    @r.post("/api/v1/map/coverage")
    def coverage_draft(body: dict = Body(...), exclude_offline: bool = False):
        try:
            return svc.coverage(draft=body, exclude_offline=exclude_offline)
        except (MapValidationError, KeyError) as e:
            raise HTTPException(422, str(e))

    @r.get("/api/v1/map/cameras-at")
    def cameras_at(lat: float, lon: float):
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise HTTPException(422, "lat/lon out of range")
        return svc.cameras_at(lat, lon)

    @r.get("/api/v1/map/relationships")
    def relationships(camera_id: Optional[str] = None):
        return svc.relationships_view(camera_id)

    @r.get("/api/v1/map/health")
    def health():
        return svc.health_view()

    @r.get("/tiles/{z}/{x}/{y}")
    def tile(z: int, x: int, y: int):
        path = svc.tile_path(z, x, y)
        if path is None:
            raise HTTPException(404, "tile not in the local cache")
        return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})

    @r.get("/dem/{z}/{x}/{y}")
    def dem(z: int, x: int, y: int):
        path = svc.tile_path(z, x, y, dem=True)
        if path is None:
            raise HTTPException(404, "elevation tile not in the local cache")
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})

    return r
