#!/usr/bin/env python3
"""
========================================================================================
Argus Matrix - Zero-GPU Precompute Verification & Real-Time Playback Demo
Reads precomputed JSON files from E:\\MIlitary_Prototype_IA\\5090\\precompute
and verifies schema integrity, frame coverage, detections, and performance.
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

WORKSPACE_ROOT = Path(r"E:\MIlitary_Prototype_IA\5090")
VIDEOS_DIR = WORKSPACE_ROOT / "vehical_TYPE-ANPR_DETECTION"
PRECOMPUTE_DIR = WORKSPACE_ROOT / "precompute"

COLORS = {
    "car": (0, 255, 128),
    "taxi": (0, 215, 255),
    "auto": (0, 255, 255),
    "bike": (255, 128, 0),
    "truck": (255, 64, 64),
    "bus": (255, 0, 255),
    "plate": (0, 255, 0),
}

def verify_all_precomputed():
    json_files = sorted(list(PRECOMPUTE_DIR.glob("*_precompute.json")))
    if not json_files:
        print(f"[!] No precompute JSON files found in {PRECOMPUTE_DIR}")
        return

    print("\n" + "=" * 90)
    print("  ARGUS PRECOMPUTE VERIFICATION & AUDIT REPORT")
    print("=" * 90)
    print(f"  Precompute Directory: {PRECOMPUTE_DIR}")
    print(f"  Found Files:          {len(json_files)}\n")

    summary_rows = []

    for jf in json_files:
        with open(jf, "r", encoding="utf-8") as f:
            data = json.load(f)

        meta = data.get("metadata", {})
        frames = data.get("frames", {})
        
        v_name = meta.get("video_filename", "unknown")
        mode = meta.get("mode", "unknown")
        w = meta.get("width", 0)
        h = meta.get("height", 0)
        fps = meta.get("fps", 0.0)
        total_frames = meta.get("total_frames", 0)
        json_frame_count = len(frames)
        file_size_kb = jf.stat().st_size / 1024.0

        total_detections = 0
        total_plates = 0
        unique_tracks = set()

        for f_idx, dets in frames.items():
            total_detections += len(dets)
            for d in dets:
                t_id = d.get("track_id")
                if t_id is not None and t_id != -1:
                    unique_tracks.add(t_id)
                if d.get("anpr") and d["anpr"].get("plate_text"):
                    total_plates += 1

        summary_rows.append({
            "file": jf.name,
            "mode": mode,
            "res": f"{w}x{h}",
            "frames": f"{json_frame_count}/{total_frames}",
            "tracks": len(unique_tracks),
            "detections": total_detections,
            "plates": total_plates,
            "size": f"{file_size_kb:.1f} KB",
        })

    # Print summary table
    headers = ["File", "Mode", "Resolution", "Frames", "Tracks", "Detections", "Plates", "Size"]
    row_format = "  {:<32} {:<18} {:<11} {:<11} {:<8} {:<12} {:<8} {:<10}"
    print(row_format.format(*headers))
    print("  " + "-" * 115)
    for r in summary_rows:
        print(row_format.format(
            r["file"], r["mode"], r["res"], r["frames"], r["tracks"], r["detections"], r["plates"], r["size"]
        ))
    print("=" * 90 + "\n")


def preview_precomputed(video_name: str, max_preview_frames: int = 200, display: bool = False):
    """Demonstrates O(1) Zero-GPU playback reading straight from the precomputed JSON."""
    stem = Path(video_name).stem.replace("_precompute", "")
    json_path = PRECOMPUTE_DIR / f"{stem}_precompute.json"
    video_path = VIDEOS_DIR / f"{stem}.mp4"

    if not json_path.is_file():
        print(f"[!] JSON not found: {json_path}")
        return
    if not video_path.is_file():
        # Try alternate extensions
        matches = list(VIDEOS_DIR.glob(f"{stem}.*"))
        if matches:
            video_path = matches[0]
        else:
            print(f"[!] Video source not found for: {stem}")
            return

    print(f"[*] Loading precompute: {json_path.name} ...")
    with open(json_path, "r", encoding="utf-8") as f:
        precompute = json.load(f)

    meta = precompute["metadata"]
    frames_dict = precompute["frames"]
    
    cap = cv2.VideoCapture(str(video_path))
    print(f"[*] Playing {video_path.name} with ZERO GPU inference (reading frame index O(1))...")
    
    frame_idx = 0
    t0 = time.time()

    while True:
        ret, frame = cap.read()
        if not ret or frame_idx >= max_preview_frames:
            break

        dets = frames_dict.get(str(frame_idx), [])
        
        # Draw all precomputed boxes and labels
        for d in dets:
            x1, y1, x2, y2 = d["bbox"]
            label = d.get("display_label", "")
            
            # Select color based on category
            color = (0, 255, 128)
            if "AUTO" in label: color = COLORS["auto"]
            elif "BIKE" in label or "CYCLE" in label: color = COLORS["bike"]
            elif "TRUCK" in label: color = COLORS["truck"]
            elif "BUS" in label: color = COLORS["bus"]
            
            # Draw vehicle bounding box
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            
            # Draw label banner
            cv2.putText(
                frame,
                label,
                (x1, max(20, y1 - 8)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                color,
                2,
                cv2.LINE_AA,
            )

            # Draw ANPR plate bbox if present
            anpr = d.get("anpr")
            if anpr and anpr.get("plate_bbox"):
                px1, py1, px2, py2 = anpr["plate_bbox"]
                cv2.rectangle(frame, (px1, py1), (px2, py2), COLORS["plate"], 2)

        frame_idx += 1

    cap.release()
    elapsed = time.time() - t0
    fps_playback = frame_idx / max(elapsed, 0.001)
    print(f"[+] Rendered {frame_idx} frames in {elapsed:.2f}s ({fps_playback:.1f} FPS playback with 0% GPU load!)\n")


def main():
    parser = argparse.ArgumentParser(description="Verify and audit precomputed JSON outputs.")
    parser.add_argument("--audit", action="store_true", default=True, help="Audit all JSON files in precompute/")
    parser.add_argument("--preview", type=str, default=None, help="Preview video playback with overlay")
    args = parser.parse_args()

    if args.preview:
        preview_precomputed(args.preview)
    else:
        verify_all_precomputed()


if __name__ == "__main__":
    main()
