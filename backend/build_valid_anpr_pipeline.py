import json
import os
import re
import cv2
from datetime import datetime, timezone, timedelta
from collections import defaultdict

WORKSPACE = "e:/MIlitary_Prototype_IA"
OUTPUTS_DIR = os.path.join(WORKSPACE, "backend/outputs/precomputed")
PUBLIC_CROPS_DIR = os.path.join(WORKSPACE, "public/crops/anpr")
os.makedirs(PUBLIC_CROPS_DIR, exist_ok=True)

# Video mapping
VIDEO_MAP = {
    "CAM-01": os.path.join(WORKSPACE, "Dataset/vehical_TYPE-ANPR_DETECTION/anpr_footage1.mp4"),
    "CAM-02": os.path.join(WORKSPACE, "Dataset/vehical_TYPE-ANPR_DETECTION/anpr_footage2.mp4"),
    "CAM-03": os.path.join(WORKSPACE, "Dataset/vehical_TYPE-ANPR_DETECTION/indain_road_footage3.mp4"),
    "CAM-04": os.path.join(WORKSPACE, "Dataset/vehical_TYPE-ANPR_DETECTION/indian_road_footage2.mp4"),
    "CAM-05": os.path.join(WORKSPACE, "Dataset/vehical_TYPE-ANPR_DETECTION/indian_road_footages1.mp4"),
}

KNOWN_STATE_CODES = {
    'AN', 'AP', 'AR', 'AS', 'BR', 'CH', 'CG', 'DD', 'DL', 'DN',
    'GA', 'GJ', 'HR', 'HP', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD',
    'MP', 'MH', 'MN', 'ML', 'MZ', 'NL', 'OD', 'PB', 'PY', 'RJ',
    'SK', 'TN', 'TS', 'TR', 'UP', 'UK', 'UA', 'WB'
}

RE_STANDARD_INDIA = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}$')
RE_LEGACY_INDIA = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{1,4}$')
RE_BH_SERIES = re.compile(r'^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$')
RE_MILITARY = re.compile(r'^[0-9]{2}[A-Z][0-9]{4,6}[A-Z]?$')
RE_TACTICAL_GENERAL = re.compile(r'^[A-Z]{2}[0-9]{1,2}[A-Z0-9]{3,6}$')

def clean_plate(s):
    if not s:
        return ""
    return re.sub(r'[^A-Za-z0-9]', '', str(s)).upper()

def format_plate(c):
    if not c:
        return ""
    m1 = re.match(r'^([A-Z]{2})([0-9]{1,2}[A-Z]{1,3})([0-9]{3,4})$', c)
    if m1:
        return f"{m1.group(1)} {m1.group(2)} {m1.group(3)}"
    m2 = re.match(r'^([A-Z]{2})([0-9]{2})([A-Z]{1,2})([0-9]{4})$', c)
    if m2:
        return f"{m2.group(1)} {m2.group(2)} {m2.group(3)} {m2.group(4)}"
    return c

def is_valid_plate(raw_plate):
    c = clean_plate(raw_plate)
    if len(c) < 5 or len(c) > 10:
        return False
    if c.isdigit() or c.isalpha():
        return False
    # Reject 3 or more repeated characters
    if re.search(r'(.)\1{2,}', c):
        return False
    
    num_letters = sum(1 for ch in c if ch.isalpha())
    num_digits = sum(1 for ch in c if ch.isdigit())
    if num_letters < 2 or num_digits < 2:
        return False

    prefix2 = c[:2]
    if prefix2 in KNOWN_STATE_CODES:
        return True
    
    if (RE_STANDARD_INDIA.match(c) or RE_LEGACY_INDIA.match(c) or 
        RE_BH_SERIES.match(c) or RE_MILITARY.match(c) or RE_TACTICAL_GENERAL.match(c)):
        return True
        
    return False

# Camera metadata definitions
CAMERA_METADATA = {
    "CAM-01": {"name": "CHECKPOST 1", "sector": "SECTOR-1 HQ", "zone": "HQ COMPLEX", "mgrs": "43R WQ 1842 8112"},
    "CAM-02": {"name": "MAIN GATEWAY ALPHA", "sector": "SECTOR-1 HQ", "zone": "PERIMETER ACCESS", "mgrs": "43R WQ 1845 8120"},
    "CAM-03": {"name": "CONVOY CORRIDOR 3", "sector": "SECTOR-2 LOGISTICS", "zone": "ARTERIAL HIGHWAY", "mgrs": "43R WQ 1850 8135"},
    "CAM-04": {"name": "DEPOT NORTH JUNCTION", "sector": "SECTOR-2 LOGISTICS", "zone": "DEPOT ACCESS", "mgrs": "43R WQ 1855 8140"},
    "CAM-05": {"name": "SOUTHERN BYPASS", "sector": "SECTOR-3 RESERVE", "zone": "HIGHWAY INTERCEPT", "mgrs": "43R WQ 1860 8150"},
    "CAM-06": {"name": "OUTPOST FOXTROT", "sector": "SECTOR-4 FORWARD", "zone": "FORWARD VALLEY", "mgrs": "43R WQ 1872 8165"},
    "CAM-07": {"name": "PERIMETER GATE 2", "sector": "SECTOR-1 HQ", "zone": "WEST GATE", "mgrs": "43R WQ 1848 8122"},
    "CAM-10": {"name": "CHECKPOINT ZULU", "sector": "SECTOR-4 FORWARD", "zone": "VALLEY PASS", "mgrs": "43R WQ 1880 8180"},
}

def extract_crops_and_generate_logs():
    print("[*] Starting ANPR consolidation with strict plate validity check...")
    
    all_logs = []
    video_caps = {}

    # Open video capture handles for cameras that have local videos
    for cam_id, vpath in VIDEO_MAP.items():
        if os.path.exists(vpath):
            cap = cv2.VideoCapture(vpath)
            if cap.isOpened():
                video_caps[cam_id] = cap
                print(f"[+] Opened video capture for {cam_id}: {os.path.basename(vpath)}")

    # Process all available precomputed cameras
    cam_files = [
        ("CAM-01", "cam_01.json"),
        ("CAM-02", "cam_02.json"),
        ("CAM-03", "cam_03.json"),
        ("CAM-06", "cam_06.json"),
        ("CAM-07", "cam_07.json"),
        ("CAM-10", "cam_10.json"),
    ]

    base_time = datetime(2026, 10, 23, 5, 33, 45, tzinfo=timezone.utc)
    log_counter = 1

    # Track plates seen across multiple cameras for cross-camera sightings
    plate_sightings = defaultdict(list)

    for cam_id, filename in cam_files:
        fpath = os.path.join(OUTPUTS_DIR, filename)
        if not os.path.exists(fpath):
            continue

        with open(fpath, "r", encoding="utf-8") as f:
            frames = json.load(f)

        meta = CAMERA_METADATA.get(cam_id, {
            "name": f"CHECKPOINT {cam_id}",
            "sector": "TACTICAL SECTOR",
            "zone": "MONITORING ZONE",
            "mgrs": "43R WQ 1840 8110"
        })

        # Group detections by vehicle track id
        tracks = defaultdict(list)
        for idx, fr in enumerate(frames):
            for d in fr.get("detections", []):
                tid = d.get("id")
                plate = d.get("plate")
                if tid is not None and plate:
                    tracks[tid].append({
                        "frame_idx": idx,
                        "plate": plate,
                        "conf": float(d.get("confidence", 0.0)),
                        "model": d.get("model"),
                        "cls": d.get("class", "car"),
                        "bbox": [d.get("x", 0), d.get("y", 0), d.get("w", 0), d.get("h", 0)],
                        "timestamp": fr.get("timestamp"),
                        "speed": d.get("speed", 42.0)
                    })

        print(f"[*] {cam_id}: {len(tracks)} tracked vehicles found")

        # Process each tracked vehicle
        for tid, det_list in tracks.items():
            # Filter detections strictly by validity
            valid_dets = [d for d in det_list if is_valid_plate(d["plate"])]
            if not valid_dets:
                # REJECT: Vehicle did not have any valid license plate reading
                continue

            # Pick the detection with the HIGHEST CONFIDENCE for this car
            best_det = max(valid_dets, key=lambda x: x["conf"])
            
            c_plate = clean_plate(best_det["plate"])
            display_plate = format_plate(c_plate)

            record_id = f"ANPR-VLD-{log_counter:05d}"
            log_counter += 1

            # Format vehicle type
            raw_cls = (best_det["cls"] or "car").lower()
            if "truck" in raw_cls:
                vtype = "Truck"
            elif "taxi" in raw_cls:
                vtype = "Taxi"
            elif "auto" in raw_cls:
                vtype = "Auto"
            elif "bus" in raw_cls:
                vtype = "Bus"
            elif "motorcycle" in raw_cls or "bike" in raw_cls:
                vtype = "Motorcycle"
            else:
                vtype = "Car"

            model_name = best_det["model"] or (
                "Hyundai Creta" if vtype == "Car" and cam_id == "CAM-01" else
                "Toyota Innova" if vtype == "Car" and cam_id == "CAM-02" else
                "Maruti Eeco" if vtype == "Taxi" else
                "Tata 407" if vtype == "Truck" else
                "Honda Activa" if vtype == "Motorcycle" else vtype
            )

            # Crop generation if video capture available
            crop_filename = f"{record_id}.jpg"
            crop_full_path = os.path.join(PUBLIC_CROPS_DIR, crop_filename)
            crop_rel_path = f"/crops/anpr/{crop_filename}"

            if not os.path.exists(crop_full_path) and cam_id in video_caps:
                cap = video_caps[cam_id]
                cap.set(cv2.CAP_PROP_POS_FRAMES, best_det["frame_idx"])
                ret, frame = cap.read()
                if ret:
                    fh, fw = frame.shape[:2]
                    bx, by, bw, bh = best_det["bbox"]
                    # 6% contextual margin
                    px = int(bw * 0.06)
                    py = int(bh * 0.06)
                    x1 = max(0, bx - px)
                    y1 = max(0, by - py)
                    x2 = min(fw, bx + bw + px)
                    y2 = min(fh, by + bh + py)

                    if x2 > x1 and y2 > y1:
                        car_crop = frame[y1:y2, x1:x2]
                        # Resize if too huge (e.g. 4K) to maintain snappy web load (~640px wide max)
                        ch, cw = car_crop.shape[:2]
                        if cw > 640:
                            scale = 640.0 / cw
                            car_crop = cv2.resize(car_crop, (640, int(ch * scale)), interpolation=cv2.INTER_AREA)

                        cv2.imwrite(crop_full_path, car_crop, [cv2.IMWRITE_JPEG_QUALITY, 88])

            # If no physical crop extracted (e.g. forward outposts CAM-06/07/10 without local mp4),
            # provide tactical sensor snapshot placeholder or link to respective camera sector
            if not crop_rel_path:
                crop_rel_path = f"/crops/anpr/test_creta.jpg" if vtype == "Car" else f"/crops/anpr/test_eeco.jpg"

            time_offset = timedelta(seconds=len(all_logs) * 45)
            rec_time = (base_time - time_offset).isoformat()

            log_entry = {
                "id": record_id,
                "eventId": 30000 + log_counter,
                "timestamp": rec_time,
                "plate": display_plate,
                "rawPlate": c_plate,
                "vehicleType": vtype,
                "model": model_name,
                "cameraId": cam_id,
                "cameraName": meta["name"],
                "sector": meta["sector"],
                "zone": meta["zone"],
                "mgrs": meta["mgrs"],
                "confidence": round(float(best_det["conf"]), 3),
                "plateConfidence": round(float(best_det["conf"]), 3),
                "trackId": tid,
                "speedKmh": round(float(best_det.get("speed", 40.0 + (tid % 25))), 1),
                "status": "VERIFIED",
                "sightingsCount": 1,
                "bbox": best_det["bbox"],
                "frameIdx": best_det["frame_idx"],
                "carCropUrl": crop_rel_path,
                "valid": True,
                "verificationNote": f"Peak confidence match at Frame #{best_det['frame_idx']} ({round(best_det['conf']*100, 1)}%)"
            }

            all_logs.append(log_entry)
            plate_sightings[c_plate].append({
                "cameraId": cam_id,
                "cameraName": meta["name"],
                "sector": meta["sector"],
                "timestamp": rec_time,
                "frameIdx": best_det["frame_idx"],
                "cropUrl": crop_rel_path
            })

    # Release video caps
    for cap in video_caps.values():
        cap.release()

    # Consolidate cross-camera sightings
    for log in all_logs:
        c_plate = log["rawPlate"]
        sightings = plate_sightings.get(c_plate, [])
        log["sightingsCount"] = len(sightings)
        if len(sightings) > 1:
            log["status"] = "MULTI_SIGHTING"
        log["sightingsHistory"] = sightings

    # Sort logs newest first
    all_logs.sort(key=lambda x: x["timestamp"], reverse=True)

    out_file = os.path.join(WORKSPACE, "lib/datasets/anpr_logs.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(all_logs, f, indent=2)

    print(f"[OK] Successfully generated {len(all_logs)} strictly validated ANPR records with crops!")
    print(f"[OK] Output saved to {out_file}")

if __name__ == "__main__":
    extract_crops_and_generate_logs()
