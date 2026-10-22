#!/usr/bin/env python3
"""
========================================================================================
Argus Matrix - Full Video Annotation & Rendering Engine
Renders full-length annotated MP4 videos with:
  - Neural Vehicle Bounding Boxes & Corner Accents
  - Fine-grained Vehicle Models (Mercedes-Benz, Hyundai Creta, Maruti Wagon R, etc.)
  - Tactical License Plate Badges with Indian RTO Disambiguation
  - Top Telemetry HUD Overlay
Saves rendered videos directly into: E:\\MIlitary_Prototype_IA\\5090\\Test\\Outputs
========================================================================================
"""

import os
import sys
import json
import time
import argparse
from pathlib import Path
import cv2
import numpy as np

# Directory Paths dynamically resolved
WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
VIDEOS_DIR = WORKSPACE_ROOT / "vehical_TYPE-ANPR_DETECTION"
PRECOMPUTE_DIR = WORKSPACE_ROOT / "precompute"
OUTPUTS_DIR = WORKSPACE_ROOT / "Test" / "Outputs"
MODELS_DIR = WORKSPACE_ROOT / "models"

OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# Visual Color Scheme (BGR)
COLORS = {
    "car": (0, 255, 128),       # Emerald Green
    "taxi": (0, 230, 255),      # Amber Yellow
    "auto": (0, 230, 255),      # Amber Yellow
    "bike": (255, 150, 0),      # Safety Orange
    "truck": (255, 80, 80),     # Sky Blue
    "bus": (255, 60, 180),      # Magenta
    "plate_box": (0, 0, 255),   # Crimson Red
    "plate_text": (0, 230, 255),# Gold/Cyan
    "hud_bg": (15, 15, 22),     # Dark slate
}


def draw_tactical_box(img: np.ndarray, bbox, color, thickness=2, corner_len=18):
    """Draws sleek bounding box with high-tech corner brackets."""
    x1, y1, x2, y2 = bbox
    cv2.rectangle(img, (x1, y1), (x2, y2), color, thickness)
    
    clen = min(corner_len, (x2 - x1) // 4, (y2 - y1) // 4)
    if clen > 4:
        cthick = thickness + 2
        # Top-Left
        cv2.line(img, (x1, y1), (x1 + clen, y1), color, cthick)
        cv2.line(img, (x1, y1), (x1, y1 + clen), color, cthick)
        # Top-Right
        cv2.line(img, (x2, y1), (x2 - clen, y1), color, cthick)
        cv2.line(img, (x2, y1), (x2, y1 + clen), color, cthick)
        # Bottom-Left
        cv2.line(img, (x1, y2), (x1 + clen, y2), color, cthick)
        cv2.line(img, (x1, y2), (x1, y2 - clen), color, cthick)
        # Bottom-Right
        cv2.line(img, (x2, y2), (x2 - clen, y2), color, cthick)
        cv2.line(img, (x2, y2), (x2, y2 - clen), color, cthick)


def draw_vehicle_badge(img: np.ndarray, bbox, vehicle_type: str, car_model: str = None, plate_text: str = None, track_id: int = None):
    """Draws dark translucent header pill badge above vehicle."""
    x1, y1, x2, y2 = bbox
    h, w = img.shape[:2]

    # Category color selection
    v_upper = vehicle_type.upper() if vehicle_type else "VEHICLE"
    color = COLORS["car"]
    if "AUTO" in v_upper:
        color = COLORS["auto"]
        vehicle_type = "Auto"
        car_model = None  # Auto rickshaws are never assigned a car model!
    elif "TAXI" in v_upper:
        color = COLORS["taxi"]
    elif "BIKE" in v_upper or "SCOOT" in v_upper or "MOTORCYCLE" in v_upper:
        color = COLORS["bike"]
        car_model = None
    elif "TRUCK" in v_upper:
        color = COLORS["truck"]
        car_model = None
    elif "BUS" in v_upper:
        color = COLORS["bus"]
        car_model = None

    # 1. Draw tactical bounding box
    draw_tactical_box(img, bbox, color)

    # 2. Build Label text
    id_prefix = f"#{track_id:02d} " if track_id is not None and track_id != -1 else ""
    if car_model:
        v_label = f"{id_prefix}{vehicle_type} : {car_model}"
    else:
        v_label = f"{id_prefix}{vehicle_type}"

    full_text = v_label + (f" | [{plate_text}]" if plate_text else "")

    font = cv2.FONT_HERSHEY_DUPLEX
    scale = 0.50
    thickness = 1
    (tw, th), baseline = cv2.getTextSize(full_text, font, scale, thickness)

    bx1 = x1
    by1 = max(0, y1 - th - 10)
    bx2 = min(w - 1, x1 + tw + 16)
    by2 = max(th + 10, y1)

    # Header pill background
    cv2.rectangle(img, (bx1, by1), (bx2, by2), COLORS["hud_bg"], -1)
    cv2.rectangle(img, (bx1, by1), (bx2, by2), color, 1)

    # Text rendering
    if plate_text:
        v_part = f"{v_label} | "
        (vw, vh), _ = cv2.getTextSize(v_part, font, scale, thickness)
        cv2.putText(img, v_part, (bx1 + 8, by2 - 5), font, scale, (255, 255, 255), thickness, cv2.LINE_AA)
        cv2.putText(img, f"[{plate_text}]", (bx1 + 8 + vw, by2 - 5), font, scale, COLORS["plate_text"], 2, cv2.LINE_AA)
    else:
        cv2.putText(img, full_text, (bx1 + 8, by2 - 5), font, scale, (255, 255, 255), thickness, cv2.LINE_AA)


def draw_plate_box(img: np.ndarray, plate_bbox, plate_text: str = None):
    """Draws prominent neon box around license plate."""
    px1, py1, px2, py2 = plate_bbox
    cv2.rectangle(img, (px1, py1), (px2, py2), COLORS["plate_box"], 2)
    tag = plate_text if plate_text else "PLATE"
    (ptw, pth), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
    py_tag = max(pth + 4, py1 - 4)
    cv2.rectangle(img, (px1, py_tag - pth - 4), (px1 + ptw + 8, py_tag + 2), COLORS["plate_box"], -1)
    cv2.putText(img, tag, (px1 + 4, py_tag - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)


def draw_hud_header(img: np.ndarray, video_name: str, frame_idx: int, total_frames: int, active_count: int, total_plates: int, fps_display: float):
    """Draws top HUD banner with telemetry."""
    w = img.shape[1]
    banner_h = 38
    
    # Semi-transparent top bar
    overlay = img.copy()
    cv2.rectangle(overlay, (0, 0), (w, banner_h), (12, 12, 18), -1)
    cv2.addWeighted(overlay, 0.82, img, 0.18, 0, img)
    cv2.line(img, (0, banner_h), (w, banner_h), (0, 255, 128), 1)

    # Telemetry text
    hud_left = f"ARGUS MATRIX | {video_name} | FRAME: {frame_idx:04d}/{total_frames} | SPEED: {fps_display:4.1f} FPS"
    hud_right = f"ACTIVE TARGETS: {active_count:02d} | PLATES LOGGED: {total_plates:02d} | ENGINE: RTX 5090"
    
    cv2.putText(img, hud_left, (16, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)
    (rw, rh), _ = cv2.getTextSize(hud_right, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
    cv2.putText(img, hud_right, (max(w - rw - 16, 400), 24), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 230, 255), 1, cv2.LINE_AA)


# ---------------------------------------------------------------------------
# Render Function using Precompute JSON
# ---------------------------------------------------------------------------
def render_from_precompute(video_path: Path, json_path: Path, output_path: Path, max_frames: int = None):
    print(f"\n[*] Rendering from Precomputed JSON: {json_path.name}")
    with open(json_path, "r", encoding="utf-8") as f:
        precomp = json.load(f)

    meta = precomp.get("metadata", {})
    frames_dict = precomp.get("frames", {})

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[!] Cannot open video source: {video_path}")
        return False

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frames_to_process = min(total_video_frames, max_frames) if max_frames else total_video_frames

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(output_path), fourcc, fps, (w, h))

    print(f"[*] Exporting Video -> {output_path.name}")
    print(f"    Resolution: {w}x{h} @ {fps:.1f} FPS | Total Frames: {frames_to_process}")

    frame_idx = 0
    t0 = time.time()
    seen_plates = set()

    while True:
        ret, frame = cap.read()
        if not ret or (max_frames and frame_idx >= max_frames):
            break

        dets = frames_dict.get(str(frame_idx), [])
        
        # 1. Draw each detection
        for d in dets:
            bbox = d.get("bbox")
            v_type = d.get("vehicle_type", "Car")
            car_model = d.get("car_model")
            track_id = d.get("track_id")
            
            anpr = d.get("anpr") or {}
            plate_text = anpr.get("plate_text")
            plate_bbox = anpr.get("plate_bbox")
            
            if plate_text:
                seen_plates.add(plate_text)

            draw_vehicle_badge(
                frame,
                bbox=bbox,
                vehicle_type=v_type,
                car_model=car_model,
                plate_text=plate_text,
                track_id=track_id,
            )

            if plate_bbox:
                draw_plate_box(frame, plate_bbox, plate_text)

        # 2. Draw HUD Header
        elapsed = time.time() - t0
        cur_fps = (frame_idx + 1) / max(elapsed, 0.001)
        draw_hud_header(
            frame,
            video_name=video_path.name,
            frame_idx=frame_idx + 1,
            total_frames=frames_to_process,
            active_count=len(dets),
            total_plates=len(seen_plates),
            fps_display=cur_fps,
        )

        out.write(frame)
        frame_idx += 1

        if frame_idx % 100 == 0 or frame_idx == frames_to_process:
            print(f"    - Rendered {frame_idx}/{frames_to_process} frames ({frame_idx/frames_to_process*100:.1f}%) | {cur_fps:.1f} FPS")

    cap.release()
    out.release()
    total_time = time.time() - t0
    print(f"[+] Successfully exported: {output_path}")
    print(f"    Total Time: {total_time:.2f}s | Average Speed: {frame_idx/max(total_time,0.001):.1f} FPS\n")
    return True


# ---------------------------------------------------------------------------
# Main Runner
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Argus Matrix - Full Video Annotation & Rendering Engine")
    parser.add_argument(
        "--video",
        type=str,
        default=None,
        help="Specify video name (e.g., anpr_footage1.mp4). Default: renders all available videos.",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=None,
        help="Max frames to render per video (default: entire video).",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(OUTPUTS_DIR),
        help=f"Directory to save output videos (default: {OUTPUTS_DIR})",
    )
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Find videos
    video_extensions = ("*.mp4", "*.avi", "*.mkv", "*.mov")
    video_files = []
    for ext in video_extensions:
        video_files.extend(VIDEOS_DIR.glob(ext))
    video_files = sorted(list(set(video_files)))

    if not video_files:
        print(f"[!] No input videos found in {VIDEOS_DIR}")
        return

    print("=" * 80)
    print("  ARGUS MATRIX - FULL VIDEO ANNOTATION RENDERER")
    print("=" * 80)
    print(f"  Input Videos Folder:   {VIDEOS_DIR}")
    print(f"  Output Videos Folder:  {out_dir}")
    print(f"  Target Videos Found:   {len(video_files)}")
    print("=" * 80)

    for vf in video_files:
        if args.video and args.video.lower() not in vf.name.lower():
            continue

        json_path = PRECOMPUTE_DIR / f"{vf.stem}_precompute.json"
        out_video_path = out_dir / f"{vf.stem}_annotated.mp4"

        # Check if precomputed JSON exists for ultra-fast zero-GPU rendering
        if json_path.is_file():
            render_from_precompute(vf, json_path, out_video_path, max_frames=args.max_frames)
        else:
            print(f"\n[*] Precompute JSON not found for {vf.name}. Running pipeline to generate it first...")
            from precompute_pipeline import OfflinePrecomputePipeline
            pipeline = OfflinePrecomputePipeline(batch_size=32)
            mode = "ANPR_MODE" if "anpr" in vf.stem.lower() else "INDIAN_ROAD_MODE"
            res = pipeline.process_video(vf, mode=mode, max_frames=args.max_frames)
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(res, f, indent=2)
            render_from_precompute(vf, json_path, out_video_path, max_frames=args.max_frames)

    print("=" * 80)
    print(f"  ALL REQUESTED VIDEOS RENDERED INTO: {out_dir}")
    print("=" * 80)


if __name__ == "__main__":
    main()
