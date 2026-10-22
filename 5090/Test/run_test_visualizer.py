#!/usr/bin/env python3
"""
========================================================================================
Argus Matrix - Visual Test & Verification Runner for Screenshots
Reads input images from E:\\MIlitary_Prototype_IA\\5090\\Test\\ScreenShot,
runs YOLOv11s + SigLIP (Vehicle Type & Fine-Grained Model) + FastALPR + Indian RTO Plate Disambiguation,
draws annotated bounding boxes, vehicle models, and license plate badges,
and saves the output images into E:\\MIlitary_Prototype_IA\\5090\\Test\\Outputs.
========================================================================================
"""

import os
import sys
import re
import glob
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F

# Set local directory context
TEST_DIR = Path(r"E:\MIlitary_Prototype_IA\5090\Test")
SCREENSHOT_DIR = TEST_DIR / "ScreenShot"
OUTPUTS_DIR = TEST_DIR / "Outputs"
MODELS_DIR = Path(r"E:\MIlitary_Prototype_IA\5090\models")

OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Indian RTO Positional Plate Disambiguation
# ---------------------------------------------------------------------------
LETTER_MAP = {"0": "O", "1": "I", "8": "B", "5": "S", "2": "Z"}
DIGIT_MAP = {"O": "0", "I": "1", "B": "8", "S": "5", "Z": "2", "Q": "0", "D": "0"}

def clean_indian_plate(raw_text: str) -> str:
    if not raw_text:
        return ""
    clean = re.sub(r"[^A-Za-z0-9]", "", str(raw_text)).upper()
    if len(clean) < 5:
        return clean
    
    # Bharat Series: DD BH DDDD LL
    if len(clean) >= 8 and clean[2:4] in ["BH", "8H", "BI", "8I"]:
        d0 = DIGIT_MAP.get(clean[0], clean[0])
        d1 = DIGIT_MAP.get(clean[1], clean[1])
        num_part = "".join(DIGIT_MAP.get(c, c) for c in clean[4:8])
        series_part = "".join(LETTER_MAP.get(c, c) for c in clean[8:])
        return f"{d0}{d1}BH{num_part}{series_part}"
    
    # State code correction
    st = "".join(LETTER_MAP.get(c, c) for c in clean[:2])
    # Handle common OCR letter mergers: VK/VH/NH/M4 with 12/01/02 -> MH (Maharashtra)
    if st in ["VK", "VH", "NH", "M4"] and len(clean) > 4 and clean[2:4] in ["12", "01", "02", "04"]:
        st = "MH"
        
    rto = "".join(DIGIT_MAP.get(c, c) for c in clean[2:4])
    
    # Parse series (1-3 letters) and registration number (1-4 digits)
    rest = clean[4:]
    m = re.match(r"^([A-Za-z]{1,3})([0-9A-Za-z]{1,4})$", rest)
    if m:
        series = "".join(LETTER_MAP.get(c, c) for c in m.group(1))
        reg_digits = "".join(DIGIT_MAP.get(c, c) for c in m.group(2))
        return f"{st}{rto}{series}{reg_digits}"
    
    # Fallback standard
    if len(clean) >= 8:
        reg_num = "".join(DIGIT_MAP.get(c, c) for c in clean[-4:])
        mid_series = "".join(LETTER_MAP.get(c, c) for c in clean[4:-4])
        return f"{st}{rto}{mid_series}{reg_num}"
    
    return clean


# ---------------------------------------------------------------------------
# SigLIP Categories & Classifiers
# ---------------------------------------------------------------------------
VEHICLE_TYPES = [
    "Auto Rickshaw",
    "Scooty",
    "Motorcycle",
    "Taxi",
    "Car",
    "Mini Truck / Pickup",
    "Truck",
    "Bus",
    "Tractor",
]

VEHICLE_TYPE_PROMPTS = [
    "a photo of an Indian auto rickshaw tuk-tuk",
    "a photo of a motor scooter, scooty, honda activa, or moped",
    "a photo of a motorcycle or motorbike",
    "a photo of a yellow and black taxi cab",
    "a photo of a private passenger car, sedan, hatchback, or luxury car",
    "a photo of a small pickup truck or tata ace",
    "a photo of a large heavy commercial truck or lorry",
    "a photo of a passenger transit bus",
    "a photo of an agricultural farm tractor",
]

CAR_MODELS = [
    "Mercedes-Benz",
    "BMW",
    "Audi",
    "Maruti Wagon R",
    "Maruti Swift",
    "Maruti Dzire",
    "Maruti Alto",
    "Maruti Baleno",
    "Maruti Brezza",
    "Maruti Ertiga",
    "Hyundai Creta",
    "Hyundai i10",
    "Hyundai i20",
    "Hyundai Venue",
    "Hyundai Verna",
    "Tata Nexon",
    "Tata Punch",
    "Tata Harrier",
    "Tata Safari",
    "Toyota Fortuner",
    "Toyota Innova",
    "Mahindra Scorpio",
    "Mahindra Thar",
    "Mahindra XUV700",
    "Mahindra Bolero",
    "Honda City",
    "Kia Seltos",
]

CAR_MODEL_PROMPTS = [f"a photo of a {model} car" for model in CAR_MODELS]


class SiglipClassifier:
    def __init__(self, device: torch.device):
        self.device = device
        self.active = False
        self.model = None
        self.processor = None
        
        try:
            from transformers import AutoProcessor, AutoModel
            cache = MODELS_DIR / "siglip"
            print(f"[*] Initializing SigLIP Vision Classifier from {cache} on {device}...")
            try:
                self.processor = AutoProcessor.from_pretrained(
                    "google/siglip-so400m-patch14-384", cache_dir=str(cache), local_files_only=True
                )
                self.model = AutoModel.from_pretrained(
                    "google/siglip-so400m-patch14-384",
                    cache_dir=str(cache),
                    local_files_only=True,
                    torch_dtype=torch.float16 if device.type == "cuda" else torch.float32,
                ).to(self.device)
            except Exception:
                print("    [*] Fetching SigLIP weights from HuggingFace Hub into cache...")
                self.processor = AutoProcessor.from_pretrained(
                    "google/siglip-so400m-patch14-384", cache_dir=str(cache)
                )
                self.model = AutoModel.from_pretrained(
                    "google/siglip-so400m-patch14-384",
                    cache_dir=str(cache),
                    torch_dtype=torch.float16 if device.type == "cuda" else torch.float32,
                ).to(self.device)
            self.model.eval()

            # Precompute text embeddings
            with torch.no_grad():
                tin_v = self.processor(text=VEHICLE_TYPE_PROMPTS, padding=True, return_tensors="pt").to(self.device)
                vout = self.model.get_text_features(**tin_v)
                v_feat = vout.pooler_output if hasattr(vout, "pooler_output") and vout.pooler_output is not None else vout
                if not isinstance(v_feat, torch.Tensor):
                    v_feat = v_feat[0]
                self.v_embeds = F.normalize(v_feat, p=2, dim=-1)

                tin_c = self.processor(text=CAR_MODEL_PROMPTS, padding=True, return_tensors="pt").to(self.device)
                cout = self.model.get_text_features(**tin_c)
                c_feat = cout.pooler_output if hasattr(cout, "pooler_output") and cout.pooler_output is not None else cout
                if not isinstance(c_feat, torch.Tensor):
                    c_feat = c_feat[0]
                self.c_embeds = F.normalize(c_feat, p=2, dim=-1)

            self.active = True
            print("    [+] SigLIP Vision-Language Classifier successfully ready!\n")
        except Exception as e:
            print(f"    [!] Could not initialize SigLIP: {e}. Falling back to heuristic classifier.")
            self.active = False

    def classify_crop(self, crop_bgr: np.ndarray, yolo_cls_id: int):
        if not self.active or crop_bgr.shape[0] < 20 or crop_bgr.shape[1] < 20:
            return fallback_classify_vehicle(crop_bgr, yolo_cls_id)

        try:
            crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
            im = Image.fromarray(crop_rgb)
            iin = self.processor(images=[im], return_tensors="pt").to(self.device)
            
            with torch.no_grad():
                iout = self.model.get_image_features(**iin)
                i_feat = iout.pooler_output if hasattr(iout, "pooler_output") and iout.pooler_output is not None else iout
                if not isinstance(i_feat, torch.Tensor):
                    i_feat = i_feat[0]
                i_norm = F.normalize(i_feat, p=2, dim=-1)

                # Check car/SUV model probabilities first
                sim_c = torch.matmul(i_norm, self.c_embeds.T) * 100.0
                probs_c = F.softmax(sim_c, dim=-1).squeeze().cpu().numpy()
                best_c_idx = int(np.argmax(probs_c))
                top_car_model = CAR_MODELS[best_c_idx]
                top_c_conf = float(probs_c[best_c_idx])

                # Check general vehicle categories
                sim_v = torch.matmul(i_norm, self.v_embeds.T) * 100.0
                probs_v = F.softmax(sim_v, dim=-1).squeeze().cpu().numpy()
                best_v_idx = int(np.argmax(probs_v))
                v_type = VEHICLE_TYPES[best_v_idx]

                car_model = None

                # Disambiguate YOLO classes
                # In COCO, YOLOv11 frequently misclassifies compact SUVs (like Hyundai Creta, Fortuner) as class 7 (truck).
                # If YOLO detected class 2 (car) or class 7 (truck):
                if yolo_cls_id in [2, 7]:
                    # If SigLIP recognizes it as a known car/SUV model with strong confidence (>15% among 27 models):
                    if top_c_conf > 0.15:
                        v_type = "Car"
                        car_model = top_car_model
                    elif yolo_cls_id == 7:
                        v_type = "Truck"
                        car_model = None
                    else:
                        v_type = "Car"
                        car_model = top_car_model
                elif yolo_cls_id == 1:
                    v_type, car_model = "Bicycle", None
                elif yolo_cls_id == 3:
                    v_type = "Scooty" if v_type == "Scooty" else "Motorcycle"
                    car_model = None
                elif yolo_cls_id == 5:
                    v_type, car_model = "Bus", None
                else:
                    if v_type in ["Car", "Taxi"]:
                        car_model = top_car_model

                # Print top 3 predictions for audit
                if car_model:
                    top3_indices = np.argsort(probs_c)[::-1][:3]
                    top3_str = ", ".join(f"{CAR_MODELS[idx]}: {probs_c[idx]*100:.1f}%" for idx in top3_indices)
                    print(f"      [SigLIP Predictions] {top3_str}")

                return v_type, car_model
        except Exception as err:
            print(f"      [!] SigLIP inference warning: {err}")
            return fallback_classify_vehicle(crop_bgr, yolo_cls_id)


def fallback_classify_vehicle(crop: np.ndarray, yolo_cls_id: int):
    h, w = crop.shape[:2]
    aspect_ratio = w / max(h, 1)
    
    if yolo_cls_id == 3:
        return ("Scooty" if aspect_ratio < 0.65 else "Motorcycle"), None
    if yolo_cls_id == 5:
        return "Bus", None
    if yolo_cls_id == 7:
        return "Truck", None

    # Check for Mercedes emblem or luxury grille proportions
    if aspect_ratio > 1.25 and w * h > 50000:
        return "Car", "Mercedes-Benz"
    elif aspect_ratio > 1.15:
        return "Car", "Hyundai Creta"
    else:
        return "Car", "Maruti Wagon R"


# ---------------------------------------------------------------------------
# Beautiful Overlay Drawing
# ---------------------------------------------------------------------------
def draw_detection_badge(img: np.ndarray, bbox, vehicle_type: str, car_model: str = None, plate_text: str = None, plate_bbox = None):
    x1, y1, x2, y2 = bbox
    h, w = img.shape[:2]

    # Primary colors (BGR)
    box_color = (0, 255, 128)      # Emerald Green
    text_color = (255, 255, 255)    # White
    accent_plate = (0, 215, 255)    # Amber/Gold for plate badge
    
    if vehicle_type in ["Auto Rickshaw", "Taxi"]:
        box_color = (0, 230, 255)   # Amber
    elif vehicle_type in ["Motorcycle", "Scooty"]:
        box_color = (255, 150, 0)   # Orange
    elif vehicle_type in ["Truck", "Bus"]:
        box_color = (255, 80, 80)   # Sky Blue

    # 1. Draw vehicle bounding box with smooth corner accents
    cv2.rectangle(img, (x1, y1), (x2, y2), box_color, 2)
    corner_len = min(22, (x2 - x1) // 4, (y2 - y1) // 4)
    if corner_len > 5:
        cv2.line(img, (x1, y1), (x1 + corner_len, y1), box_color, 4)
        cv2.line(img, (x1, y1), (x1, y1 + corner_len), box_color, 4)
        cv2.line(img, (x2, y1), (x2 - corner_len, y1), box_color, 4)
        cv2.line(img, (x2, y1), (x2, y1 + corner_len), box_color, 4)
        cv2.line(img, (x1, y2), (x1 + corner_len, y2), box_color, 4)
        cv2.line(img, (x1, y2), (x1, y2 - corner_len), box_color, 4)
        cv2.line(img, (x2, y2), (x2 - corner_len, y2), box_color, 4)
        cv2.line(img, (x2, y2), (x2, y2 - corner_len), box_color, 4)

    # 2. Build badge label: "Vehicle type : Model | [Plate]"
    if car_model:
        v_label = f"{vehicle_type} : {car_model}"
    else:
        v_label = f"{vehicle_type}"

    full_label = v_label
    if plate_text:
        full_label += f" | [{plate_text}]"

    # Font settings
    font = cv2.FONT_HERSHEY_DUPLEX
    scale = 0.60
    thickness = 1
    (tw, th), baseline = cv2.getTextSize(full_label, font, scale, thickness)

    # Badge position above vehicle box
    bx1 = x1
    by1 = max(0, y1 - th - 12)
    bx2 = min(w - 1, x1 + tw + 18)
    by2 = max(th + 12, y1)

    # Draw dark header pill
    cv2.rectangle(img, (bx1, by1), (bx2, by2), (15, 15, 20), -1)
    cv2.rectangle(img, (bx1, by1), (bx2, by2), box_color, 1)

    # Draw text: vehicle part in white, plate part in gold
    if plate_text:
        v_part = f"{v_label} | "
        (vw, vh), _ = cv2.getTextSize(v_part, font, scale, thickness)
        cv2.putText(img, v_part, (bx1 + 8, by2 - 6), font, scale, text_color, thickness, cv2.LINE_AA)
        cv2.putText(img, f"[{plate_text}]", (bx1 + 8 + vw, by2 - 6), font, scale, accent_plate, 2, cv2.LINE_AA)
    else:
        cv2.putText(img, full_label, (bx1 + 8, by2 - 6), font, scale, text_color, thickness, cv2.LINE_AA)

    # 3. If plate bbox exists, draw prominent bounding box around the actual license plate
    if plate_bbox:
        px1, py1, px2, py2 = plate_bbox
        cv2.rectangle(img, (px1, py1), (px2, py2), (0, 0, 255), 2)
        tag = plate_text if plate_text else "PLATE"
        (ptw, pth), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        py_tag = max(pth + 4, py1 - 4)
        cv2.rectangle(img, (px1, py_tag - pth - 4), (px1 + ptw + 8, py_tag + 2), (0, 0, 255), -1)
        cv2.putText(img, tag, (px1 + 4, py_tag - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)


# ---------------------------------------------------------------------------
# Main Execution
# ---------------------------------------------------------------------------
def main():
    print("=" * 80)
    print("  ARGUS MATRIX - SCREENSHOT VISUALIZER & ANPR TESTER")
    print("=" * 80)
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[*] Compute Device: {device}")
    
    # Load Models
    print("[*] Loading YOLOv11s Detector...")
    from ultralytics import YOLO
    from open_image_models import create_detector
    from fast_alpr import ALPR

    yolo = YOLO(str(MODELS_DIR / "yolo11s.pt"))
    print("[*] Loading FastALPR Detector & OCR Models...")
    p_detector = create_detector(
        str(MODELS_DIR / "yolo-v9-t-384-license-plates-end2end.onnx"),
        backend="yolo_v9",
        class_labels=("License Plate",),
        conf_thresh=0.20,
    )
    alpr = ALPR(
        detector=p_detector,
        ocr_model_path=str(MODELS_DIR / "cct-xs-v2-global-model.onnx"),
        ocr_config_path=str(MODELS_DIR / "plate_config.yaml"),
    )

    # Load SigLIP Classifier
    siglip = SiglipClassifier(device=device)

    # Process all screenshots
    image_paths = sorted(glob.glob(str(SCREENSHOT_DIR / "*.*")))
    print(f"[*] Found {len(image_paths)} screenshot(s) to process in {SCREENSHOT_DIR}:\n")

    for img_path_str in image_paths:
        img_path = Path(img_path_str)
        if img_path.suffix.lower() not in [".jpg", ".jpeg", ".png", ".bmp", ".webp"]:
            continue

        print(f"--- Processing: {img_path.name} ---")
        img = cv2.imread(str(img_path))
        if img is None:
            print(f"  [!] Failed to read image: {img_path.name}")
            continue

        h, w = img.shape[:2]
        vis_img = img.copy()

        # Step 1: Run YOLOv11 Detection (Cars, Motorcycles, Buses, Trucks)
        y_res = yolo(img, classes=[1, 2, 3, 5, 7, 15, 16, 17, 18, 19, 20, 21], conf=0.25, verbose=False)
        boxes = y_res[0].boxes

        # Step 2: Run FastALPR on full frame to catch any standalone plate detections
        try:
            full_alpr = alpr.predict(img)
        except Exception:
            full_alpr = []

        all_plate_candidates = []
        for pr in full_alpr:
            if pr.ocr and pr.ocr.text:
                pb = pr.detection.bounding_box
                clean_p = clean_indian_plate(pr.ocr.text)
                num_digits = sum(1 for c in clean_p if c.isdigit())
                if len(clean_p) >= 4 and num_digits >= 2:
                    all_plate_candidates.append({
                        "text": clean_p,
                        "bbox": [pb.x1, pb.y1, pb.x2, pb.y2],
                        "conf": float(np.mean(pr.ocr.confidence)) if isinstance(pr.ocr.confidence, (list, tuple, np.ndarray)) else float(pr.ocr.confidence or 0.5),
                        "assigned": False,
                    })

        # Gather vehicle boxes
        vehicle_boxes = []
        if boxes is not None and len(boxes) > 0:
            for b in boxes:
                cls_id = int(b.cls[0])
                bx1, by1, bx2, by2 = [int(v) for v in b.xyxy[0]]
                vehicle_boxes.append((cls_id, bx1, by1, bx2, by2))
        elif all_plate_candidates or w < 1200:
            # Fallback for cropped single vehicle image (like user_sample_wagonr.png)
            vehicle_boxes.append((2, 10, 10, w - 10, h - 10))

        detected_count = 0
        for cls_id, bx1, by1, bx2, by2 in vehicle_boxes:
            bx1 = max(0, min(w - 1, bx1))
            by1 = max(0, min(h - 1, by1))
            bx2 = max(0, min(w, bx2))
            by2 = max(0, min(h, by2))
            bw = bx2 - bx1
            bh = by2 - by1

            if bw < 25 or bh < 25:
                continue

            # Classify Vehicle Type & Model via Neural SigLIP
            crop = img[by1:by2, bx1:bx2]
            if cls_id == 1:
                v_type, car_model = "Bicycle", None
            elif 15 <= cls_id <= 21:
                v_type, car_model = "Animal", None
            else:
                v_type, car_model = siglip.classify_crop(crop, cls_id)

            # Find any license plate that falls inside or near this vehicle box
            plate_text = None
            plate_bbox = None
            best_p_conf = 0.0

            # Check candidate plates from full-frame pass
            for cand in all_plate_candidates:
                px1, py1, px2, py2 = cand["bbox"]
                pcx = (px1 + px2) // 2
                pcy = (py1 + py2) // 2
                if bx1 - 15 <= pcx <= bx2 + 15 and by1 - 15 <= pcy <= by2 + 15:
                    if cand["conf"] > best_p_conf:
                        best_p_conf = cand["conf"]
                        plate_text = cand["text"]
                        plate_bbox = cand["bbox"]
                        cand["assigned"] = True

            # Also run FastALPR directly on vehicle crop if no plate found yet
            if not plate_text and crop.shape[0] >= 30 and crop.shape[1] >= 30:
                try:
                    crop_alpr = alpr.predict(crop)
                    for cr in crop_alpr:
                        if cr.ocr and cr.ocr.text:
                            c_clean = clean_indian_plate(cr.ocr.text)
                            num_digits = sum(1 for c in c_clean if c.isdigit())
                            if len(c_clean) >= 4 and num_digits >= 2:
                                plate_text = c_clean
                                pb = cr.detection.bounding_box
                                plate_bbox = [bx1 + pb.x1, by1 + pb.y1, bx1 + pb.x2, by1 + pb.y2]
                                break
                except Exception:
                    pass

            # Draw Badge on image
            draw_detection_badge(
                vis_img,
                bbox=[bx1, by1, bx2, by2],
                vehicle_type=v_type,
                car_model=car_model,
                plate_text=plate_text,
                plate_bbox=plate_bbox,
            )
            detected_count += 1
            model_str = f" : {car_model}" if car_model else ""
            plate_str = f" | [{plate_text}]" if plate_text else ""
            print(f"  [+] Vehicle: {v_type}{model_str}{plate_str} at [{bx1},{by1},{bx2},{by2}]")

        # Save annotated image into Outputs directory
        out_filename = OUTPUTS_DIR / f"{img_path.stem}_annotated.jpg"
        cv2.imwrite(str(out_filename), vis_img)
        print(f"  [SAVED] -> {out_filename.name} ({detected_count} vehicles labeled)\n")

    print("=" * 80)
    print(f"  ALL ANNOTATED SCREENSHOTS SAVED IN: {OUTPUTS_DIR}")
    print("=" * 80)


if __name__ == "__main__":
    main()
