"""
Device registry, NVR integrations / failure impact, network & system health.
All views are built from the operational database and live runtime state.
"""

import ipaddress
import re
import time
from collections import defaultdict
from typing import Optional

from src.pipelines import PIPELINE_CLASSES
from src.pipelines.base import DETECTION_MODES
from src.runtime import camera_key

from .auth import Principal
from .integrations import DEFAULT_PORTS, PROTOCOLS, onvif_probe, rtsp_probe, tcp_probe, ws_discovery
from .service import TARGET_FPS, AdminService, iso_ago

HOST_RE = re.compile(r"^[A-Za-z0-9.-]{1,253}$")


def _sources(svc: AdminService) -> dict:
    """Video sources actually ingested (streams.yaml, probed at start)."""
    out = {}
    for c in svc.runtime.cams.values():
        out[c["camera_id"]] = {"source_id": c["source_id"], "width": c["width"], "height": c["height"],
                               "protocol": "RTSP"}
    return out


def devices_view(svc: AdminService, p: Principal) -> dict:
    scope = svc.scoped_camera_ids(p)
    health = svc.health()
    hc, hn = health["cameras"], health["nvrs"]
    cams = {c["camera_id"]: c for c in svc._cams()}
    src = _sources(svc)
    streams = getattr(svc.runtime, "stream_paths", {})
    rows = []
    for d in svc.db.devices():
        cid = d["camera_id"]
        if scope is not None and cid not in scope:
            continue
        c, h = cams.get(cid, {}), hc.get(cid, {})
        s = src.get(cid)
        stream = None
        if s:
            stream = {"protocol": s["protocol"], "source": s["source_id"], "path": streams.get(s["source_id"]),
                      "resolution": f"{s['width']}×{s['height']}", "fps": h.get("fps"), "target_fps": TARGET_FPS}
        rows.append({
            "camera_id": cid, "name": d["name"], "company_id": c.get("company_id"), "company": c.get("company_name"),
            "post_id": c.get("post_id"), "post": c.get("post_name"),
            "latitude": d["latitude"], "longitude": d["longitude"],
            "ip": d["ip"], "model": d["model"], "firmware": d["firmware"],
            "stream_url": d["stream_url"], "stream_protocol": d["stream_protocol"], "nvr_channel": d["nvr_channel"],
            "stream": stream, "recording": h.get("recording"), "detection_mode": c.get("mode"),
            "pipeline_state": c.get("state"), "health": h.get("health"), "issue": h.get("issue"),
            "heartbeat_age_s": h.get("frame_age_s"), "updated_at": d["device_updated_at"],
            "updated_by": d["device_updated_by"],
        })
    integ = svc.db.nvr_integrations()
    nvrs = []
    for n in svc.db.map_nvrs():
        hh = hn.get(n["nvr_id"], {})
        i = integ.get(n["nvr_id"]) or {}
        members = [r for r in rows if r["company_id"] == n["company_id"]]
        nvrs.append({
            "nvr_id": n["nvr_id"], "name": n["name"], "company_id": n["company_id"],
            "latitude": n["latitude"], "longitude": n["longitude"],
            "channels_configured": i.get("channels"), "channels_assigned": hh.get("assigned", len(members)),
            "streams_bound": hh.get("bound"), "streams_ingesting": hh.get("streaming"),
            "recording": hh.get("capturing"), "health": hh.get("status"), "issue": hh.get("issue"),
            "affected": hh.get("affected", []), "storage": None,
            "integration": {"protocol": i.get("protocol", "none"), "host": i.get("host"), "port": i.get("port"),
                            "vendor": i.get("vendor"), "last_probe_ok": i.get("last_probe_ok"),
                            "last_probe_at": i.get("last_probe_at")},
        })
    return {"cameras": rows, "nvrs": nvrs, "checked_at": health.get("checked_at")}


def update_device(svc: AdminService, p: Principal, camera_id: str, body: dict) -> dict:
    svc.require_camera(p, "devices.manage", camera_id)
    clean = {}
    if "name" in body:
        n = str(body["name"]).strip()
        if not n or len(n) > 64:
            raise ValueError("name must be 1–64 characters")
        clean["name"] = n
    if "ip" in body:
        v = (body["ip"] or "").strip() or None
        if v:
            ipaddress.ip_address(v)                 # raises ValueError
        clean["ip"] = v
    for k, lim in (("model", 64), ("firmware", 32)):
        if k in body:
            v = (body[k] or "").strip() or None
            if v and len(v) > lim:
                raise ValueError(f"{k} must be at most {lim} characters")
            clean[k] = v
    if "stream_url" in body:
        v = (body["stream_url"] or "").strip() or None
        if v and not re.match(r"^(rtsp|rtsps|http|https)://", v):
            raise ValueError("stream URL must start with rtsp://, rtsps://, http:// or https://")
        clean["stream_url"] = v
        clean["stream_protocol"] = v.split("://")[0].upper() if v else None
    if "nvr_channel" in body:
        v = body["nvr_channel"]
        clean["nvr_channel"] = None if v in (None, "") else int(v)
        if clean["nvr_channel"] is not None and not 1 <= clean["nvr_channel"] <= 256:
            raise ValueError("NVR channel must be 1–256")
    if not clean:
        raise ValueError("Nothing to change")
    before = svc.db.update_device(camera_id, clean, p.username)
    svc.audit(p, "device.update", f"camera:{camera_id}", prev={k: before.get(k) for k in clean}, new=clean)
    svc.publish("devices", camera_id=camera_id)
    return clean


def nvr_impact(svc: AdminService, nvr_id: str) -> dict:
    """Everything that depends on an NVR: its cameras, their pipelines,
    models, recent alerts, users responsible for them, recording."""
    nvr = next((n for n in svc.db.map_nvrs() if n["nvr_id"] == nvr_id), None)
    if nvr is None:
        raise KeyError(nvr_id)
    health = svc.health()
    hn = health["nvrs"].get(nvr_id, {})
    cams = [c for c in svc._cams() if c["company_id"] == nvr["company_id"]]
    ids = [c["camera_id"] for c in cams]
    since = iso_ago(86400)
    with svc.db._lock:
        rows = svc.db._conn.execute(
            f"SELECT camera_id, event_type, COUNT(*) FROM events WHERE timestamp >= ? AND camera_id IN "
            f"({','.join('?' * len(ids))}) GROUP BY camera_id, event_type", (since, *ids)).fetchall() if ids else []
    ev = defaultdict(dict)
    for cid, et, n in rows:
        ev[cid][et] = n
    pipelines = defaultdict(list)
    models = set()
    for c in cams:
        if c["mode"] not in (None, "none") and c["source_bound"]:
            pipelines[c["mode"]].append(c["camera_id"])
            models.update(PIPELINE_CLASSES[c["mode"]].model_names)
    hc = health["cameras"]
    cam_rows = [{**c, "recording": hc.get(c["camera_id"], {}).get("recording"),
                 "events_24h": sum(ev[c["camera_id"]].values()),
                 "alerts_24h": sum(v for k, v in ev[c["camera_id"]].items() if k in ("PERIMETER_BREACH", "ANOMALY"))}
                for c in cams]
    posts = sorted({c["post_id"] for c in cams if c["post_id"]})
    users = svc._users_for_cameras(cams)
    integ = svc.db.nvr_integrations().get(nvr_id) or {}
    return {
        "nvr": nvr | {"health": hn.get("status"), "issue": hn.get("issue"), "integration": integ},
        "cameras": cam_rows,
        "services": {
            "pipelines": [{"mode": m, "label": DETECTION_MODES[m], "cameras": v} for m, v in sorted(pipelines.items())],
            "models": sorted(models),
            "recording_streams": sum(1 for c in cam_rows if c["recording"] == "EVENTS"),
            "alerting_cameras": [c["camera_id"] for c in cams if c["mode"] in ("intrusion", "anomaly")],
            "alerts_24h": sum(c["alerts_24h"] for c in cam_rows), "events_24h": sum(c["events_24h"] for c in cam_rows),
        },
        "posts": posts,
        "users": users,
        "summary": {"cameras": len(cams), "bound": sum(c["source_bound"] for c in cams),
                    "affected": hn.get("affected", []), "down": hn.get("status") != "ONLINE"},
    }


def update_integration(svc: AdminService, p: Principal, nvr_id: str, body: dict) -> dict:
    svc.require(p, "integrations.manage", global_scope=True, resource=f"nvr:{nvr_id}")
    if not any(n["nvr_id"] == nvr_id for n in svc.db.map_nvrs()):
        raise KeyError(nvr_id)
    proto = body.get("protocol", "none")
    if proto not in PROTOCOLS:
        raise ValueError(f"protocol must be one of {', '.join(PROTOCOLS)}")
    host = (body.get("host") or "").strip() or None
    if host and not HOST_RE.match(host):
        raise ValueError("host must be a hostname or IP address")
    port = body.get("port") or (DEFAULT_PORTS.get(proto) if host else None)
    if port is not None:
        port = int(port)
        if not 1 <= port <= 65535:
            raise ValueError("port must be 1–65535")
    ch = body.get("channels")
    ch = int(ch) if ch not in (None, "") else None
    if ch is not None and not 1 <= ch <= 256:
        raise ValueError("channels must be 1–256")
    fields = {"protocol": proto, "vendor": (body.get("vendor") or "").strip()[:40] or None, "host": host, "port": port,
              "username": (body.get("username") or "").strip()[:64] or None,
              "rtsp_path": (body.get("rtsp_path") or "").strip()[:200] or None, "channels": ch}
    before = svc.db.upsert_nvr_integration(nvr_id, fields, p.username)
    if "password" in body:                        # write-only; "" clears
        svc.secrets.set(f"nvr:{nvr_id}", body.get("password") or None)
    svc.audit(p, "integration.update", f"nvr:{nvr_id}",
              prev={k: (before or {}).get(k) for k in fields}, new=fields | ({"password": "(changed)"}
                                                                              if "password" in body else {}))
    svc.publish("integrations", nvr_id=nvr_id)
    return fields


def probe_integration(svc: AdminService, p: Principal, nvr_id: str) -> dict:
    svc.require(p, "integrations.manage", resource=f"nvr:{nvr_id}")
    i = svc.db.nvr_integrations().get(nvr_id)
    if not i or not i.get("host") or i.get("protocol") in (None, "none"):
        raise ValueError("Configure a protocol and host for this NVR first")
    t = svc.cfg["integrations"]["probe_timeout_s"]
    res = {"protocol": i["protocol"], "host": i["host"], "port": i["port"], "at": time.time(),
           "tcp": tcp_probe(i["host"], i["port"], t)}
    if res["tcp"]["ok"]:
        if i["protocol"] == "rtsp":
            res["rtsp"] = rtsp_probe(i["host"], i["port"], i.get("rtsp_path") or "", t)
        elif i["protocol"] == "onvif":
            res["onvif"] = onvif_probe(i["host"], i["port"], t)
        elif i["protocol"] == "vendor_sdk":
            res["sdk"] = {"ok": False, "error": f"no {i.get('vendor') or 'vendor'} SDK is installed on this server; "
                                                "only TCP reachability was checked"}
    app = res.get("rtsp") or res.get("onvif")
    res["ok"] = res["tcp"]["ok"] and (app is None or app["ok"])
    res["latency_ms"] = (app or res["tcp"]).get("latency_ms")
    svc.db.record_nvr_probe(nvr_id, res)
    svc.audit(p, "integration.probe", f"nvr:{nvr_id}", new={"ok": res["ok"]}, result="success" if res["ok"] else "failed",
              detail=(app or res["tcp"]).get("error"))
    svc.publish("integrations", nvr_id=nvr_id)
    return res


def sync_channels(svc: AdminService, p: Principal, nvr_id: str, apply: bool) -> dict:
    """Reconcile the NVR's channel map with the cameras its company owns:
    keep existing channel numbers, give unassigned cameras the free ones."""
    if apply:
        svc.require(p, "integrations.manage", global_scope=True, resource=f"nvr:{nvr_id}")
    nvr = next((n for n in svc.db.map_nvrs() if n["nvr_id"] == nvr_id), None)
    if nvr is None:
        raise KeyError(nvr_id)
    i = svc.db.nvr_integrations().get(nvr_id) or {}
    cap = i.get("channels")
    cams = [c for c in svc._cams() if c["company_id"] == nvr["company_id"]]
    dev = {d["camera_id"]: d for d in svc.db.devices()}
    used, keep, conflicts = {}, {}, []
    for c in cams:
        ch = dev[c["camera_id"]]["nvr_channel"]
        if ch is not None and (cap is None or ch <= cap) and ch not in used:
            used[ch] = c["camera_id"]
            keep[c["camera_id"]] = ch
        elif ch is not None:
            conflicts.append({"camera_id": c["camera_id"], "channel": ch,
                              "reason": "duplicate channel" if ch in used else f"channel > {cap}"})
    free = (x for x in range(1, (cap or len(cams)) + 1) if x not in used)
    assign, unplaced = {}, []
    for c in sorted(cams, key=lambda c: (not c["source_bound"], c["camera_id"])):
        if c["camera_id"] in keep:
            continue
        ch = next(free, None)
        if ch is None:
            unplaced.append(c["camera_id"])
        else:
            assign[c["camera_id"]] = ch
    res = {"nvr_id": nvr_id, "channels": cap, "cameras": len(cams), "kept": keep, "assigned": assign,
           "conflicts": conflicts, "unplaced": unplaced, "applied": False,
           "note": None if cap else "channel count not configured — numbered 1…N by camera count"}
    if apply:
        res["applied"] = True
        svc.db.record_nvr_sync(nvr_id, res, assign | {c["camera_id"]: None for c in conflicts})
        svc.audit(p, "integration.sync", f"nvr:{nvr_id}", new={"assigned": assign, "cleared":
                                                               [c["camera_id"] for c in conflicts]})
        svc.publish("integrations", nvr_id=nvr_id)
    return res


def discovery(svc: AdminService, p: Principal) -> dict:
    svc.require(p, "integrations.manage", resource="onvif-discovery")
    t = svc.cfg["integrations"]["discovery_timeout_s"]
    found = ws_discovery(t)
    svc.audit(p, "integration.discover", "onvif", new={"found": len([f for f in found if "ip" in f])})
    return {"timeout_s": t, "devices": found, "at": time.time()}


def integrations_view(svc: AdminService) -> dict:
    integ = svc.db.nvr_integrations()
    nh = svc.health()["nvrs"]
    out = []
    for n in svc.db.map_nvrs():
        i = integ.get(n["nvr_id"]) or {}
        out.append({"nvr_id": n["nvr_id"], "name": n["name"], "company_id": n["company_id"],
                    "protocol": i.get("protocol", "none"), "vendor": i.get("vendor"), "host": i.get("host"),
                    "port": i.get("port"), "username": i.get("username"), "rtsp_path": i.get("rtsp_path"),
                    "channels": i.get("channels"), "credential_set": svc.secrets.has(f"nvr:{n['nvr_id']}"),
                    "last_probe_at": i.get("last_probe_at"), "last_probe_ok": i.get("last_probe_ok"),
                    "last_probe_ms": i.get("last_probe_ms"), "last_probe": i.get("last_probe"),
                    "last_sync_at": i.get("last_sync_at"), "last_sync": i.get("last_sync"),
                    "ingest": nh.get(n["nvr_id"])})
    sources = [{"camera_id": c["camera_id"], "source_id": c["source_id"],
                "protocol": "RTSP",
                "path": getattr(svc.runtime, "stream_paths", {}).get(c["source_id"]),
                "resolution": f"{c['width']}×{c['height']}"} for c in svc.runtime.cams.values()]
    return {"nvrs": out, "protocols": list(PROTOCOLS), "sources": sources,
            "sdks_installed": [], "credentials": svc.secrets.status()}


def network_view(svc: AdminService) -> dict:
    health = svc.health()
    cams = {c["camera_id"]: c for c in svc._cams()}
    streams = []
    for cid, h in health["cameras"].items():
        if not h["source_bound"]:
            continue
        rc = svc.runtime.cams.get(camera_key(cid)) or {}
        st = rc.get("stream") or {}
        fps = h.get("fps") or 0.0
        target = st.get("target_fps") or TARGET_FPS
        decoding = bool(h.get("decoding"))
        streams.append({"camera_id": cid, "name": cams.get(cid, {}).get("name"), "company": cams.get(cid, {}).get("company_name"),
                        "protocol": "RTSP", "health": h.get("health"), "heartbeat_age_s": h.get("frame_age_s"),
                        "decoding": decoding, "fps": fps if decoding else None, "target_fps": target,
                        "frame_delivery_pct": round(min(100.0, fps / target * 100), 1) if decoding and fps else None,
                        "bitrate_kbps": st.get("bitrate_kbps"), "rtp_lost": st.get("rtp_lost"),
                        "viewers": st.get("viewers"), "stream_status": st.get("status"),
                        "recording": h.get("recording"), "issue": h.get("issue")})
    pids = getattr(svc.runtime, "worker_pids", {})
    host = svc.tele.host()
    infra = [
        {"component": "Inference workers", "status": "ONLINE" if pids and all(svc.tele.process_alive(x) for x in pids.values())
         else "DEGRADED", "detail": f"{sum(svc.tele.process_alive(x) for x in pids.values())}/{len(pids)} processes alive"},
        {"component": "WebSocket fan-out", "status": "ONLINE", "detail": f"{len(svc.runtime.ws.clients)} connected consoles"},
        {"component": "Event store (SQLite)", "status": "ONLINE", "detail": f"{svc.db.event_stats()['count']} events"},
        {"component": "Audit chain", **({"status": "ONLINE", "detail": "hash chain verified"}
                                         if svc.audit_status()["ok"] else
                                         {"status": "OFFLINE", "detail": "hash chain BROKEN"})},
    ]
    gpu = svc.tele.gpu()
    g = (gpu.get("gpus") or [None])[0]
    infra.append({"component": "GPU", "status": "ONLINE" if g else "OFFLINE",
                  "detail": f"{g['name']} · {g['util_pct']:.0f}% · {g['temp_c']:.0f}°C" if g else gpu.get("error")})
    return {"interfaces": svc.tele.network(), "streams": streams, "nvrs": health["nvrs"], "host": host,
            "infrastructure": infra, "checked_at": health.get("checked_at"),
            "notes": ["Every camera is an NVR channel pulled once by the media server (RTSP). Per-stream bitrate and "
                      "RTP packets lost come from the media server; fps and frame delivery are measured only while the "
                      "camera is decoded (active detection pipeline or MJPEG viewer — decoding is on demand).",
                      "Packet loss per interface is from kernel error/drop counters."]}
