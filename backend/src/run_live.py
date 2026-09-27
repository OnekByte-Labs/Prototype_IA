"""
Main pipeline — spins up all components and orchestrates the AI surveillance pipeline.

Architecture:
  1. Video readers (one thread per stream) push frames into per-stream queues.
  2. A main inference loop pulls frames round-robin, runs detection → tracking → ANPR cascade.
  3. Annotated frames are pushed to the FrameStore for the MJPEG output server.
  4. Events are logged to JSONL and pushed to the EventStore for the REST API.
"""

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from queue import Queue, Empty
from typing import Dict, List, Optional

import cv2
import numpy as np
import yaml

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from src.ingestion.video_reader import VideoReader, FramePacket
from src.inference.detector import YOLODetector
from src.inference.plate_detector import PlateDetector
from src.inference.ocr import PlateOCR
from src.tracking.tracker import ByteTracker
from src.annotator import draw_detections
from src.output.server import FrameStore, EventStore, AIConfigStore, run_server

# ── Logging setup ──────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("pipeline")


def load_config(project_root: Path):
    """Load streams.yaml, classes.yaml, and pipeline.yaml."""
    proto_root = project_root / "backend"

    with open(proto_root / "configs" / "streams.yaml", "r", encoding="utf-8") as f:
        streams_cfg = yaml.safe_load(f)

    with open(proto_root / "configs" / "classes.yaml", "r", encoding="utf-8") as f:
        classes_cfg = yaml.safe_load(f)

    with open(proto_root / "configs" / "pipeline.yaml", "r", encoding="utf-8") as f:
        pipeline_cfg = yaml.safe_load(f)

    return streams_cfg, classes_cfg, pipeline_cfg


def main():
    logger.info("=" * 60)
    logger.info("  AI SURVEILLANCE PIPELINE — Phase 1 Backend")
    logger.info("=" * 60)

    # ── Load config ──
    streams_cfg, classes_cfg, pipeline_cfg = load_config(PROJECT_ROOT)
    class_names: Dict[int, str] = {int(k): v for k, v in classes_cfg.get("names", classes_cfg.get("classes", {})).items()}
    vehicle_class_ids = set(classes_cfg.get("vehicle_classes", []))
    animal_class_ids = set(classes_cfg.get("animal_classes", []))
    allowed_class_ids = set(class_names.keys())
    stream_list = streams_cfg["streams"]

    logger.info("Loaded %d streams, %d classes, %d vehicle classes",
                len(stream_list), len(class_names), len(vehicle_class_ids))

    # ── Initialize models ──
    models_cfg = pipeline_cfg["models"]
    
    logger.info("Loading primary detector (%s)…", models_cfg["primary_detector"]["path"])
    detector = YOLODetector(
        model_path=str(PROJECT_ROOT / models_cfg["primary_detector"]["path"]),
        conf_threshold=models_cfg["primary_detector"]["conf_threshold"],
        iou_threshold=models_cfg["primary_detector"]["iou_threshold"],
    )

    logger.info("Loading plate detector (%s)…", models_cfg["plate_detector"]["path"])
    plate_detector = PlateDetector(
        model_path=str(PROJECT_ROOT / models_cfg["plate_detector"]["path"]),
        conf_threshold=models_cfg["plate_detector"]["conf_threshold"],
        iou_threshold=models_cfg["plate_detector"]["iou_threshold"],
    )

    logger.info("Loading plate OCR (%s)…", models_cfg["ocr"]["model_path"])
    ocr = PlateOCR(
        model_path=str(PROJECT_ROOT / models_cfg["ocr"]["model_path"]),
        config_path=str(PROJECT_ROOT / models_cfg["ocr"]["config_path"]),
    )

    # ── Initialize output stores ──
    frame_store = FrameStore()
    event_store = EventStore(max_events=1000)
    ai_config = AIConfigStore(stream_list)

    # ── JSONL event log ──
    outputs_dir = PROJECT_ROOT / "backend" / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    events_path = outputs_dir / "events.jsonl"
    events_file = open(events_path, "a", encoding="utf-8")
    logger.info("Event log: %s", events_path)

    def log_event(event: dict):
        event_store.add(event)
        events_file.write(json.dumps(event) + "\n")
        events_file.flush()

    # ── Start output server ──
    server_cfg = pipeline_cfg["server"]
    run_server(frame_store, event_store, ai_config, stream_list, host=server_cfg["host"], port=server_cfg["port"], mode="live")

    # ── Initialize Analytics ──
    from src.analytics import create_analytics
    analytics_engines = {}
    if "analytics" in pipeline_cfg:
        for sid, cfg in pipeline_cfg["analytics"].items():
            engine = create_analytics(sid, cfg)
            if engine:
                analytics_engines[sid] = engine
                logger.info("Initialized analytics %s for stream %s", cfg.get("type"), sid)


    # ── Initialize per-stream readers and trackers ──
    queues: Dict[str, Queue] = {}
    readers: List[VideoReader] = []
    trackers: Dict[str, ByteTracker] = {}

    for scfg in stream_list:
        sid = scfg["id"]
        video_path = str(PROJECT_ROOT / scfg["video_path"])

        if not os.path.exists(video_path):
            logger.warning("⚠ Video not found: %s — skipping stream %s", video_path, sid)
            continue

        q: Queue = Queue(maxsize=8)
        queues[sid] = q
        trackers[sid] = ByteTracker(stream_id=sid)

        reader = VideoReader(stream_id=sid, video_path=video_path, frame_queue=q, target_fps=15.0)
        readers.append(reader)
        logger.info("Configured stream %s → %s", sid, video_path)

    # Start all readers
    for r in readers:
        r.start()
    logger.info("Started %d video reader threads", len(readers))

    # ── Main inference loop ──
    logger.info("Entering main inference loop (Ctrl+C to stop)…")
    active_streams = list(queues.keys())
    fps_counters: Dict[str, List[float]] = {sid: [] for sid in active_streams}
    recent_events_map: Dict[str, List[dict]] = {}

    try:
        while True:
            processed_any = False
            for sid in active_streams:
                q = queues[sid]

                try:
                    packet: FramePacket = q.get_nowait()
                except Empty:
                    continue

                processed_any = True

                t0 = time.monotonic()

                # Handle loop reset
                if packet.loop_reset:
                    trackers[sid].reset_on_loop()
                    if sid in analytics_engines:
                        if hasattr(analytics_engines[sid], 'reset'):
                            analytics_engines[sid].reset()
                            
                    log_event({
                        "type": "loop_reset",
                        "stream_id": sid,
                        "frame_id": packet.frame_id,
                        "ts": datetime.now(timezone.utc).isoformat(),
                    })

                frame = packet.frame

                if ai_config.is_enabled(sid):
                    # ── 1. Primary detection ──
                    detections = detector.detect(frame)
                    filtered_detections = []
                    for d in detections:
                        if d.class_id in allowed_class_ids:
                            obj_class = str(class_names.get(d.class_id, "")).lower()
                            min_conf = 0.30 if obj_class == "animal" else 0.40
                            if d.confidence >= min_conf:
                                filtered_detections.append(d)
                    detections = filtered_detections

                    # ── 2. Tracking ──
                    det_tuples = [(d.bbox, d.confidence, d.class_id) for d in detections]
                    confirmed_tracks = trackers[sid].update(det_tuples)

                    # ── 3. ANPR cascade (vehicle tracks only) ──
                    plate_texts: Dict[int, str] = {}
                    plate_boxes_frame: Dict[int, tuple] = {}

                    for track in confirmed_tracks:
                        if track.class_id not in vehicle_class_ids:
                            continue

                        # Crop vehicle from frame
                        vx1, vy1, vx2, vy2 = track.bbox
                        vx1 = max(0, vx1)
                        vy1 = max(0, vy1)
                        vx2 = min(frame.shape[1], vx2)
                        vy2 = min(frame.shape[0], vy2)
                        vehicle_crop = frame[vy1:vy2, vx1:vx2]

                        if vehicle_crop.size == 0:
                            continue

                        # Detect plates in vehicle crop
                        plate_dets = plate_detector.detect(vehicle_crop)

                        if plate_dets:
                            # Take best plate detection
                            best_plate = max(plate_dets, key=lambda d: d.confidence)
                            px1, py1, px2, py2 = best_plate.bbox

                            # Crop plate from vehicle crop
                            px1c = max(0, px1)
                            py1c = max(0, py1)
                            px2c = min(vehicle_crop.shape[1], px2)
                            py2c = min(vehicle_crop.shape[0], py2)
                            plate_crop = vehicle_crop[py1c:py2c, px1c:px2c]

                            # Run OCR
                            text = ocr.recognize(plate_crop)

                            if text:
                                text_clean = str(text).replace(" ", "")
                                if len(text_clean) >= 6 and best_plate.confidence >= 0.30:
                                    plate_texts[track.track_id] = text
                                    # Convert plate bbox to frame coordinates
                                    plate_boxes_frame[track.track_id] = (
                                        vx1 + px1c, vy1 + py1c,
                                        vx1 + px2c, vy1 + py2c,
                                    )

                                    # Log plate event
                                    log_event({
                                        "type": "plate",
                                        "stream_id": sid,
                                        "frame_id": packet.frame_id,
                                        "object_id": track.track_id,
                                        "class": class_names.get(track.class_id, "unknown"),
                                        "plate_bbox": [vx1 + px1c, vy1 + py1c, vx1 + px2c, vy1 + py2c],
                                        "plate_text": text,
                                        "plate_confidence": best_plate.confidence,
                                        "ts": datetime.now(timezone.utc).isoformat(),
                                    })

                    # ── 3.5 Run Custom Analytics ──
                    active_events = []
                    if sid in analytics_engines:
                        engine = analytics_engines[sid]
                        analytics_events = engine.process_frame(frame, confirmed_tracks, packet.frame_id)
                        for ev in analytics_events:
                            ev["ts"] = datetime.now(timezone.utc).isoformat()
                            log_event(ev)
                            
                            # Add to TTL buffer
                            if sid not in recent_events_map:
                                recent_events_map[sid] = []
                            recent_events_map[sid].append({"event": ev, "ttl": 90})

                        # Update TTLs
                        next_recent = []
                        for item in recent_events_map.get(sid, []):
                            active_events.append(item["event"])
                            item["ttl"] -= 1
                            if item["ttl"] > 0:
                                next_recent.append(item)
                        recent_events_map[sid] = next_recent

                        # Persistent traffic count
                        if hasattr(engine, 'total_count'):
                            has_count = any(e.get("type") == "traffic_count" for e in active_events)
                            if not has_count:
                                active_events.append({
                                    "type": "traffic_count",
                                    "total_count": engine.total_count
                                })

                    # ── 4. Generate Metadata ──
                    detections_list = []
                    for track in confirmed_tracks:
                        det = {
                            "id": int(track.track_id),
                            "class": str(class_names.get(track.class_id, "unknown")),
                            "confidence": float(round(float(track.confidence), 3)),
                            "x": int(track.bbox[0]),
                            "y": int(track.bbox[1]),
                            "w": int(track.bbox[2] - track.bbox[0]),
                            "h": int(track.bbox[3] - track.bbox[1]),
                        }
                        if track.track_id in plate_texts:
                            det["plate"] = plate_texts[track.track_id]
                        detections_list.append(det)

                    metadata = {
                        "frame_id": packet.frame_id,
                        "video_time_sec": packet.video_time_sec,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "detections": detections_list,
                        "events": active_events,
                    }

                    # Log detection events (sample every 30 frames to avoid flood)
                    if packet.frame_id % 30 == 0:
                        for track in confirmed_tracks:
                            log_event({
                                "type": "detection",
                                "stream_id": sid,
                                "frame_id": packet.frame_id,
                                "object_id": track.track_id,
                                "class": class_names.get(track.class_id, "unknown"),
                                "bbox": list(track.bbox),
                                "confidence": round(track.confidence, 3),
                                "ts": datetime.now(timezone.utc).isoformat(),
                            })
                else:
                    # AI is disabled for this stream
                    metadata = {
                        "frame_id": packet.frame_id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "detections": [],
                    }

                # Encode raw frame to JPEG for MJPEG stream
                _, jpeg_buf = cv2.imencode(".jpg", frame)
                jpeg_bytes = jpeg_buf.tobytes()
                metadata["jpeg"] = jpeg_bytes

                # Push to output store
                frame_store.put(sid, metadata)

                # FPS tracking
                elapsed = time.monotonic() - t0
                fps_counters[sid].append(elapsed)
                if len(fps_counters[sid]) >= 100:
                    avg_ms = sum(fps_counters[sid]) / len(fps_counters[sid]) * 1000
                    avg_fps = 1000.0 / avg_ms if avg_ms > 0 else 0
                    logger.info("[%s] Avg inference: %.1f ms (%.1f fps)", sid, avg_ms, avg_fps)
                    fps_counters[sid] = []
                    
            if not processed_any:
                time.sleep(0.005)

    except KeyboardInterrupt:
        logger.info("Shutting down…")
    finally:
        for r in readers:
            r.stop()
        events_file.close()
        logger.info("Pipeline stopped.")


if __name__ == "__main__":
    main()
