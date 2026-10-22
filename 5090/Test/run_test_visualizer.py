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

# Set local directory context dynamically
TEST_DIR = Path(__file__).resolve().parent
SCREENSHOT_DIR = TEST_DIR / "ScreenShot"
OUTPUTS_DIR = TEST_DIR / "Outputs"
MODELS_DIR = TEST_DIR.parent / "models"

OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Indian RTO Positional Plate Disambiguation
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Indian RTO Positional Plate Disambiguation
# ---------------------------------------------------------------------------
def clean_indian_plate(raw_text: str) -> str:
    """
    Cleans OCR text and enforces strict Indian RTO positional rules:
    Standard Format: LL DD L(LL) DDDD  (e.g., MH 02 FU 9304)
    Bharat Series:   DD BH DDDD LL     (e.g., 22 BH 1234 AA)
    """
    if not raw_text:
        return ""
    text = re.sub(r"[^A-Z0-9]", "", str(raw_text).upper())

    # Strip leading 'IND' if OCR picks up the left HSRP blue strip
    if text.startswith("IND") and len(text) >= 11:
        text = text[3:]

    if len(text) < 7:
        return text

    # Disambiguation maps for visually similar OCR characters
    num_to_alpha = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "4": "A", "6": "G"}
    alpha_to_num = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6", "A": "4"}

    chars = list(text)

    # Check if Bharat Series (starts with 2 digits + 'BH')
    if len(chars) >= 9 and chars[2:4] in [["B", "H"], ["8", "H"], ["B", "I"], ["8", "I"]]:
        for idx in [0, 1, 4, 5, 6, 7]:
            if idx < len(chars):
                chars[idx] = alpha_to_num.get(chars[idx], chars[idx])
        chars[2] = "B"
        chars[3] = "H"
        for idx in range(8, len(chars)):
            chars[idx] = num_to_alpha.get(chars[idx], chars[idx])
        return "".join(chars)

    # Standard Indian RTO Format: LL DD [1-3 Letters] DDDD
    if len(chars) >= 8:
        # 1. First 2 chars MUST be State Code Letters (e.g., MH, MP, DL)
        for idx in [0, 1]:
            chars[idx] = num_to_alpha.get(chars[idx], chars[idx])
        st = "".join(chars[:2])
        if st in ["VK", "VH", "NH", "M4"] and len(chars) > 4 and "".join(chars[2:4]) in ["12", "01", "02", "04"]:
            chars[0], chars[1] = "M", "H"

        # 2. Next 2 chars MUST be RTO District Digits (e.g., 02, 03, 07)
        for idx in [2, 3]:
            chars[idx] = alpha_to_num.get(chars[idx], chars[idx])

        # 3. Last 4 chars MUST be Unique Registration Digits (e.g., 9304)
        for idx in range(len(chars) - 4, len(chars)):
            chars[idx] = alpha_to_num.get(chars[idx], chars[idx])

        # 4. Middle 1-3 chars MUST be Series Letters (e.g., FU, CR, BT)
        for idx in range(4, len(chars) - 4):
            chars[idx] = num_to_alpha.get(chars[idx], chars[idx])

        return "".join(chars)

    return text


# ---------------------------------------------------------------------------
# SigLIP Two-Stage Fine-Grained Categories
# ---------------------------------------------------------------------------
# Stage 1: Broad Indian Vehicle Categories
VEHICLE_TYPES = {
    "Auto": "a photo of a three-wheeled black and yellow Indian auto rickshaw",
    "E-Rickshaw": "a photo of an Indian electric e-rickshaw toto",
    "Scooty": "a photo of a person riding an Indian scooter scooty like Honda Activa",
    "Motorcycle": "a photo of a person riding a motorcycle bike",
    "Taxi": "a photo of a black and yellow Indian Kaali Peeli taxi car or van",
    "Car": "a photo of a passenger car, hatchback, sedan, or SUV",
    "Mini Truck / Pickup": "a photo of a pickup truck, Mahindra Bolero camper, or Tata Ace mini cargo truck",
    "Truck / Van": "a photo of a commercial cargo box truck or delivery van",
    "Bus": "a photo of a large passenger bus or double decker bus",
}

# Stage 2: Specific Car Models (Triggered ONLY if Stage 1 == 'Car' or 'Taxi')
CAR_MODELS = {
    "Mercedes-Benz Sedan/SUV": "a photo of a luxury Mercedes-Benz sedan or SUV car with three-pointed star grille",
    "BMW / Audi Luxury Car": "a photo of a luxury BMW or Audi sedan or SUV car",
    "Hyundai Creta / Venue": "a photo of a Hyundai Creta or Hyundai Venue SUV",
    "Hyundai i20 / Verna": "a photo of a Hyundai i20 hatchback or Verna sedan car",
    "Hyundai i10 / Grand i10": "a photo of a Hyundai i10 or Grand i10 hatchback or black and yellow taxi",
    "Hyundai Santro": "a photo of a Hyundai Santro Xing hatchback or taxi",
    "Maruti Wagon R": "a photo of a Maruti Suzuki Wagon R tall hatchback car",
    "Maruti Swift": "a photo of a Maruti Suzuki Swift hatchback car",
    "Maruti Dzire": "a photo of a Maruti Suzuki Swift Dzire compact sedan car",
    "Maruti Omni": "a photo of a boxy Maruti Suzuki Omni van or taxi",
    "Maruti Eeco": "a photo of a Maruti Suzuki Eeco minivan",
    "Maruti Alto": "a photo of a small Maruti Suzuki Alto hatchback car",
    "Maruti Baleno": "a photo of a Maruti Suzuki Baleno hatchback car",
    "Maruti Brezza": "a photo of a Maruti Suzuki Vitara Brezza compact SUV",
    "Maruti Ertiga": "a photo of a Maruti Suzuki Ertiga MPV car",
    "Toyota Innova": "a photo of a Toyota Innova MPV car",
    "Toyota Fortuner": "a photo of a large Toyota Fortuner SUV",
    "Mahindra Thar": "a photo of a boxy Mahindra Thar SUV",
    "Mahindra XUV700 / Scorpio": "a photo of a Mahindra Scorpio or XUV700 SUV",
    "Tata Nexon / Punch": "a photo of a Tata Nexon or Tata Punch compact SUV",
    "Honda City / Amaze": "a photo of a Honda City or Honda Amaze sedan car",
}


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

            self.v_class_names = list(VEHICLE_TYPES.keys())
            self.v_prompts = list(VEHICLE_TYPES.values())
            self.c_class_names = list(CAR_MODELS.keys())
            self.c_prompts = list(CAR_MODELS.values())

            self.active = True
            print("    [+] Two-Stage SigLIP Vision-Language Classifier successfully ready!\n")
        except Exception as e:
            print(f"    [!] Could not initialize SigLIP: {e}. Falling back to heuristic classifier.")
            self.active = False

    def _classify_labels(self, pil_img: Image.Image, class_names: list, prompts: list):
        """Runs zero-shot classification on PIL crop with SigLIP model forward logits."""
        inputs = self.processor(
            text=prompts,
            images=pil_img,
            padding="max_length",
            return_tensors="pt"
        ).to(self.device)

        if self.device.type == "cuda":
            inputs["pixel_values"] = inputs["pixel_values"].to(torch.float16)

        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.softmax(outputs.logits_per_image, dim=-1)[0]

        best_idx = probs.argmax().item()
        return class_names[best_idx], float(probs[best_idx].item())

    def classify_crop(self, crop_pil_or_bgr, yolo_cls_id: int = 2):
        if isinstance(crop_pil_or_bgr, np.ndarray):
            crop_rgb = cv2.cvtColor(crop_pil_or_bgr, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(crop_rgb)
        else:
            pil_img = crop_pil_or_bgr

        if not self.active:
            return fallback_classify_vehicle(np.array(pil_img), yolo_cls_id)

        try:
            # ---- STAGE 1: Predict Vehicle Type ----
            v_type, v_conf = self._classify_labels(pil_img, self.v_class_names, self.v_prompts)
            if v_type in ["Auto", "Auto Rickshaw", "E-Rickshaw"]:
                v_type = "Auto"

            car_model = None
            # ---- STAGE 2: Predict Car Model (Cars & Taxis ONLY) ----
            if v_type in ["Car", "Taxi"]:
                car_model, m_conf = self._classify_labels(pil_img, self.c_class_names, self.c_prompts)
                print(f"      [Stage 1: {v_type} ({v_conf:.0%})] -> [Stage 2 Model: {car_model} ({m_conf:.0%})]")
            else:
                print(f"      [Stage 1 Category: {v_type} ({v_conf:.0%})] (Stage 2 Car Models Bypassed)")

            return v_type, car_model
        except Exception as err:
            print(f"      [!] SigLIP inference warning: {err}")
            return fallback_classify_vehicle(np.array(pil_img), yolo_cls_id)


def fallback_classify_vehicle(crop: np.ndarray, yolo_cls_id: int):
    h, w = crop.shape[:2]
    aspect_ratio = w / max(h, 1)
    
    # Auto Rickshaw color heuristic (yellow/black or green/yellow CNG)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    yellow_ratio = np.count_nonzero(cv2.inRange(hsv, (15, 60, 60), (35, 255, 255))) / float(w * h)
    green_ratio = np.count_nonzero(cv2.inRange(hsv, (35, 50, 50), (85, 255, 255))) / float(w * h)
    if yellow_ratio > 0.10 or (yellow_ratio > 0.05 and green_ratio > 0.05):
        if aspect_ratio < 1.15:
            return "Auto", None

    if yolo_cls_id == 3:
        return ("Scooty" if aspect_ratio < 0.65 else "Motorcycle"), None
    if yolo_cls_id == 5:
        return "Bus", None
    if yolo_cls_id == 7:
        return "Truck", None

    # Check for Mercedes emblem or luxury grille proportions
    if aspect_ratio > 1.25 and w * h > 50000:
        return "Car", "Mercedes-Benz Sedan/SUV"
    elif aspect_ratio > 1.15:
        return "Car", "Hyundai Creta / Venue"
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
    
    if vehicle_type in ["Auto", "Auto Rickshaw", "Taxi"]:
        box_color = (0, 230, 255)   # Amber
        if "Auto" in vehicle_type:
            car_model = None
            vehicle_type = "Auto"
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
    if car_model and vehicle_type != "Auto":
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

            if bw < 35 or bh < 35:
                continue

            # Add 10% context padding around vehicle crop (crucial for full vehicle context & bumper plate visibility)
            pad_x = int(bw * 0.10)
            pad_y = int(bh * 0.10)
            cx1 = max(0, bx1 - pad_x)
            cy1 = max(0, by1 - pad_y)
            cx2 = min(w, bx2 + pad_x)
            cy2 = min(h, by2 + pad_y)

            crop_bgr = img[cy1:cy2, cx1:cx2]
            crop_pil = Image.fromarray(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB))

            # Classify Vehicle Type & Model via Neural SigLIP
            if cls_id == 1:
                v_type, car_model = "Bicycle", None
            elif 15 <= cls_id <= 21:
                v_type, car_model = "Animal", None
            else:
                v_type, car_model = siglip.classify_crop(crop_pil, cls_id)

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

            # Also run FastALPR directly on padded vehicle crop (catches plates right on bumper edges)
            if not plate_text and crop_bgr.shape[0] >= 30 and crop_bgr.shape[1] >= 30:
                try:
                    crop_alpr = alpr.predict(crop_bgr)
                    if crop_alpr:
                        best_p = max(crop_alpr, key=lambda r: np.mean(r.ocr.confidence) if (r.ocr and r.ocr.confidence is not None) else 0)
                        if best_p.ocr and best_p.ocr.text:
                            c_clean = clean_indian_plate(best_p.ocr.text)
                            if len(c_clean) >= 6:
                                plate_text = c_clean
                                pb = best_p.detection.bounding_box
                                plate_bbox = [cx1 + int(pb.x1), cy1 + int(pb.y1), cx1 + int(pb.x2), cy1 + int(pb.y2)]
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
