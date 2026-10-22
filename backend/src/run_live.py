"""
Live command-center runtime.

Architecture:
  Camera ─▶ Camera Pipeline Manager ─▶ selected Detection Pipeline ─▶ tracker /
  analytics ─▶ normalized event ─▶ event bus (worker → main queue) ─▶ database +
  event/alert stores ─▶ REST / WebSocket / MJPEG ─▶ command center

  * Video SOURCES are live NVR channels: each channel is pulled ONCE by the
    media server (MediaMTX), which serves the AI ingest and browsers (WebRTC).
    A source is decoded on NVDEC only while a camera bound to it has an active
    detection pipeline or an MJPEG / zone-editor viewer (on demand — see
    pipelines/manager.py). There are no recorded / mock feeds: cameras
    without an NVR channel have no video.
  * Sources and their cameras are balanced across a few inference worker
    PROCESSES (own GIL + GPU sessions). Each worker runs a PipelineManager that
    keeps exactly one detection pipeline per camera and switches it at runtime
    on control messages — no restart, other cameras unaffected.
  * The main process owns the database (source of truth for each camera's
    mode), the API, the WebSocket and the event/alert stores.
"""

import logging
import multiprocessing as mp
import os
import signal
import sys
import threading
import time
from pathlib import Path
from queue import Empty
from typing import Dict, List

import cv2
import yaml

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from src.procutil import die_with_parent, sigterm_as_keyboard_interrupt, is_parent_alive
from src.sources import create_source
from src.output.server import FrameStore, EventStore, AlertStore, run_server

# ── Logging setup ──────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("pipeline")

# Parallelism comes from per-camera threads; letting OpenCV also fan every
# resize/cvtColor out across all cores oversubscribes the CPU.
cv2.setNumThreads(2)


def load_config(project_root: Path):
    """Load streams.yaml and pipeline.yaml."""
    cfg_dir = project_root / "backend" / "configs"
    with open(cfg_dir / "streams.yaml", "r", encoding="utf-8") as f:
        streams_cfg = yaml.safe_load(f)
    with open(cfg_dir / "pipeline.yaml", "r", encoding="utf-8") as f:
        pipeline_cfg = yaml.safe_load(f)
    return streams_cfg, pipeline_cfg


def pipelines_config(pipeline_cfg: dict) -> dict:
    """Settings handed to every detection pipeline."""
    cfg = dict(pipeline_cfg.get("pipelines") or {})
    cfg.setdefault("detect_interval", int(pipeline_cfg.get("detect_interval", 2)))
    return cfg


INGEST_TO_MANAGER = ("idle_stop_after_s", "mjpeg_max_width", "mjpeg_fps", "mjpeg_quality")


def run_worker(worker_idx: int, sources: List[dict], cameras: List[dict], out_q, ctrl_q, stop_evt,
               pipe_cfg: dict):
    """
    Inference worker process: decodes its sources and runs one detection
    pipeline per camera through a PipelineManager. Frames, normalized events,
    pipeline states and health go to the main process via ``out_q``; mode
    switches / geometry edits / restarts arrive on ``ctrl_q``.
    """
    import queue as queue_mod
    from src.pipelines.manager import PipelineManager

    # Never outlive the main process (an orphan would keep the GPU busy).
    parent_pid = os.getppid()
    die_with_parent(signal.SIGTERM)
    sigterm_as_keyboard_interrupt()

    def emit(kind: str, *payload) -> None:
        item = (kind, *payload)
        try:
            if kind == "frame":
                out_q.put_nowait(item)       # the next frame supersedes a dropped one
            else:
                out_q.put(item, timeout=2.0)  # events/states: bounded wait, never hang
        except queue_mod.Full:
            if kind != "frame":
                logger.warning("Result queue full — dropped %s", kind)

    manager = PipelineManager(emit, pipe_cfg, source_factory=create_source)
    for cam in cameras:
        manager.add_camera(cam["camera_id"], cam["key"], cam["source_id"], cam["geometry"])
    for src in sources:
        manager.add_source(src)
    logger.info("Worker %d: %d sources (decoded on demand), %d cameras (%s)", worker_idx, len(sources), len(cameras),
                ", ".join(c["camera_id"] for c in cameras))

    # Initial pipelines from the database's persisted modes (a camera's source
    # starts decoding when its pipeline does; cameras with mode none stay idle)
    for cam in cameras:
        manager.switch_mode(cam["key"], cam["mode"])
    manager.start_source_supervisor()
    # Started on the active admin configuration version
    if pipe_cfg.get("_config_version") is not None:
        emit("config_ack", worker_idx, pipe_cfg["_config_version"], [])

    def control_loop():
        while not stop_evt.is_set():
            try:
                kind, key, value = ctrl_q.get(timeout=0.5)
            except queue_mod.Empty:
                continue
            try:
                if kind == "mode":
                    manager.switch_mode(key, value["mode"], request_id=value.get("request_id"))
                elif kind == "geometry":
                    manager.update_geometry(key, value)
                elif kind == "restart":
                    manager.restart(key)
                elif kind == "viewers":
                    manager.set_viewers(key, value)
                elif kind == "config":
                    restarted = manager.update_config(value["detection"], set(value.get("restart_modes") or ()))
                    manager.config["_config_version"] = value["version"]
                    emit("config_ack", worker_idx, value["version"], restarted)
            except Exception:
                logger.exception("Control message %s for %s failed", kind, key)

    def health_loop():
        while not stop_evt.is_set():
            time.sleep(2.0)
            emit("health", worker_idx, manager.health())

    threading.Thread(target=control_loop, daemon=True, name=f"ctrl-{worker_idx}").start()
    threading.Thread(target=health_loop, daemon=True, name=f"health-{worker_idx}").start()

    try:
        while not stop_evt.is_set() and is_parent_alive(parent_pid):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        stop_evt.set()
        manager.stop_all()          # stops every decoder and releases every pipeline's models
        # Don't wait at exit to flush queued results into a pipe that the
        # (possibly dead) main process will never read — that hangs forever.
        out_q.cancel_join_thread()
        logger.info("Worker %d stopped", worker_idx)


def _live_sources(ingest: dict, nvrs: dict, cameras: List[dict]):
    """Media server + one live source spec per NVR channel bound to a camera."""
    from src.sources.media_server import MediaServer, path_name
    bindings, specs = [], {}
    for c in cameras:
        nvr = nvrs.get(c.get("nvr_id") or "")
        if nvr is None or not c.get("channel"):
            continue
        if not nvr.configured:
            logger.warning("%s: NVR %s is not configured (host/credentials missing) — no video", c["camera_id"], nvr.nvr_id)
            continue
        if nvr.channels and not 1 <= int(c["channel"]) <= nvr.channels:
            logger.warning("%s: channel %s outside %s's %d channels — not bound", c["camera_id"], c["channel"],
                           nvr.nvr_id, nvr.channels)
            continue
        bindings.append({"camera_id": c["camera_id"], "nvr_id": nvr.nvr_id, "channel": int(c["channel"]),
                         "subtype": 1 if c.get("subtype") is None else int(c["subtype"])})
    media_cfg = dict(ingest.get("_media_server") or {})
    if media_cfg.get("binary") and not os.path.isabs(media_cfg["binary"]):
        media_cfg["binary"] = str(PROJECT_ROOT / media_cfg["binary"])
    media = MediaServer(media_cfg, nvrs, bindings)
    for b in bindings:
        variant = "" if b["subtype"] == 1 else "main"
        path = path_name(b["nvr_id"], b["channel"], variant)
        specs[path] = {
            "id": path, "type": "rtsp", "path": path, "url": media.rtsp_url(path), "api_url": media.api_url(),
            "nvr_id": b["nvr_id"], "channel": b["channel"], "subtype": b["subtype"],
            "label": f"{b['nvr_id']} CH{b['channel']:02d}", "process_fps": float(ingest.get("process_fps", 12.5)),
            **{k: ingest[k] for k in ("max_width", "stall_timeout_s", "degraded_after_s", "degraded_fps_ratio",
                                      "max_backoff_s") if k in ingest},
        }
    return media, specs, {b["camera_id"]: path_name(b["nvr_id"], b["channel"], "" if b["subtype"] == 1 else "main")
                          for b in bindings}


def _await_live_resolution(media, specs: Dict[str, dict], timeout: float = 12.0) -> None:
    """Native resolution of each live source (zone coordinates are in these
    pixels); sources not up yet keep a 1280x720 default and are corrected by
    their first health report."""
    deadline = time.monotonic() + timeout
    pending = set(specs)
    while pending and time.monotonic() < deadline:
        for path in list(pending):
            st = media.path_status(path)
            if st.get("ready") and st.get("width"):
                specs[path].update(width=int(st["width"]), height=int(st["height"]), codec=st.get("codec"))
                pending.discard(path)
            elif st.get("permanent_error"):
                pending.discard(path)
        time.sleep(0.5)
    for path, spec in specs.items():
        spec.setdefault("width", 1280)
        spec.setdefault("height", 720)
        spec["native_fps"] = 25.0
        st = media.path_status(path)
        logger.info("Live source %s (%s): %s", path, spec["label"],
                    f"{spec['width']}x{spec['height']} {spec.get('codec')}" if st.get("ready")
                    else f"not up yet ({st.get('permanent_error') or st.get('source_error') or 'connecting'})")


def _source_cost(scfg: dict, n_active_cameras: int) -> float:
    """Rough load of a source and the cameras running detection on it."""
    w, h, fps = scfg["width"], scfg["height"], scfg["native_fps"]
    scale = min(1.0, 1920 / w)
    decode = (w * scale) * (h * scale) * min(fps, 15)
    return (decode + 4e6 * max(1, n_active_cameras)) * float(scfg.get("cost_weight", 1.0))


def main():
    sigterm_as_keyboard_interrupt()
    logger.info("=" * 60)
    logger.info("  AI SURVEILLANCE PIPELINE — runtime detection modes")
    logger.info("=" * 60)

    from src.db import Database
    from src.runtime import CameraControlService, camera_key
    from src.sources.nvr import load_env_file, load_nvrs, validate_camera_bindings

    # NVR credentials: environment only (project-root .env; values never logged)
    n_env = load_env_file(PROJECT_ROOT / ".env")
    if n_env:
        logger.info("Loaded %d variable(s) from .env", n_env)
    streams_cfg, pipeline_cfg = load_config(PROJECT_ROOT)
    ingest = dict(streams_cfg.get("ingest") or {})
    ingest["_media_server"] = streams_cfg.get("media_server") or {}

    # ── Database: camera registry + persisted modes (source of truth) ──
    nvrs = load_nvrs(streams_cfg)
    cameras_yaml = PROJECT_ROOT / "backend" / "configs" / "cameras.yaml"
    validate_camera_bindings(yaml.safe_load(cameras_yaml.read_text())["cameras"], nvrs)
    db = Database()
    db.seed(cameras_yaml, pipeline_cfg)
    all_cameras = db.cameras()

    # ── Sources: live NVR channels only (one media-server path per channel) ──
    media, sources, live_of = _live_sources(ingest, nvrs, all_cameras)
    if sources:
        media.start()
        _await_live_resolution(media, sources)

    cameras, types = [], {}
    for c in all_cameras:
        sid = live_of.get(c["camera_id"])
        types[c["camera_id"]] = "rtsp" if sid else "none"
        if sid:
            cameras.append({**c, "source_id": sid, "source_type": "rtsp"})
    db.set_source_types(types)
    logger.info("Database %s: %d live cameras on %d NVR channels (%d cameras without a channel: no video)",
                db.path, len(cameras), len(sources), len(all_cameras) - len(cameras))
    if not cameras:
        logger.error("No camera is bound to a reachable NVR channel — nothing to ingest")

    # ── Partition sources (with all their cameras) across workers ──
    by_source: Dict[str, list] = {}
    for c in cameras:
        by_source.setdefault(c["source_id"], []).append(c)
    n_workers = max(1, min(int(pipeline_cfg.get("workers", 3)), len(by_source)))
    buckets: List[list] = [[] for _ in range(n_workers)]
    loads = [0.0] * n_workers
    costs = {sid: _source_cost(sources[sid], sum(1 for c in cams if c["detection_mode"] != "none"))
             for sid, cams in by_source.items()}
    for sid in sorted(by_source, key=costs.get, reverse=True):
        i = loads.index(min(loads))
        buckets[i].append(sid)
        loads[i] += costs[sid]
    owner = {camera_key(c["camera_id"]): i for i, b in enumerate(buckets) for sid in b for c in by_source[sid]}

    # ── Output stores (main process) ──
    frame_store = FrameStore()
    event_store = EventStore(max_events=1000)
    alert_store = AlertStore(max_alerts=500)

    outputs_dir = PROJECT_ROOT / "backend" / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    events_path = outputs_dir / "events.jsonl"
    events_file = open(events_path, "a", encoding="utf-8")
    logger.info("Event log: %s", events_path)

    ctx = mp.get_context("spawn")  # CUDA can't be used from forked children
    out_q = ctx.Queue(maxsize=512)
    stop_evt = ctx.Event()
    ctrl_qs = [ctx.Queue() for _ in range(n_workers)]

    runtime = CameraControlService(db, cameras, owner, ctrl_qs, alert_store, event_store, events_file, sources)
    runtime.media = media
    runtime.ingest = ingest
    from src.evidence import EvidenceStore
    evidence_cfg = pipeline_cfg.get("evidence") or {}
    runtime.evidence = EvidenceStore(outputs_dir / "evidence", max_files=evidence_cfg.get("max_files", 5000))

    # ── Tactical GIS map: hierarchy + status roll-up over the same WebSocket ──
    from src.gis import build_map_service
    map_service = build_map_service(db, PROJECT_ROOT, runtime.ws, runtime=runtime, frame_store=frame_store)
    runtime.map = map_service
    map_service.start()

    # ── Administration: RBAC, audit, versioned configuration (admin.db) ──
    from src.admin.service import AdminService
    admin = AdminService(db, runtime, map_service, pipeline_cfg, PROJECT_ROOT)
    runtime.admin = admin
    admin.start()

    # ── Situation record: alerts → incidents, device-health history (SQLite) ──
    from src.situation import SituationService
    situation = SituationService(db, runtime=runtime, map_service=map_service, admin=admin,
                                 cfg=pipeline_cfg.get("situation"), events_log=events_path)
    runtime.situation = situation
    situation.start()

    # ── Argus Agent: local LLM (Ollama) answering from the situation tools ──
    from src.agent.service import AgentService
    runtime.agent = AgentService(db, situation, admin=admin, cfg=pipeline_cfg.get("agent"))
    runtime.agent.release_gpu()          # detection pipelines get the GPU first

    # ── Start output server ──
    server_cfg = pipeline_cfg["server"]
    run_server(frame_store, event_store, alert_store, runtime, host=server_cfg["host"], port=server_cfg["port"],
               map_service=map_service)

    pipe_cfg = pipelines_config(pipeline_cfg)
    pipe_cfg.update({k: ingest[k] for k in INGEST_TO_MANAGER if k in ingest})
    # Detection thresholds come from the active configuration version
    pipe_cfg.update(admin.cfg["detection"])
    pipe_cfg["_config_version"] = admin.active()["version"]
    procs = []
    for i, bucket in enumerate(buckets):
        w_sources = [sources[sid] for sid in bucket]
        w_cameras = [{
            "camera_id": c["camera_id"], "key": camera_key(c["camera_id"]), "source_id": c["source_id"],
            "mode": c["detection_mode"], "geometry": db.geometry(c["camera_id"]),
        } for sid in bucket for c in by_source[sid]]
        p = ctx.Process(target=run_worker, args=(i, w_sources, w_cameras, out_q, ctrl_qs[i], stop_evt, pipe_cfg),
                        name=f"ai-worker-{i}", daemon=True)
        p.start()
        procs.append(p)
        runtime.worker_pids[i] = p.pid
    logger.info("Started %d inference worker processes for %d cameras / %d sources",
                n_workers, len(cameras), len(sources))

    # ── Collect results from workers ──
    def collector():
        last_flush = time.monotonic()
        while not stop_evt.is_set():
            try:
                msg = out_q.get(timeout=0.25)
            except Empty:
                msg = None
            try:
                if msg is not None:
                    kind = msg[0]
                    if kind == "frame":
                        frame_store.put(msg[1], msg[2])
                    elif kind == "event":
                        runtime.on_event(msg[1])
                    elif kind == "state":
                        runtime.on_state(msg[1])
                    elif kind == "health":
                        runtime.on_health(msg[1], msg[2])
                    elif kind == "config_ack":
                        if runtime.admin is not None:
                            runtime.admin.on_config_ack(msg[1], msg[2], msg[3])
                if time.monotonic() - last_flush > 0.5:
                    runtime.flush()
                    last_flush = time.monotonic()
            except Exception:
                logger.exception("Collector failed on %s", msg[0] if msg else "flush")

    threading.Thread(target=collector, daemon=True, name="collector").start()

    try:
        while procs:
            time.sleep(2.0)
            for p in list(procs):
                if not p.is_alive():
                    logger.error("Worker process %s died (exit code %s)", p.name, p.exitcode)
                    procs.remove(p)
    except KeyboardInterrupt:
        logger.info("Shutting down…")
    finally:
        stop_evt.set()
        for p in procs:
            p.join(timeout=8.0)
            if p.is_alive():
                p.terminate()
        runtime.flush()
        events_file.close()
        if media is not None:
            media.stop()
        logger.info("Pipeline stopped.")


if __name__ == "__main__":
    main()
