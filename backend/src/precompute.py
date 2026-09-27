import os
import sys
import cv2
import json
import yaml
import time
from datetime import datetime, timezone
import logging

# Ensure backend directory is in sys.path so 'src' can be imported
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

from inference.detector import YOLODetector
from tracking.tracker import ByteTracker
from inference.plate_detector import PlateDetector
from inference.ocr import PlateOCR

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("precompute")

def load_yaml(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def run():
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    configs_dir = os.path.join(base_dir, "prototype", "configs") # User's actual path
    
    # Try prototype/configs first, fallback to backend/configs
    if not os.path.exists(configs_dir):
        configs_dir = os.path.join(base_dir, "backend", "configs")

    streams_cfg = load_yaml(os.path.join(configs_dir, "streams.yaml"))
    classes_cfg = load_yaml(os.path.join(configs_dir, "classes.yaml"))
    
    stream_configs = streams_cfg.get("streams", [])
    class_names = classes_cfg.get("names", {})
    allowed_class_ids = set(classes_cfg.get("allowed_classes", []))
    vehicle_class_ids = set(classes_cfg.get("vehicle_classes", []))

    # Initialize AI models
    logger.info("Loading AI Models...")
    detector = YOLODetector(os.path.join(base_dir, "models", "yolo11n.onnx"))
    plate_det = PlateDetector(os.path.join(base_dir, "models", "yolov8n_plate.onnx"))
    plate_ocr = PlateOCR(
        model_path=os.path.join(base_dir, "models", "cct-xs-v2-global-model.onnx"),
        config_path=os.path.join(base_dir, "models", "plate_config.yaml")
    )

    from src.analytics import create_analytics
    pipeline_cfg = load_yaml(os.path.join(configs_dir, "pipeline.yaml"))
    analytics_engines = {}
    if "analytics" in pipeline_cfg:
        for asid, acfg in pipeline_cfg["analytics"].items():
            engine = create_analytics(asid, acfg)
            if engine:
                analytics_engines[asid] = engine
                logger.info(f"Initialized analytics {acfg.get('type')} for stream {asid}")

    output_dir = os.path.join(base_dir, "backend", "outputs", "precomputed")
    os.makedirs(output_dir, exist_ok=True)

    for cfg in stream_configs:
        sid = cfg["id"].lower().replace("cam-", "cam_")
        video_path = cfg.get("video_path") or cfg.get("url")
        
        if video_path.startswith("Dataset"):
            video_path = os.path.join(base_dir, video_path)
            
        out_file = os.path.join(output_dir, f"{sid}.json")
        if os.path.exists(out_file):
            logger.info(f"Skipping {sid} -> {out_file} already exists.")
            continue

        logger.info(f"Processing {sid} -> {video_path}")
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"Failed to open {video_path}")
            continue

        native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        tracker = ByteTracker(stream_id=sid, max_age=30)
        
        all_metadata = []
        frame_id = 0

        t_start = time.monotonic()

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # 1. Primary detection
            detections = detector.detect(frame)
            filtered_detections = [d for d in detections if d.class_id in allowed_class_ids]
            
            # 2. Tracking
            det_tuples = [(d.bbox, d.confidence, d.class_id) for d in filtered_detections]
            confirmed_tracks = tracker.update(det_tuples)

            # 3. ANPR cascade
            plate_texts = {}
            for track in confirmed_tracks:
                if track.class_id not in vehicle_class_ids:
                    continue
                x1, y1, x2, y2 = track.bbox
                x1, y1 = max(0, x1), max(0, y1)
                vehicle_crop = frame[y1:y2, x1:x2]
                if vehicle_crop.size == 0:
                    continue

                p_dets = plate_det.detect(vehicle_crop)
                if p_dets:
                    best_p = max(p_dets, key=lambda p: p.confidence)
                    px1, py1, px2, py2 = best_p.bbox
                    px1, py1 = max(0, px1), max(0, py1)
                    plate_crop = vehicle_crop[py1:py2, px1:px2]
                    if plate_crop.size > 0:
                        text = plate_ocr.recognize(plate_crop)
                        if text:
                            plate_texts[track.track_id] = text

            # 4. Generate Metadata
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

            # 5. Custom Analytics
            analytics_events = []
            if sid in analytics_engines:
                analytics_events = analytics_engines[sid].process_frame(frame, confirmed_tracks, frame_id)
                for ev in analytics_events:
                    ev["ts"] = datetime.now(timezone.utc).isoformat()

            video_time_sec = frame_id / max(native_fps, 1.0)
            
            metadata = {
                "frame_id": frame_id,
                "video_time_sec": video_time_sec,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "detections": detections_list,
                "events": analytics_events,
            }
            
            all_metadata.append(metadata)
            frame_id += 1

            if frame_id % 10 == 0:
                elapsed = time.monotonic() - t_start
                logger.info(f"[{sid}] Processed {frame_id}/{total_frames} frames ({frame_id/elapsed:.1f} fps)")

        cap.release()
        
        out_path = os.path.join(output_dir, f"{sid}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(all_metadata, f)
            
        logger.info(f"Saved {len(all_metadata)} frames to {out_path}")

if __name__ == "__main__":
    run()
