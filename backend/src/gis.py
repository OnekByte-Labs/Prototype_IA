"""
Tactical GIS map service: Battalion HQ → Companies → Posts → Cameras (+ NVRs).

  * Hierarchy + camera placement/FOV live in the command-center database
    (db.py); this module validates edits, derives camera relationships and
    coverage, and computes live map status.
  * Status comes from the live runtime — pipeline state, frame freshness and
    real alerts — and rolls up Camera → Post → Company → Battalion. Changes are
    pushed over the existing /api/v1/ws broadcaster (``map_status``); a saved
    edit is announced as ``map_config`` so every console refetches.
  * The seed hierarchy (8 companies × 8–10 posts × 2 cameras) is generated
    from map.yaml by generate_seed_layout — synthetic positions, with posts on
    high ground and cameras aimed downhill when a DEM is available.

Geometry is done in a local equirectangular metric frame centred on the
battalion HQ (errors are negligible over a battalion's area of responsibility).
"""

import hmac
import json
import logging
import math
import os
import random
import re
import secrets
import threading
import time
from typing import Dict, Iterable, List, Optional, Tuple

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

logger = logging.getLogger("gis")

EARTH_R = 6371008.8
ONLINE, ALERT, DEGRADED, OFFLINE = "ONLINE", "ALERT", "DEGRADED", "OFFLINE"
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
WEDGE_STEPS = 32
MIN_GAP_M2 = 25.0          # drop numerical slivers from the gap layer


# ── geometry ────────────────────────────────────────────────────────

def offset_to_latlon(origin: Tuple[float, float], east_m: float, north_m: float) -> Tuple[float, float]:
    lat0, lon0 = origin
    lat = lat0 + math.degrees(north_m / EARTH_R)
    lon = lon0 + math.degrees(east_m / (EARTH_R * math.cos(math.radians(lat0))))
    return round(lat, 7), round(lon, 7)


class LocalFrame:
    """lat/lon ↔ metres east/north of an origin."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = math.radians(1) * EARTH_R * math.cos(math.radians(lat0))
        self.ky = math.radians(1) * EARTH_R

    def xy(self, lat: float, lon: float) -> Tuple[float, float]:
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def latlon(self, x: float, y: float) -> List[float]:
        return [round(self.lat0 + y / self.ky, 7), round(self.lon0 + x / self.kx, 7)]


def wedge_xy(x: float, y: float, bearing: float, fov: float, range_m: float) -> List[Tuple[float, float]]:
    """FOV sector (bearing clockwise from north) as a closed ring."""
    if fov >= 359.9:
        return [(x + range_m * math.sin(math.radians(a)), y + range_m * math.cos(math.radians(a)))
                for a in range(0, 360, 360 // WEDGE_STEPS)]
    start = bearing - fov / 2
    pts = [(x, y)]
    for i in range(WEDGE_STEPS + 1):
        a = math.radians(start + fov * i / WEDGE_STEPS)
        pts.append((x + range_m * math.sin(a), y + range_m * math.cos(a)))
    return pts


def angle_diff(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def rollup(children: Iterable[str]) -> str:
    """Parent status: any ALERT → ALERT; all OFFLINE (or no children) → OFFLINE;
    any OFFLINE/DEGRADED → DEGRADED; else ONLINE."""
    s = list(children)
    if not s:
        return OFFLINE
    if ALERT in s:
        return ALERT
    if all(x == OFFLINE for x in s):
        return OFFLINE
    if any(x in (OFFLINE, DEGRADED) for x in s):
        return DEGRADED
    return ONLINE


class MapValidationError(ValueError):
    pass


class EditAuthError(PermissionError):
    pass


# ── service ─────────────────────────────────────────────────────────

class MapService:
    def __init__(self, db, cfg: dict, ws, runtime=None, frame_store=None, project_root=None):
        self.db, self.cfg, self.ws = db, cfg, ws
        self.runtime, self.frame_store = runtime, frame_store
        st = cfg.get("status") or {}
        self.alert_hold_s = float(st.get("alert_hold_s", 60))
        self.frame_stale_s = float(st.get("frame_stale_s", 5))
        self.frame_degraded_s = float(st.get("frame_degraded_s", 2))
        self.tick_s = float(st.get("tick_s", 1.0))
        self.adjacent_m = float((cfg.get("relationships") or {}).get("adjacent_m", 400))
        tiles, dem = cfg.get("local_tiles_dir"), cfg.get("local_dem_dir")
        self.tiles_dir = (project_root / tiles) if (project_root and tiles) else None
        self.dem_dir = (project_root / dem) if (project_root and dem) else None

        edit = cfg.get("edit") or {}
        env = edit.get("passphrase_env", "MAP_EDIT_PASSPHRASE")
        self._passphrase = os.environ.get(env) or edit.get("dev_passphrase")
        if not os.environ.get(env):
            logger.warning("Map edit passphrase: %s is not set — using the DEV passphrase from map.yaml", env)
        self._session_ttl = float(edit.get("session_ttl_s", 1800))
        self._sessions: Dict[str, float] = {}

        self._lock = threading.Lock()
        self._last_alert: Dict[str, float] = {}
        self.statuses: Dict[str, str] = {}
        self._stop = threading.Event()

        if not db.relationships():          # first start / upgraded database
            db.replace_relationships(self._relationships(db.map_units(), db.map_cameras()))
        self.refresh(publish=False)

    # ── lifecycle / runtime hooks ────────────────────────────────────

    def start(self) -> None:
        def loop():
            while not self._stop.wait(self.tick_s):
                try:
                    self.refresh()
                except Exception:
                    logger.exception("Map status refresh failed")
        threading.Thread(target=loop, daemon=True, name="map-status").start()

    def stop(self) -> None:
        self._stop.set()

    def on_alert(self, alert: dict) -> None:
        with self._lock:
            self._last_alert[alert["camera_id"]] = time.monotonic()
        self.refresh()

    # ── status ───────────────────────────────────────────────────────

    def _runtime_cam(self, camera_id: str) -> Optional[dict]:
        if self.runtime is None:
            return None
        from src.runtime import camera_key
        return self.runtime.cams.get(camera_key(camera_id))

    def _ingest(self, camera_id: str) -> Tuple[bool, Optional[float]]:
        """(pipeline bound to a video source, seconds since its last frame)."""
        rc = self._runtime_cam(camera_id)
        if rc is None or self.frame_store is None:
            return False, None
        return True, self._feed_age(rc)

    def _feed_age(self, rc: dict) -> Optional[float]:
        """Decoded-frame age while the camera is decoded; otherwise the media
        server's view of its live channel (decoding is on demand)."""
        frame_age = self.frame_store.age(rc["key"])
        return self.runtime.feed_age(rc["key"], frame_age) if self.runtime is not None else frame_age

    def _camera_status(self, camera_id: str, now: float) -> str:
        with self._lock:
            last = self._last_alert.get(camera_id)
        if last is not None and now - last < self.alert_hold_s:
            return ALERT
        rc = self._runtime_cam(camera_id)
        if rc is None or self.frame_store is None:
            return OFFLINE                      # no live pipeline / no video source
        age = self._feed_age(rc)
        if age is None or age > self.frame_stale_s:
            return OFFLINE
        if rc["state"] == "error" or age > self.frame_degraded_s:
            return DEGRADED
        return ONLINE

    def compute_statuses(self, units: Optional[List[dict]] = None,
                         cameras: Optional[List[dict]] = None) -> Dict[str, str]:
        units = self.db.map_units() if units is None else units
        cameras = self.db.map_cameras() if cameras is None else cameras
        now = time.monotonic()
        out: Dict[str, str] = {c["camera_id"]: self._camera_status(c["camera_id"], now) for c in cameras}
        posts = [u for u in units if u["unit_type"] == "post"]
        companies = [u for u in units if u["unit_type"] == "company"]
        by_post: Dict[str, List[str]] = {}
        for c in cameras:
            if c["post_id"]:
                by_post.setdefault(c["post_id"], []).append(out[c["camera_id"]])
        for p in posts:
            out[p["unit_id"]] = rollup(by_post.get(p["unit_id"], []))
        for co in companies:
            out[co["unit_id"]] = rollup(out[p["unit_id"]] for p in posts if p["parent_id"] == co["unit_id"])
        for bn in (u for u in units if u["unit_type"] == "battalion"):
            out[bn["unit_id"]] = rollup(out[co["unit_id"]] for co in companies)
        for n, ingest in self._nvr_ingest(units, cameras).items():
            out[n] = ingest["status"]
        return out

    def _nvr_ingest(self, units: List[dict], cameras: List[dict],
                    nvrs: Optional[List[dict]] = None) -> Dict[str, dict]:
        """NVR health from the real ingest of the company's cameras: of the
        cameras that have a live video pipeline, how many are delivering
        frames. ONLINE all · DEGRADED some · OFFLINE none (or nothing bound)."""
        nvrs = self.db.map_nvrs() if nvrs is None else nvrs
        company_of = {u["unit_id"]: u["parent_id"] for u in units if u["unit_type"] == "post"}
        out = {}
        for n in nvrs:
            cams = [c for c in cameras if company_of.get(c["post_id"]) == n["company_id"]]
            bound = streaming = 0
            for c in cams:
                has, age = self._ingest(c["camera_id"])
                bound += has
                streaming += has and age is not None and age <= self.frame_stale_s
            status = OFFLINE if streaming == 0 else ONLINE if streaming == bound else DEGRADED
            out[n["nvr_id"]] = {"status": status, "company_id": n["company_id"], "assigned": len(cams),
                                "bound": bound, "streaming": streaming}
        return out

    def refresh(self, publish: bool = True) -> None:
        statuses = self.compute_statuses()
        with self._lock:
            changed = {k: v for k, v in statuses.items() if self.statuses.get(k) != v}
            removed = [k for k in self.statuses if k not in statuses]
            self.statuses = statuses
        if publish and (changed or removed):
            self.ws.publish(self.status_message(changed))

    def status_message(self, changed: Optional[dict] = None) -> dict:
        with self._lock:
            statuses = dict(self.statuses)
        return {"type": "map_status", "revision": self.db.map_revision(), "statuses": statuses,
                "changed": changed if changed is not None else statuses}

    # ── read model ───────────────────────────────────────────────────

    def _frame(self, units: List[dict]) -> LocalFrame:
        bn = next((u for u in units if u["unit_type"] == "battalion"), None)
        return LocalFrame(bn["latitude"], bn["longitude"]) if bn else LocalFrame(0.0, 0.0)

    def _image_geometry_geo(self, cam: dict, frame: LocalFrame) -> dict:
        """Approximate ground footprint of the camera's configured image-space
        zone/line: x across the FOV, y from near (bottom) to max range (top).
        Uncalibrated — a flat-ground approximation for situational awareness."""
        rc = self._runtime_cam(cam["camera_id"])
        if rc is None or cam["latitude"] is None:
            return {"zone_geo": None, "line_geo": None}
        w, h = float(rc["width"] or 0), float(rc["height"] or 0)
        if w <= 0 or h <= 0:
            return {"zone_geo": None, "line_geo": None}
        geom = self.db.geometry(cam["camera_id"])
        cx, cy = frame.xy(cam["latitude"], cam["longitude"])
        near = 0.05 * cam["range_m"]

        def proj(pts):
            out = []
            for px, py in pts:
                a = math.radians(cam["bearing"] - cam["fov_angle"] / 2 + cam["fov_angle"] * min(max(px / w, 0), 1))
                d = near + (cam["range_m"] - near) * (1 - min(max(py / h, 0), 1))
                out.append(frame.latlon(cx + d * math.sin(a), cy + d * math.cos(a)))
            return out

        return {"zone_geo": proj(geom["zone"]) if geom.get("zone") else None,
                "line_geo": proj(geom["line"]) if geom.get("line") else None}

    def config_view(self) -> dict:
        units, cameras = self.db.map_units(), self.db.map_cameras()
        frame = self._frame(units)
        with self._lock:
            statuses = dict(self.statuses)

        def entity(u: dict) -> dict:
            e = {"id": u["unit_id"], "parent_id": u["parent_id"], "name": u["name"], "type": u["unit_type"],
                 "latitude": u["latitude"], "longitude": u["longitude"],
                 "status": statuses.get(u["unit_id"], OFFLINE)}
            if u["unit_type"] == "battalion":
                e["boundary"] = u["boundary"]
            return e

        cams = []
        for c in cameras:
            rc = self._runtime_cam(c["camera_id"])
            cams.append({
                "id": c["camera_id"], "parent_id": c["post_id"], "name": c["name"], "type": "camera",
                "latitude": c["latitude"], "longitude": c["longitude"],
                "status": statuses.get(c["camera_id"], OFFLINE),
                "bearing": c["bearing"], "fov_angle": c["fov_angle"], "range": c["range_m"],
                "detection_mode": rc["detection_mode"] if rc else c["detection_mode"],
                "pipeline_state": rc["state"] if rc else None,
                "has_source": rc is not None,
                "source_bound": bool(c["source_id"]),
                **self._image_geometry_geo(c, frame),
            })
        bn = next((u for u in units if u["unit_type"] == "battalion"), None)
        return {
            "revision": self.db.map_revision(),
            "synthetic_positions": True,
            "basemaps": self.cfg.get("basemaps", []),
            "default_basemap": self.cfg.get("default_basemap"),
            "status_rules": {"alert_hold_s": self.alert_hold_s, "frame_stale_s": self.frame_stale_s,
                             "frame_degraded_s": self.frame_degraded_s},
            "battalion": entity(bn) if bn else None,
            "companies": [entity(u) for u in units if u["unit_type"] == "company"],
            "posts": [entity(u) for u in units if u["unit_type"] == "post"],
            "cameras": cams,
            "nvrs": [{"id": n["nvr_id"], "parent_id": n["company_id"], "name": n["name"], "type": "nvr",
                      "latitude": n["latitude"], "longitude": n["longitude"],
                      "status": statuses.get(n["nvr_id"], OFFLINE)} for n in self.db.map_nvrs()],
        }

    def health_view(self) -> dict:
        """Live per-camera ingest (frame age, measured frame rate, pipeline
        state) and per-NVR ingest — the Camera Health / NVR Health layers."""
        units, cameras = self.db.map_units(), self.db.map_cameras()
        with self._lock:
            statuses = dict(self.statuses)
        now = time.time()
        cams = {}
        for c in cameras:
            rc = self._runtime_cam(c["camera_id"])
            has, age = self._ingest(c["camera_id"])
            health, issue = self._device_health(c, rc, age)
            mode = rc["detection_mode"] if rc else c["detection_mode"]
            cams[c["camera_id"]] = {
                "status": statuses.get(c["camera_id"], OFFLINE), "source_bound": bool(c["source_id"]),
                "pipeline": has, "pipeline_state": rc["state"] if rc else None,
                "frame_age_s": round(age, 2) if age is not None else None,
                "fps": round(self.frame_store.rate(rc["key"]), 1) if has and rc.get("decoding") else None,
                "decoding": bool(rc.get("decoding")) if rc else False,
                # Device health (ONLINE / DEGRADED / OFFLINE) — unlike `status`, never ALERT
                "health": health, "issue": issue,
                "last_frame_at": round(now - age, 3) if age is not None else None,
                "detection_mode": mode, "pipeline_error": rc["error"] if rc else None,
                "recording": self._recording(rc, mode, health),
            }
        nvrs = self._nvr_ingest(units, cameras)
        company_of = {u["unit_id"]: u["parent_id"] for u in units if u["unit_type"] == "post"}
        for n in self.db.map_nvrs():
            ing = nvrs.get(n["nvr_id"])
            if ing is None:
                continue
            members = [c["camera_id"] for c in cameras if company_of.get(c["post_id"]) == n["company_id"]]
            faulty = [cid for cid in members if cams[cid]["pipeline"] and cams[cid]["health"] != ONLINE]
            ing.update({
                "name": n["name"], "cameras": members, "affected": faulty,
                "capturing": sum(cams[cid]["recording"] == "EVENTS" for cid in members),
                "issue": (None if ing["status"] == ONLINE else
                          "No camera streams assigned" if ing["bound"] == 0 else
                          "No live streams ingesting" if ing["streaming"] == 0 else
                          f"{ing['bound'] - ing['streaming']} of {ing['bound']} streams not ingesting"),
            })
        return {"checked_at": round(now, 3), "rules": {"frame_stale_s": self.frame_stale_s,
                                                       "frame_degraded_s": self.frame_degraded_s},
                "cameras": cams, "nvrs": nvrs, "storage": self._storage()}

    def _device_health(self, cam: dict, rc: Optional[dict], age: Optional[float]) -> Tuple[str, Optional[str]]:
        """Camera device health + the concrete fault, from real ingest state."""
        if not cam["source_id"]:
            return OFFLINE, "No video source bound"
        if rc is None or self.frame_store is None:
            return OFFLINE, "Video source unavailable"
        if age is None:
            return OFFLINE, "No frames received" if rc.get("decoding") else "Channel not available on the media server"
        if age > self.frame_stale_s:
            return OFFLINE, f"No frames for {age:.0f}s" if rc.get("decoding") else f"Channel down for {age:.0f}s"
        if rc["state"] == "error":
            return DEGRADED, f"Pipeline error: {rc['error'] or 'unknown'}"
        if age > self.frame_degraded_s:
            return DEGRADED, f"Frame delay {age:.1f}s"
        return ONLINE, None

    @staticmethod
    def _recording(rc: Optional[dict], mode: str, health: str) -> str:
        """What the camera is persisting. There is no continuous video recording:
        a running detection pipeline writes every event to the database and
        each alert's frame as evidence."""
        if rc is None:
            return "N/A"
        if mode == "none":
            return "OFF"
        if health == OFFLINE or rc["state"] not in ("running", "stopping"):
            return "STOPPED"
        return "EVENTS"

    def _storage(self) -> Optional[dict]:
        """Host volume usage, cached 15 s (sizing walks the evidence store)."""
        now = time.monotonic()
        cached = getattr(self, "_storage_cache", None)
        if cached and now - cached[0] < 15.0:
            return cached[1]
        v = self._storage_uncached()
        self._storage_cache = (now, v)
        return v

    def _storage_uncached(self) -> Optional[dict]:
        """Host volume the system records to (event DB, event log, alert evidence)."""
        import shutil
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        try:
            du = shutil.disk_usage(root / "outputs" if (root / "outputs").exists() else root)
        except OSError:
            return None

        def size(p: Path) -> int:
            if p.is_file():
                return p.stat().st_size
            return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.is_dir() else 0

        return {"total_bytes": du.total, "used_bytes": du.used, "free_bytes": du.free,
                "system_bytes": {"evidence": size(root / "outputs" / "evidence"),
                                 "event_log": size(root / "outputs" / "events.jsonl"),
                                 "database": sum(size(p) for p in (root / "data").glob("command_center.db*"))}}

    # ── analysis ─────────────────────────────────────────────────────

    def _wedge(self, cam: dict, frame: LocalFrame) -> Polygon:
        x, y = frame.xy(cam["latitude"], cam["longitude"])
        poly = Polygon(wedge_xy(x, y, cam["bearing"], cam["fov_angle"], cam["range_m"]))
        return poly if poly.is_valid else poly.buffer(0)

    def _relationships(self, units: List[dict], cameras: List[dict]) -> List[dict]:
        frame = self._frame(units)
        company_of = {u["unit_id"]: u["parent_id"] for u in units if u["unit_type"] == "post"}
        placed = sorted((c for c in cameras if c["latitude"] is not None), key=lambda c: c["camera_id"])
        geo = {c["camera_id"]: (frame.xy(c["latitude"], c["longitude"]), self._wedge(c, frame)) for c in placed}
        rels = []
        for i, a in enumerate(placed):
            (ax, ay), wa = geo[a["camera_id"]]
            for b in placed[i + 1:]:
                (bx, by), wb = geo[b["camera_id"]]
                base = {"camera_a": a["camera_id"], "camera_b": b["camera_id"],
                        "distance_m": round(math.hypot(ax - bx, ay - by), 1),
                        "bearing_delta": round(angle_diff(a["bearing"], b["bearing"]), 1)}
                near = base["distance_m"] <= a["range_m"] + b["range_m"]
                inter = wa.intersection(wb).area if near and wa.intersects(wb) else 0.0
                if inter > 1.0:
                    rels.append({**base, "relation": "overlap", "overlap_m2": round(inter, 1),
                                 "overlap_ratio": round(inter / max(min(wa.area, wb.area), 1e-6), 4)})
                elif base["distance_m"] <= self.adjacent_m:
                    rels.append({**base, "relation": "adjacent"})
                if a["post_id"] and a["post_id"] == b["post_id"]:
                    rels.append({**base, "relation": "same_post"})
                ca, cb = company_of.get(a["post_id"]), company_of.get(b["post_id"])
                if ca and ca == cb:
                    rels.append({**base, "relation": "same_company"})
        return rels

    def relationships_view(self, camera_id: Optional[str] = None) -> List[dict]:
        rels = self.db.relationships(camera_id)
        if camera_id:
            rels = [{**r, "other": r["camera_b"] if r["camera_a"] == camera_id else r["camera_a"]} for r in rels]
        return rels

    def coverage(self, draft: Optional[dict] = None, exclude_offline: bool = False) -> dict:
        """Uncovered parts of the AOR boundary given the cameras' FOV wedges.
        ``draft`` (unsaved Edit Map state) is analysed without persisting."""
        if draft is not None:
            units, cameras, _ = self._normalize(draft)
        else:
            units, cameras = self.db.map_units(), self.db.map_cameras()
        bn = next((u for u in units if u["unit_type"] == "battalion"), None)
        if not bn or not bn.get("boundary") or len(bn["boundary"]) < 3:
            return {"error": "No area-of-responsibility boundary configured", "gaps": []}
        frame = self._frame(units)
        boundary = Polygon([frame.xy(lat, lon) for lat, lon in bn["boundary"]])
        if not boundary.is_valid:
            boundary = boundary.buffer(0)
        with self._lock:
            statuses = dict(self.statuses)
        used = [c for c in cameras if c["latitude"] is not None
                and not (exclude_offline and statuses.get(c["camera_id"], OFFLINE) == OFFLINE)]
        covered = unary_union([self._wedge(c, frame) for c in used]).intersection(boundary) if used else Polygon()
        gaps = boundary.difference(covered)
        polys = [g for g in getattr(gaps, "geoms", [gaps]) if g.geom_type == "Polygon" and g.area >= MIN_GAP_M2]
        polys.sort(key=lambda g: g.area, reverse=True)
        return {
            "boundary_area_m2": round(boundary.area, 1),
            "covered_area_m2": round(covered.area, 1),
            "gap_area_m2": round(sum(g.area for g in polys), 1),
            "coverage_pct": round(100.0 * covered.area / boundary.area, 2) if boundary.area else 0.0,
            "cameras_used": len(used),
            "exclude_offline": exclude_offline,
            "gaps": [{"outer": [frame.latlon(x, y) for x, y in g.exterior.coords],
                      "holes": [[frame.latlon(x, y) for x, y in r.coords] for r in g.interiors],
                      "area_m2": round(g.area, 1)} for g in polys],
        }

    def cameras_at(self, lat: float, lon: float) -> dict:
        """Every camera whose FOV contains the point ("what could have seen this?")."""
        units, cameras = self.db.map_units(), self.db.map_cameras()
        frame = self._frame(units)
        company_of = {u["unit_id"]: u["parent_id"] for u in units if u["unit_type"] == "post"}
        px, py = frame.xy(lat, lon)
        with self._lock:
            statuses = dict(self.statuses)
        hits = []
        for c in cameras:
            if c["latitude"] is None:
                continue
            cx, cy = frame.xy(c["latitude"], c["longitude"])
            d = math.hypot(px - cx, py - cy)
            brg = math.degrees(math.atan2(px - cx, py - cy)) % 360
            off = angle_diff(brg, c["bearing"])
            if d <= c["range_m"] and (c["fov_angle"] >= 359.9 or off <= c["fov_angle"] / 2 or d < 0.5):
                hits.append({"camera_id": c["camera_id"], "name": c["name"], "post_id": c["post_id"],
                             "company_id": company_of.get(c["post_id"]),
                             "status": statuses.get(c["camera_id"], OFFLINE),
                             "detection_mode": c["detection_mode"], "distance_m": round(d, 1),
                             "bearing_to_point": round(brg, 1), "off_axis_deg": round(off, 1)})
        hits.sort(key=lambda h: h["distance_m"])
        return {"point": [lat, lon], "cameras": hits}

    # ── editing ──────────────────────────────────────────────────────

    def open_edit_session(self, passphrase: str) -> dict:
        if not self._passphrase or not hmac.compare_digest(passphrase.encode(), self._passphrase.encode()):
            raise EditAuthError("Invalid edit passphrase")
        token = secrets.token_urlsafe(24)
        expires = time.time() + self._session_ttl
        with self._lock:
            now = time.time()
            self._sessions = {t: e for t, e in self._sessions.items() if e > now}
            self._sessions[token] = expires
        return {"token": token, "expires_at": expires}

    def close_edit_session(self, token: Optional[str]) -> None:
        with self._lock:
            self._sessions.pop(token or "", None)

    def check_token(self, token: Optional[str]) -> None:
        with self._lock:
            exp = self._sessions.get(token or "")
        if exp is None or exp < time.time():
            raise EditAuthError("Edit session missing or expired — re-enter the edit passphrase")

    def _normalize(self, body: dict) -> Tuple[List[dict], List[dict], List[dict]]:
        """Validate an edited map (Edit Map payload) into DB rows. Cameras not
        in the payload keep their saved placement; any camera whose post no
        longer exists becomes unassigned; NVRs of removed companies go too."""
        def err(msg):
            raise MapValidationError(msg)

        def num(v, name, lo, hi):
            try:
                f = float(v)
            except (TypeError, ValueError):
                err(f"{name} must be a number")
            if not math.isfinite(f) or not lo <= f <= hi:
                err(f"{name} must be within [{lo}, {hi}]")
            return f

        def name_of(e, what):
            n = str(e.get("name") or "").strip()
            if not n or len(n) > 64:
                err(f"{what} needs a name (1–64 characters)")
            return n

        def ll(e, what):
            return (num(e.get("latitude"), f"{what} latitude", -90, 90),
                    num(e.get("longitude"), f"{what} longitude", -180, 180))

        saved_units = self.db.map_units()
        saved_bn = next((u for u in saved_units if u["unit_type"] == "battalion"), None)
        bn = body.get("battalion") or {}
        bn_id = saved_bn["unit_id"] if saved_bn else "BN-HQ"
        boundary = bn.get("boundary", saved_bn["boundary"] if saved_bn else None)
        if boundary is not None:
            if not isinstance(boundary, list) or len(boundary) < 3:
                err("The boundary needs at least 3 vertices")
            boundary = [[num(p[0], "boundary latitude", -90, 90), num(p[1], "boundary longitude", -180, 180)]
                        for p in boundary]
        bn_lat, bn_lon = ll(bn, "Battalion HQ")
        units = [{"unit_id": bn_id, "unit_type": "battalion", "parent_id": None, "name": name_of(bn, "Battalion"),
                  "latitude": bn_lat, "longitude": bn_lon, "boundary": boundary, "sort_order": 0}]
        seen = {bn_id}
        for kind, key, parents in (("company", "companies", None), ("post", "posts", "company")):
            valid_parents = {u["unit_id"] for u in units if u["unit_type"] == parents} if parents else {bn_id}
            for i, e in enumerate(body.get(key) or []):
                uid = str(e.get("id") or "")
                if not ID_RE.match(uid):
                    err(f"Invalid {kind} id '{uid}'")
                if uid in seen:
                    err(f"Duplicate id '{uid}'")
                seen.add(uid)
                parent = bn_id if kind == "company" else e.get("parent_id")
                if parent not in valid_parents:
                    err(f"{kind.title()} {uid} must belong to an existing {parents or 'battalion'}")
                lat, lon = ll(e, f"{kind.title()} {uid}")
                units.append({"unit_id": uid, "unit_type": kind, "parent_id": parent, "name": name_of(e, uid),
                              "latitude": lat, "longitude": lon, "boundary": None, "sort_order": i})

        post_ids = {u["unit_id"] for u in units if u["unit_type"] == "post"}
        cameras = {c["camera_id"]: dict(c) for c in self.db.map_cameras()}
        for e in body.get("cameras") or []:
            cid = str(e.get("id") or "")
            if cid not in cameras:
                err(f"Unknown camera '{cid}'")
            post = e.get("parent_id", e.get("post_id"))
            if post is not None and post not in post_ids:
                err(f"Camera {cid}: post '{post}' does not exist")
            lat, lon = ll(e, f"Camera {cid}")
            cameras[cid].update({
                "post_id": post, "latitude": lat, "longitude": lon,
                "bearing": num(e.get("bearing"), f"{cid} bearing", -360, 720) % 360,
                "fov_angle": num(e.get("fov_angle"), f"{cid} FOV angle", 1, 360),
                "range_m": num(e.get("range", e.get("range_m")), f"{cid} range", 1, 20000),
            })
        for c in cameras.values():
            if c["post_id"] not in post_ids:
                c["post_id"] = None

        company_ids = {u["unit_id"] for u in units if u["unit_type"] == "company"}
        if body.get("nvrs") is None:
            nvrs = [n for n in self.db.map_nvrs() if n["company_id"] in company_ids]
        else:
            nvrs = []
            for e in body["nvrs"]:
                nid = str(e.get("id") or "")
                if not ID_RE.match(nid) or nid in seen:
                    err(f"Invalid or duplicate NVR id '{nid}'")
                seen.add(nid)
                company = e.get("parent_id", e.get("company_id"))
                if company not in company_ids:
                    continue                       # its company was removed
                lat, lon = ll(e, f"NVR {nid}")
                nvrs.append({"nvr_id": nid, "company_id": company, "name": name_of(e, nid),
                             "latitude": lat, "longitude": lon})
        return units, list(cameras.values()), nvrs

    def save(self, body: dict, token: Optional[str]) -> dict:
        self.check_token(token)
        return self.save_internal(body)

    def after_restore(self) -> None:
        """The database was restored from a backup: recompute and announce."""
        self.db.replace_relationships(self._relationships(self.db.map_units(), self.db.map_cameras()))
        self.refresh()
        self.ws.publish({"type": "map_config", "revision": self.db.map_revision()})

    def save_internal(self, body: dict) -> dict:
        """Validated save without the Edit Map passphrase session (callers
        authorize through the administration RBAC layer)."""
        try:
            expected = int(body.get("revision"))
        except (TypeError, ValueError):
            raise MapValidationError("revision is required")
        units, cameras, nvrs = self._normalize(body)
        rels = self._relationships(units, cameras)
        rev = self.db.save_map(expected, units, cameras, rels, nvrs)
        logger.info("Tactical map saved: revision %d (%d units, %d NVRs, %d cameras, %d relationships)",
                    rev, len(units), len(nvrs), len(cameras), len(rels))
        self.refresh()
        self.ws.publish({"type": "map_config", "revision": rev})
        return self.config_view()

    # ── offline tiles ────────────────────────────────────────────────

    def tile_path(self, z: int, x: int, y: int, dem: bool = False):
        root = self.dem_dir if dem else self.tiles_dir
        if root is None:
            return None
        for ext in (("png",) if dem else ("png", "jpg", "jpeg", "webp")):
            p = root / str(z) / str(x) / f"{y}.{ext}"
            if p.is_file():
                return p
        return None


def load_map_config(project_root) -> dict:
    import yaml
    path = project_root / "backend" / "configs" / "map.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def generate_seed_layout(seed: dict, cameras: List[dict], dem=None) -> dict:
    """Synthetic battalion layout from map.yaml's seed: companies at their
    configured offsets, 8–10 posts each scattered around them (deterministic
    RNG, minimum spacing, inside the AOR; on the highest candidate when a DEM
    is available) and N cameras per post (aimed downhill with a DEM, else away
    from the company). Cameras bound to live video are spread across
    companies; the rest are registered without a video source."""
    rng = random.Random(seed.get("rng_seed", 1))
    origin = (seed["origin"]["lat"], seed["origin"]["lon"])
    at = lambda x, y: offset_to_latlon(origin, x, y)  # noqa: E731
    pc, cc = seed.get("posts") or {}, seed.get("cameras") or {}
    boundary = Polygon(seed["boundary_m"])
    inner = boundary.buffer(-float(pc.get("boundary_margin_m", 400)))

    def elev(x, y):
        return dem.elevation(*at(x, y)) if dem is not None else None

    def downhill(x, y, d=150.0):
        e = [elev(x + d, y), elev(x - d, y), elev(x, y + d), elev(x, y - d)]
        if any(v is None for v in e):
            return None
        gx, gy = (e[0] - e[1]) / (2 * d), (e[2] - e[3]) / (2 * d)
        return None if math.hypot(gx, gy) < 0.02 else math.degrees(math.atan2(-gx, -gy)) % 360

    bn = seed["battalion"]
    bx, by = bn.get("at", [0, 0])
    units = [{"unit_id": bn["id"], "unit_type": "battalion", "parent_id": None, "name": bn["name"],
              "latitude": at(bx, by)[0], "longitude": at(bx, by)[1],
              "boundary": [list(at(x, y)) for x, y in seed["boundary_m"]], "sort_order": 0}]
    nvrs, placements, register = [], [], []
    num = lambda cid: int(cid.split("-")[-1])  # noqa: E731
    live = sorted((c["camera_id"] for c in cameras if c["source_id"]), key=num)
    # Video-less cameras registered by an earlier seed are reused before new ids are minted
    spare = sorted((c["camera_id"] for c in cameras if not c["source_id"]), key=num)
    next_num = max([num(c["camera_id"]) for c in cameras] + [0]) + 1
    per_company_live = int(cc.get("live_per_company", 4))
    per_post = int(cc.get("per_post", 2))
    fov_lo, fov_hi = cc.get("fov", [55, 85])
    rng_lo, rng_hi = cc.get("range", [400, 800])
    off_lo, off_hi = cc.get("second_camera_offset", [100, 160])
    standoff = float(cc.get("standoff_m", 15))
    spacing, n_cand = float(pc.get("spacing_m", 700)), int(pc.get("candidates", 6))
    nvr_cfg = seed.get("nvr") or {}
    posts_xy: List[Tuple[float, float]] = []

    for ci, co in enumerate(seed["companies"]):
        cx, cy = co["at"]
        lat, lon = at(cx, cy)
        units.append({"unit_id": co["id"], "unit_type": "company", "parent_id": bn["id"], "name": co["name"],
                      "latitude": lat, "longitude": lon, "boundary": None, "sort_order": ci})
        nb = math.radians(float(nvr_cfg.get("bearing", 135)))
        nd = float(nvr_cfg.get("offset_m", 220))
        nlat, nlon = at(cx + nd * math.sin(nb), cy + nd * math.cos(nb))
        nvrs.append({"nvr_id": f"NVR-{ci + 1:02d}", "company_id": co["id"], "name": f"NVR {ci + 1:02d}",
                     "latitude": nlat, "longitude": nlon})
        live_left = live[ci * per_company_live:(ci + 1) * per_company_live]
        for pi in range(int(co["posts"])):
            cands: List[Tuple[float, float]] = []
            gap = spacing
            for attempt in range(4000):
                r = rng.uniform(float(pc.get("min_m", 700)), float(pc.get("max_m", 3000)))
                a = rng.uniform(0, 2 * math.pi)
                x, y = cx + r * math.sin(a), cy + r * math.cos(a)
                if attempt and attempt % 800 == 0:
                    gap *= 0.85                       # crowded: relax spacing gradually
                if inner.contains(Point(x, y)) and all(math.hypot(x - px, y - py) >= gap for px, py in posts_xy):
                    cands.append((x, y))
                    if len(cands) >= n_cand:
                        break
            if not cands:
                raise MapValidationError(f"Could not place post {pi + 1} of {co['id']} — widen posts.max_m")
            scored = [(elev(x, y), (x, y)) for x, y in cands]
            px, py = max(scored, key=lambda t: t[0])[1] if all(e is not None for e, _ in scored) else cands[0]
            posts_xy.append((px, py))
            post_id = f"P-{ci + 1:02d}-{pi + 1:02d}"
            plat, plon = at(px, py)
            units.append({"unit_id": post_id, "unit_type": "post", "parent_id": co["id"], "name": f"POST {pi + 1:02d}",
                          "latitude": plat, "longitude": plon, "boundary": None, "sort_order": pi})
            away = math.degrees(math.atan2(px - cx, py - cy)) % 360
            base = downhill(px, py)
            base = (away if base is None else base) + rng.uniform(-20, 20)
            bearings = [base]
            while len(bearings) < per_post:
                bearings.append(bearings[-1] + rng.choice((-1, 1)) * rng.uniform(off_lo, off_hi))
            for k, brg in enumerate(bearings):
                brg %= 360
                name = f"{co['name'].replace('COMPANY', 'COY')} / POST {pi + 1:02d} / CAM {chr(65 + k)}"
                if live_left:
                    cid = live_left.pop(0)
                else:
                    if spare:
                        cid = spare.pop(0)
                    else:
                        cid = f"CAM-{next_num:02d}"
                        next_num += 1
                    register.append({"camera_id": cid, "name": name})
                b = math.radians(brg)
                clat, clon = at(px + standoff * math.sin(b), py + standoff * math.cos(b))
                placements.append({"camera_id": cid, "post_id": post_id, "latitude": clat, "longitude": clon,
                                   "bearing": round(brg, 1), "fov_angle": float(round(rng.uniform(fov_lo, fov_hi))),
                                   "range_m": float(round(rng.uniform(rng_lo, rng_hi), -1))})
    return {"units": units, "nvrs": nvrs, "cameras": placements, "register": register}


def build_map_service(db, project_root, ws, runtime=None, frame_store=None) -> MapService:
    cfg = load_map_config(project_root)
    seed = cfg.get("seed")
    if seed and db.map_seed_version() < int(seed.get("version", 1)):
        _reseed(db, seed, project_root)
    return MapService(db, cfg, ws, runtime=runtime, frame_store=frame_store, project_root=project_root)


def _reseed(db, seed: dict, project_root) -> None:
    from src.terrain import DemSampler

    if db.map_units():
        backup = project_root / "backend" / "data" / f"map_backup_{int(time.time())}.json"
        backup.write_text(json.dumps({"revision": db.map_revision(), "units": db.map_units(),
                                      "nvrs": db.map_nvrs(), "cameras": db.map_cameras()}, indent=1))
        logger.warning("Map seed v%s replaces the current layout — previous layout backed up to %s",
                       seed.get("version"), backup)
    dem = None
    dcfg = seed.get("dem") or {}
    if dcfg:
        dem = DemSampler(dcfg.get("url"), int(dcfg.get("zoom", 13)),
                         project_root / dcfg["local_dir"] if dcfg.get("local_dir") else None)
        # Probe once so an offline machine falls back quickly
        if dem.elevation(seed["origin"]["lat"], seed["origin"]["lon"]) is None:
            logger.warning("No elevation data for seeding — posts placed without terrain awareness")
            dem = None
    layout = generate_seed_layout(seed, db.cameras(), dem)
    rev = db.apply_map_seed(layout, int(seed.get("version", 1)))
    n = {k: sum(u["unit_type"] == k for u in layout["units"]) for k in ("company", "post")}
    logger.info("Seeded tactical map v%s (revision %d): %d companies, %d posts, %d cameras (%d without a video "
                "source), %d NVRs — synthetic positions%s", seed.get("version"), rev, n["company"],
                n["post"], len(layout["cameras"]), len(layout["register"]), len(layout["nvrs"]),
                ", terrain-aware" if dem else "")
