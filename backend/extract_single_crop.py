import sys
import os
import argparse
import cv2

def extract_crop(video_path, frame_idx, bbox_str, out_path):
    if not os.path.exists(video_path):
        print(f"ERROR: Video file not found: {video_path}", file=sys.stderr)
        return False

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"ERROR: Cannot open video: {video_path}", file=sys.stderr)
        return False

    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        print(f"ERROR: Could not read frame {frame_idx}", file=sys.stderr)
        return False

    fh, fw = frame.shape[:2]

    # Parse bbox: x,y,w,h
    try:
        parts = [int(float(x.strip())) for x in bbox_str.split(",")]
        bx, by, bw, bh = parts[0], parts[1], parts[2], parts[3]
    except Exception as e:
        print(f"ERROR: Invalid bbox: {bbox_str} ({e})", file=sys.stderr)
        return False

    # 6% contextual padding
    pad_x = int(bw * 0.06)
    pad_y = int(bh * 0.06)

    x1 = max(0, bx - pad_x)
    y1 = max(0, by - pad_y)
    x2 = min(fw, bx + bw + pad_x)
    y2 = min(fh, by + bh + pad_y)

    if x2 <= x1 or y2 <= y1:
        crop = frame
    else:
        crop = frame[y1:y2, x1:x2]

    # Resize if larger than 720px width to ensure fast transmission
    ch, cw = crop.shape[:2]
    if cw > 720:
        scale = 720.0 / cw
        crop = cv2.resize(crop, (720, int(ch * scale)), interpolation=cv2.INTER_AREA)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    success = cv2.imwrite(out_path, crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if success:
        print("OK")
        return True
    else:
        print("ERROR: Failed to write output file", file=sys.stderr)
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, help="Path to video file")
    parser.add_argument("--frame", type=int, required=True, help="Frame index")
    parser.add_argument("--bbox", required=True, help="Bounding box x,y,w,h")
    parser.add_argument("--out", required=True, help="Output jpg path")
    args = parser.parse_args()

    ok = extract_crop(args.video, args.frame, args.bbox, args.out)
    sys.exit(0 if ok else 1)
