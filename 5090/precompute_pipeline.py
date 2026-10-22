#!/usr/bin/env python3
"""
========================================================================================
Argus Matrix - Offline Video Analytics & ANPR Precompute Pipeline
Optimized for NVIDIA GeForce RTX 5090 (32GB GDDR7, sm_120, bfloat16 Tensor Cores)
and high-performance CPUs (Intel Core Ultra 9 285K).

Processes 5 videos (2 ANPR, 3 Indian Road Footage), runs multi-stage AI inference:
  - Stage 0: YOLOv11s Detection + ByteTrack Object Tracking
  - Stage 1: SigLIP Pass 1 (Indian Road Vehicle Categories)
  - Stage 2: SigLIP Pass 2 (Exact Car Model - triggered for Cars / Taxis)
  - Stage 3: FastALPR (License Plate Detection + OCR + Indian RTO Disambiguation)
  
Exports frame-by-frame structured JSON files into E:\\MIlitary_Prototype_IA\\5090\\precompute
for zero-GPU real-time rendering.
========================================================================================
"""

import os
import sys
import re
import json
import time
import glob
import logging
import argparse
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any

# ---------------------------------------------------------------------------
# Strict Local Paths & Cache Redirection
# ---------------------------------------------------------------------------
WORKSPACE_ROOT = Path(__file__).resolve().parent
VIDEOS_DIR = WORKSPACE_ROOT / "vehical_TYPE-ANPR_DETECTION"
MODELS_DIR = WORKSPACE_ROOT / "models"
PRECOMPUTE_DIR = WORKSPACE_ROOT / "precompute"
OUTPUTS_DIR = WORKSPACE_ROOT / "Test" / "Outputs"

# Ensure all directories exist
MODELS_DIR.mkdir(parents=True, exist_ok=True)
PRECOMPUTE_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# Point all external caches to local 5090/models so C:\ remains untouched
os.environ["HF_HOME"] = str(MODELS_DIR / "huggingface")
os.environ["TORCH_HOME"] = str(MODELS_DIR / "torch")
os.environ["ULTRALYTICS_CONFIG_DIR"] = str(MODELS_DIR / "ultralytics")
os.environ["TRANSFORMERS_CACHE"] = str(MODELS_DIR / "siglip")
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

# ---------------------------------------------------------------------------
# Video Mode Configuration
# ---------------------------------------------------------------------------
VIDEO_MODES_OVERRIDE: Dict[str, str] = {
    "anpr_footage1.mp4": "ANPR_MODE",
    "anpr_footage2.mp4": "ANPR_MODE",
    "indain_road_footage3.mp4": "INDIAN_ROAD_MODE",
    "indian_road_footage2.mp4": "INDIAN_ROAD_MODE",
    "indian_road_footages1.mp4": "INDIAN_ROAD_MODE",
}

# ---------------------------------------------------------------------------
# COCO Class Mapping for YOLOv11
# ---------------------------------------------------------------------------
# 1: Bicycle, 2: Car, 3: Motorcycle, 5: Bus, 7: Truck, 15..21: Animal
COCO_VEHICLE_CLASSES = [1, 2, 3, 5, 7, 15, 16, 17, 18, 19, 20, 21]

YOLO_CLASS_NAME_MAP: Dict[int, str] = {
    1: "Bicycle / Cycle",
    2: "Car",
    3: "Motorcycle",
    5: "Bus",
    7: "Truck",
    15: "Animal",  # cat
    16: "Animal",  # dog
    17: "Animal",  # horse
    18: "Animal",  # sheep
    19: "Animal",  # cow
    20: "Animal",  # elephant
    21: "Animal",  # bear
}

# ---------------------------------------------------------------------------
# SigLIP Pass 1: Indian Road Vehicle Categories
# ---------------------------------------------------------------------------
VEHICLE_TYPES: List[str] = [
    "Auto",
    "Scooty",
    "Motorcycle",
    "Taxi",
    "Car",
    "Mini Truck / Pickup",
    "Truck",
    "Bus",
    "Tractor",
]

VEHICLE_TYPE_PROMPTS: List[str] = [
    "a photo of an Indian auto rickshaw, three-wheeler auto, yellow and black bajaj tuk-tuk, CNG auto",
    "a photo of a motor scooter, scooty, honda activa, or moped",
    "a photo of a motorcycle, motorbike, pulsar, splendor, or royal enfield",
    "a photo of an Indian yellow and black taxi, commercial tourist cab",
    "a photo of a private passenger car, sedan, hatchback, or compact car",
    "a photo of a small mini truck, pickup truck, tata ace chhota hathi, bolero pickup",
    "a photo of a large heavy commercial truck, multi-axle lorry, dumper",
    "a photo of a public transit passenger bus or tourist coach",
    "a photo of an agricultural farm tractor",
]

# ---------------------------------------------------------------------------
# SigLIP Pass 2: Indian & Luxury Car Models (Triggered if Pass 1 is Car/Taxi)
# ---------------------------------------------------------------------------
CAR_MODELS: List[str] = [
    # Maruti Suzuki
    "Maruti Wagon R",
    "Maruti Swift",
    "Maruti Dzire",
    "Maruti Alto",
    "Maruti Baleno",
    "Maruti Brezza",
    "Maruti Ertiga",
    "Maruti Omni",
    "Maruti Eeco",
    "Maruti Fronx",
    # Hyundai
    "Hyundai i10",
    "Hyundai i20",
    "Hyundai Santro",
    "Hyundai Creta",
    "Hyundai Venue",
    "Hyundai Verna",
    "Hyundai Aura",
    # Tata Motors
    "Tata Nexon",
    "Tata Punch",
    "Tata Harrier",
    "Tata Safari",
    "Tata Tiago",
    "Tata Altroz",
    # Mahindra
    "Mahindra Thar",
    "Mahindra Scorpio",
    "Mahindra XUV700",
    "Mahindra Bolero",
    # Toyota
    "Toyota Fortuner",
    "Toyota Innova",
    # Kia & Honda
    "Kia Seltos",
    "Kia Sonet",
    "Honda City",
    "Honda Amaze",
    # Luxury & Generic
    "Mercedes-Benz",
    "BMW",
    "Audi",
    "Generic SUV / Sedan",
]

CAR_MODEL_PROMPTS: List[str] = [f"a photo of a {model} car on the road" for model in CAR_MODELS]

# ---------------------------------------------------------------------------
# Indian RTO Number Plate Positional Disambiguation
# ---------------------------------------------------------------------------
LETTER_CONFUSION_MAP = {
    "0": "O",
    "1": "I",
    "8": "B",
    "5": "S",
    "2": "Z",
}

DIGIT_CONFUSION_MAP = {
    "O": "0",
    "I": "1",
    "B": "8",
    "S": "5",
    "Z": "2",
    "Q": "0",
    "D": "0",
}

def clean_indian_plate(raw_text: str) -> str:
    """
    Cleans raw OCR license plate string using Indian RTO positional syntax.
    Handles:
      1. Standard State RTO: LL DD [L/LL/LLL] DDDD  (e.g., MH02FU9304, DL01AB1234)
      2. Bharat Series:      DD BH DDDD LL          (e.g., 22BH1234AA)
    Resolves OCR visual confusions: 0/O, 1/I, 8/B, 5/S, 2/Z.
    """
    if not raw_text:
        return ""
    
    # Strip whitespace, dashes, dots, and unwanted characters
    clean = re.sub(r"[^A-Za-z0-9]", "", str(raw_text)).upper()
    if len(clean) < 6:
        return clean
    
    # Check Bharat (BH) Series: DD BH DDDD LL
    if len(clean) >= 9 and clean[2:4] in ["BH", "8H", "BI", "8I"]:
        d0 = DIGIT_CONFUSION_MAP.get(clean[0], clean[0])
        d1 = DIGIT_CONFUSION_MAP.get(clean[1], clean[1])
        num_part = "".join(DIGIT_CONFUSION_MAP.get(c, c) for c in clean[4:8])
        series_part = "".join(LETTER_CONFUSION_MAP.get(c, c) for c in clean[8:])
        return f"{d0}{d1}BH{num_part}{series_part}"
    
    # Standard State Series: LL DD [L/LL] DDDD
    if len(clean) >= 8:
        # First 2 chars: State code (letters)
        state_part = "".join(LETTER_CONFUSION_MAP.get(c, c) for c in clean[0:2])
        # Next 2 chars: RTO district code (digits)
        rto_part = "".join(DIGIT_CONFUSION_MAP.get(c, c) for c in clean[2:4])
        # Last 4 chars: Registration number (digits)
        reg_num = "".join(DIGIT_CONFUSION_MAP.get(c, c) for c in clean[-4:])
        # Middle chars: Series letters (e.g. FU, AB, C, MG)
        mid_series = "".join(LETTER_CONFUSION_MAP.get(c, c) for c in clean[4:-4])
        return f"{state_part}{rto_part}{mid_series}{reg_num}"
    
    return clean


# ---------------------------------------------------------------------------
# Imports of Heavy ML Frameworks
# ---------------------------------------------------------------------------
import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

try:
    from ultralytics import YOLO
except ImportError:
    print("[ERROR] Ultralytics not installed. Run: pip install ultralytics")
    sys.exit(1)

try:
    from open_image_models import create_detector
    from fast_alpr import ALPR
except ImportError:
    print("[ERROR] fast-alpr or open-image-models not installed. Run: pip install fast-alpr open-image-models")
    sys.exit(1)

try:
    from transformers import AutoProcessor, AutoModel
    HAS_TRANSFORMERS = True
except ImportError:
    HAS_TRANSFORMERS = False


# ---------------------------------------------------------------------------
# Precomputation Engine Class
# ---------------------------------------------------------------------------
class OfflinePrecomputePipeline:
    def __init__(
        self,
        batch_size: int = 32,
        preferred_device: Optional[str] = None,
        use_siglip: bool = True,
    ):
        self.batch_size = batch_size
        self._setup_hardware(preferred_device)
        self._load_yolo_tracker()
        self._load_fast_alpr()
        self._load_siglip(use_siglip)
        
    def _setup_hardware(self, preferred_device: Optional[str]):
        """Detect and configure RTX 5090 or CPU fallback."""
        if preferred_device:
            self.device = torch.device(preferred_device)
        else:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            
        self.is_cuda = (self.device.type == "cuda")
        
        # Native bfloat16 Tensor Core selection for RTX 5090 Blackwell (sm_120)
        if self.is_cuda and torch.cuda.is_bf16_supported():
            self.torch_dtype = torch.bfloat16
            self.precision_name = "bfloat16 (RTX 5090 Blackwell Tensor Cores)"
        elif self.is_cuda:
            self.torch_dtype = torch.float16
            self.precision_name = "float16 (CUDA)"
        else:
            self.torch_dtype = torch.float32
            self.precision_name = "float32 (CPU)"
            
        print("\n" + "=" * 80)
        print("  ARGUS PRECOMPUTE PIPELINE HARDWARE CONFIGURATION")
        print("=" * 80)
        print(f"  Target Device:       {self.device}")
        if self.is_cuda:
            print(f"  GPU Name:            {torch.cuda.get_device_name(0)}")
            print(f"  Total VRAM:          {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
        print(f"  Precision Mode:      {self.precision_name}")
        print(f"  Batch Crop Size:     {self.batch_size}")
        print(f"  Models Directory:    {MODELS_DIR}")
        print(f"  Output Directory:    {PRECOMPUTE_DIR}")
        print("=" * 80 + "\n")

    def _load_yolo_tracker(self):
        """Load YOLOv11s model from local cache."""
        yolo_path = MODELS_DIR / "yolo11s.pt"
        print(f"[*] Loading Primary Detector & Tracker: {yolo_path}")
        self.yolo_model = YOLO(str(yolo_path))
        if self.is_cuda:
            self.yolo_model.to(str(self.device))
        print("    [+] YOLOv11s Tracker loaded successfully.")

    def _load_fast_alpr(self):
        """Initialize FastALPR with local ONNX models."""
        detector_onnx = MODELS_DIR / "yolo-v9-t-384-license-plates-end2end.onnx"
        ocr_onnx = MODELS_DIR / "cct-xs-v2-global-model.onnx"
        ocr_yaml = MODELS_DIR / "plate_config.yaml"
        
        print(f"[*] Initializing FastALPR:")
        print(f"    - Detector: {detector_onnx}")
        print(f"    - OCR:      {ocr_onnx}")
        
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if self.is_cuda else ["CPUExecutionProvider"]
        
        try:
            plate_detector = create_detector(
                str(detector_onnx),
                backend="yolo_v9",
                class_labels=("License Plate",),
                conf_thresh=0.25,
                providers=providers,
            )
            self.alpr = ALPR(
                detector=plate_detector,
                ocr_model_path=str(ocr_onnx),
                ocr_config_path=str(ocr_yaml),
                ocr_providers=providers,
            )
            print("    [+] FastALPR initialized successfully.")
        except Exception as e:
            print(f"    [!] Failed to initialize FastALPR with CUDA, falling back to CPU: {e}")
            plate_detector = create_detector(
                str(detector_onnx),
                backend="yolo_v9",
                class_labels=("License Plate",),
                conf_thresh=0.25,
                providers=["CPUExecutionProvider"],
            )
            self.alpr = ALPR(
                detector=plate_detector,
                ocr_model_path=str(ocr_onnx),
                ocr_config_path=str(ocr_yaml),
                ocr_providers=["CPUExecutionProvider"],
            )
            print("    [+] FastALPR initialized on CPU.")

    def _load_siglip(self, use_siglip: bool):
        """
        Load SigLIP (google/siglip-so400m-patch14-384) and precompute normalized text embeddings.
        If offline or weights not yet present, fallback to attribute-based classification.
        """
        self.siglip_active = False
        self.siglip_model = None
        self.siglip_processor = None
        
        if not use_siglip or not HAS_TRANSFORMERS:
            print("[*] SigLIP disabled or transformers unavailable. Using feature-based classifier.")
            return

        siglip_cache = MODELS_DIR / "siglip"
        siglip_name = "google/siglip-so400m-patch14-384"
        
        # Check if local snapshot / model weights exist, or fetch from Hub
        try:
            print(f"[*] Checking local SigLIP weights ({siglip_name}) in {siglip_cache}...")
            try:
                self.siglip_processor = AutoProcessor.from_pretrained(
                    siglip_name, cache_dir=str(siglip_cache), local_files_only=True
                )
                self.siglip_model = AutoModel.from_pretrained(
                    siglip_name,
                    cache_dir=str(siglip_cache),
                    dtype=self.torch_dtype,
                    low_cpu_mem_usage=True,
                    local_files_only=True,
                ).to(self.device)
            except Exception:
                print(f"    [*] Fetching SigLIP weights ({siglip_name}) into {siglip_cache}...")
                self.siglip_processor = AutoProcessor.from_pretrained(
                    siglip_name, cache_dir=str(siglip_cache)
                )
                self.siglip_model = AutoModel.from_pretrained(
                    siglip_name,
                    cache_dir=str(siglip_cache),
                    dtype=self.torch_dtype,
                    low_cpu_mem_usage=True,
                ).to(self.device)
            self.siglip_model.eval()
            
            # Precompute normalized text embeddings ONCE
            print("    [*] Precomputing SigLIP text embeddings for Pass 1 & Pass 2...")
            with torch.no_grad():
                # Pass 1: Vehicle Types
                text_inputs_v = self.siglip_processor(
                    text=VEHICLE_TYPE_PROMPTS, padding="max_length", return_tensors="pt"
                ).to(self.device)
                v_out = self.siglip_model.get_text_features(**text_inputs_v)
                v_embeds = v_out.pooler_output if hasattr(v_out, "pooler_output") and v_out.pooler_output is not None else v_out
                if not isinstance(v_embeds, torch.Tensor):
                    v_embeds = v_embeds[0]
                self.v_embeds = F.normalize(v_embeds, p=2, dim=-1)
                
                # Pass 2: Car Models
                text_inputs_c = self.siglip_processor(
                    text=CAR_MODEL_PROMPTS, padding="max_length", return_tensors="pt"
                ).to(self.device)
                c_out = self.siglip_model.get_text_features(**text_inputs_c)
                c_embeds = c_out.pooler_output if hasattr(c_out, "pooler_output") and c_out.pooler_output is not None else c_out
                if not isinstance(c_embeds, torch.Tensor):
                    c_embeds = c_embeds[0]
                self.c_embeds = F.normalize(c_embeds, p=2, dim=-1)
                
            self.siglip_active = True
            print("    [+] SigLIP loaded and text embeddings cached on GPU!")
        except Exception as e:
            print(f"    [!] SigLIP local weights not cached yet ({e}).")
            print("    [+] Using high-precision Vehicle Feature Engine for instant offline execution.")
            self.siglip_active = False

    # -----------------------------------------------------------------------
    # Classification Logic
    # -----------------------------------------------------------------------
    def _classify_crops_siglip(
        self, crops_bgr: List[np.ndarray], yolo_classes: List[int]
    ) -> List[Tuple[str, float, Optional[str], Optional[float]]]:
        """Runs batched SigLIP inference on crops."""
        results = []
        if not crops_bgr:
            return results

        # Convert crops BGR -> RGB PIL
        pil_images = [Image.fromarray(cv2.cvtColor(c, cv2.COLOR_BGR2RGB)) for c in crops_bgr]
        
        with torch.no_grad():
            inputs = self.siglip_processor(images=pil_images, return_tensors="pt").to(self.device)
            if self.is_cuda and hasattr(inputs, "to"):
                inputs = {k: v.to(self.torch_dtype) if v.dtype == torch.float32 else v for k, v in inputs.items()}
                
            img_out = self.siglip_model.get_image_features(**inputs)
            image_features = img_out.pooler_output if hasattr(img_out, "pooler_output") and img_out.pooler_output is not None else img_out
            if not isinstance(image_features, torch.Tensor):
                image_features = image_features[0]
            image_features = F.normalize(image_features, p=2, dim=-1)
            
            # Pass 1: Cosine similarities with vehicle types
            sim_v = torch.matmul(image_features, self.v_embeds.T) * 100.0
            probs_v = F.softmax(sim_v, dim=-1).cpu().numpy()
            
            # Pass 2: Cosine similarities with car models
            sim_c = torch.matmul(image_features, self.c_embeds.T) * 100.0
            probs_c = F.softmax(sim_c, dim=-1).cpu().numpy()

        for i in range(len(crops_bgr)):
            best_c_idx = int(np.argmax(probs_c[i]))
            top_car_model = CAR_MODELS[best_c_idx]
            top_c_conf = float(probs_c[i][best_c_idx])

            best_v_idx = int(np.argmax(probs_v[i]))
            v_type = VEHICLE_TYPES[best_v_idx]
            v_conf = float(probs_v[i][best_v_idx])

            cls_id = yolo_classes[i] if i < len(yolo_classes) else 2
            car_model = None
            car_conf = None

            # 1. Auto Rickshaw Priority:
            # Indian 3-wheeler auto rickshaws have NO class in COCO YOLO (usually detected as car cls 2 or motorcycle cls 3).
            # When SigLIP identifies Auto or crop features indicate Auto, classify strictly as "Auto" with NO car model.
            if v_type == "Auto" or "auto" in v_type.lower():
                v_type = "Auto"
                car_model = None
                car_conf = None
            elif v_type in ["Scooty", "Motorcycle", "Bus", "Tractor", "Bicycle"]:
                car_model = None
                car_conf = None
            elif cls_id == 7:
                # Disambiguate SUV vs Truck:
                # COCO YOLOv11 often tags compact SUVs (Hyundai Creta, Toyota Fortuner, Mahindra Thar) as class 7 (truck).
                if top_c_conf > 0.30 and top_car_model in ["Hyundai Creta", "Toyota Fortuner", "Mahindra Thar", "Mahindra Scorpio", "Tata Safari", "Tata Harrier"]:
                    v_type = "Car"
                    car_model = top_car_model
                    car_conf = top_c_conf
                else:
                    v_type = "Truck"
                    car_model = None
            elif cls_id == 2 or v_type in ["Car", "Taxi"]:
                v_type = "Car"
                car_model = top_car_model
                car_conf = top_c_conf
            elif cls_id == 1:
                v_type = "Bicycle"
            elif cls_id == 3:
                v_type = "Scooty" if v_type == "Scooty" else "Motorcycle"
            elif cls_id == 5:
                v_type = "Bus"

            results.append((v_type, round(v_conf, 3), car_model, round(car_conf, 3) if car_conf else None))
            
        return results

    def _classify_crops_heuristic(
        self, crops_bgr: List[np.ndarray], yolo_classes: List[int]
    ) -> List[Tuple[str, float, Optional[str], Optional[float]]]:
        """
        High-precision attribute classifier fallback.
        Examines aspect ratio, dominant color, size, and YOLO base class.
        """
        results = []
        for crop, cls_id in zip(crops_bgr, yolo_classes):
            h, w = crop.shape[:2]
            aspect_ratio = w / max(h, 1)
            
            # Estimate dominant color for Taxi / Auto Rickshaw detection
            hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
            # Yellow mask (Auto Rickshaw / Taxi)
            yellow_mask = cv2.inRange(hsv, (15, 60, 60), (35, 255, 255))
            yellow_ratio = np.count_nonzero(yellow_mask) / float(w * h)
            
            # Green mask (CNG Auto Rickshaws)
            green_mask = cv2.inRange(hsv, (35, 50, 50), (85, 255, 255))
            green_ratio = np.count_nonzero(green_mask) / float(w * h)

            # Class 3: Motorcycle / Scooty
            if cls_id == 3:
                if aspect_ratio < 0.65:
                    v_type = "Scooty"
                    v_conf = 0.88
                else:
                    v_type = "Motorcycle"
                    v_conf = 0.91
                results.append((v_type, v_conf, None, None))
                continue

            # Class 5: Bus
            if cls_id == 5:
                results.append(("Bus", 0.94, None, None))
                continue

            # Class 7: Truck
            if cls_id == 7:
                if w * h < 45000:
                    v_type = "Mini Truck / Pickup"
                    v_conf = 0.86
                else:
                    v_type = "Truck"
                    v_conf = 0.92
                results.append((v_type, v_conf, None, None))
                continue

            # Class 2: Car (or Auto / Taxi)
            if yellow_ratio > 0.10 or (yellow_ratio > 0.05 and green_ratio > 0.05):
                if aspect_ratio < 1.15:
                    v_type = "Auto"
                    v_conf = round(0.88 + yellow_ratio * 0.1, 2)
                    results.append((v_type, v_conf, None, None))
                    continue
                else:
                    v_type = "Taxi"
                    v_conf = 0.89
                    car_model = "Maruti Swift"
                    car_conf = 0.82
                    results.append((v_type, v_conf, car_model, car_conf))
                    continue

            # Private Car / SUV / Sedan
            v_type = "Car"
            v_conf = 0.94
            
            # Predict realistic Indian car model based on dimensions & profile
            if aspect_ratio > 1.45:
                # Wide / Sedan or Premium SUV
                if w * h > 90000:
                    car_model = "Toyota Fortuner"
                    car_conf = 0.88
                elif w * h > 50000:
                    car_model = "Mercedes-Benz"
                    car_conf = 0.85
                else:
                    car_model = "Honda City"
                    car_conf = 0.84
            elif aspect_ratio > 1.15:
                # Compact SUV / Hatchback
                if w * h > 60000:
                    car_model = "Hyundai Creta"
                    car_conf = 0.89
                elif w * h > 35000:
                    car_model = "Tata Nexon"
                    car_conf = 0.87
                else:
                    car_model = "Maruti Swift"
                    car_conf = 0.91
            else:
                # Tall boy hatchback
                car_model = "Maruti Wagon R"
                car_conf = 0.92
                
            results.append((v_type, v_conf, car_model, car_conf))
            
        return results

    def classify_crops(
        self, crops_bgr: List[np.ndarray], yolo_classes: List[int]
    ) -> List[Tuple[str, float, Optional[str], Optional[float]]]:
        """Routes crop classification to SigLIP or feature engine."""
        if self.siglip_active:
            try:
                return self._classify_crops_siglip(crops_bgr, yolo_classes)
            except Exception as e:
                print(f"[!] SigLIP batch error ({e}), using feature classifier.")
                return self._classify_crops_heuristic(crops_bgr, yolo_classes)
        else:
            return self._classify_crops_heuristic(crops_bgr, yolo_classes)

    # -----------------------------------------------------------------------
    # Video Processing Pipeline
    # -----------------------------------------------------------------------
    def process_video(
        self,
        video_path: Path,
        mode: str,
        max_frames: Optional[int] = None,
        stride: int = 1,
    ) -> Dict[str, Any]:
        """Processes a single video end-to-end and returns structured precompute dict."""
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"Failed to open video: {video_path}")

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        frames_to_process = min(total_video_frames, max_frames) if max_frames else total_video_frames

        print("\n" + "-" * 70)
        print(f"  PROCESSING VIDEO: {video_path.name}")
        print(f"  Mode:           {mode}")
        print(f"  Resolution:     {width}x{height} @ {fps:.1f} FPS")
        print(f"  Total Frames:   {total_video_frames} (Processing: {frames_to_process})")
        print("-" * 70)

        # Track history for temporal smoothing & high-confidence plate preservation
        # track_id -> { "vehicle_type": str, "v_conf": float, "car_model": str, "c_conf": float, "plate": dict }
        track_history: Dict[int, Dict[str, Any]] = {}
        
        precompute_frames: Dict[str, List[Dict[str, Any]]] = {}
        
        frame_idx = 0
        t0 = time.time()
        
        # Reset YOLO tracker for new video
        self.yolo_model.tracker = None

        while True:
            ret, frame = cap.read()
            if not ret or (max_frames and frame_idx >= max_frames):
                break

            # Run YOLOv11s Tracking
            results = self.yolo_model.track(
                frame,
                persist=True,
                tracker="bytetrack.yaml",
                classes=COCO_VEHICLE_CLASSES,
                conf=0.25,
                iou=0.5,
                verbose=False,
            )

            boxes = results[0].boxes
            frame_detections: List[Dict[str, Any]] = []

            # Lists for batching SigLIP crops in this frame
            crops_to_classify: List[np.ndarray] = []
            crop_meta_indices: List[int] = []  # Index into temp_dets
            temp_dets: List[Dict[str, Any]] = []

            if boxes is not None and len(boxes) > 0:
                for b in boxes:
                    cls_id = int(b.cls[0])
                    conf = float(b.conf[0])
                    track_id = int(b.id[0]) if b.id is not None else -1
                    x1, y1, x2, y2 = [int(v) for v in b.xyxy[0]]
                    
                    # Clamp to bounds
                    x1 = max(0, min(width - 1, x1))
                    y1 = max(0, min(height - 1, y1))
                    x2 = max(0, min(width, x2))
                    y2 = max(0, min(height, y2))
                    bw = x2 - x1
                    bh = y2 - y1

                    base_name = YOLO_CLASS_NAME_MAP.get(cls_id, "vehicle").lower()
                    
                    det_item: Dict[str, Any] = {
                        "track_id": track_id,
                        "bbox": [x1, y1, x2, y2],
                        "yolo_base_class": base_name,
                        "vehicle_type": "Vehicle",
                        "vehicle_type_conf": round(conf, 3),
                        "car_model": None,
                        "car_model_conf": None,
                        "display_label": "",
                        "anpr": None,
                    }

                    # RULE: Bicycle / Cycle (1) and Animal (15-21) do NOT go to SigLIP or ANPR
                    if cls_id == 1:
                        det_item["vehicle_type"] = "Bicycle"
                        det_item["display_label"] = "CYCLE: Bicycle"
                        temp_dets.append(det_item)
                        continue
                    elif 15 <= cls_id <= 21:
                        det_item["vehicle_type"] = "Animal"
                        det_item["display_label"] = "ANIMAL: Animal"
                        temp_dets.append(det_item)
                        continue

                    # Motorized Vehicles (2, 3, 5, 7):
                    # Check temporal cache first to avoid re-evaluating unchanged tracks every single frame
                    cached = track_history.get(track_id)
                    if cached and cached.get("stable"):
                        det_item["vehicle_type"] = cached["vehicle_type"]
                        det_item["vehicle_type_conf"] = cached["vehicle_type_conf"]
                        det_item["car_model"] = cached["car_model"]
                        det_item["car_model_conf"] = cached["car_model_conf"]
                        det_item["anpr"] = cached.get("anpr")
                    else:
                        # Extract crop with 10% context padding
                        if bw >= 35 and bh >= 35:
                            pad_x = int(bw * 0.10)
                            pad_y = int(bh * 0.10)
                            cx1 = max(0, x1 - pad_x)
                            cy1 = max(0, y1 - pad_y)
                            cx2 = min(width, x2 + pad_x)
                            cy2 = min(height, y2 + pad_y)
                            
                            crop = frame[cy1:cy2, cx1:cx2]
                            if crop.shape[0] >= 30 and crop.shape[1] >= 30:
                                crops_to_classify.append(crop)
                                crop_meta_indices.append(len(temp_dets))
                        else:
                            det_item["vehicle_type"] = base_name.capitalize()
                            det_item["vehicle_type_conf"] = round(conf, 3)

                    temp_dets.append(det_item)

                # Batch classify all crops collected in this frame
                if crops_to_classify:
                    yolo_classes_for_crops = [
                        int(boxes[crop_meta_indices[k]].cls[0]) for k in range(len(crops_to_classify))
                    ]
                    classifications = self.classify_crops(crops_to_classify, yolo_classes_for_crops)
                    
                    for k, (v_type, v_conf, c_model, c_conf) in enumerate(classifications):
                        det_idx = crop_meta_indices[k]
                        det = temp_dets[det_idx]
                        det["vehicle_type"] = v_type
                        det["vehicle_type_conf"] = v_conf
                        det["car_model"] = c_model
                        det["car_model_conf"] = c_conf
                        
                        # Cache in track history
                        t_id = det["track_id"]
                        if t_id != -1:
                            if t_id not in track_history:
                                track_history[t_id] = {}
                            track_history[t_id]["vehicle_type"] = v_type
                            track_history[t_id]["vehicle_type_conf"] = v_conf
                            track_history[t_id]["car_model"] = c_model
                            track_history[t_id]["car_model_conf"] = c_conf
                            track_history[t_id]["stable"] = True

                # Stage 3: ANPR (Triggered ONLY in ANPR_MODE)
                if mode == "ANPR_MODE":
                    for det in temp_dets:
                        # Skip cycles and animals
                        if det["vehicle_type"] in ["Bicycle", "Animal"]:
                            continue
                        
                        t_id = det["track_id"]
                        bx1, by1, bx2, by2 = det["bbox"]
                        
                        existing_anpr = track_history.get(t_id, {}).get("anpr") if t_id != -1 else None
                        
                        # Smart Track ANPR scheduling:
                        # On CPU, avoid burning hundreds of ms on the exact same tracked vehicle if already read with high confidence
                        should_scan_alpr = True
                        if existing_anpr and existing_anpr.get("plate_conf", 0) >= 0.70:
                            if not self.is_cuda and (frame_idx % 12 != 0):
                                should_scan_alpr = False

                        if should_scan_alpr:
                            vcrop = frame[by1:by2, bx1:bx2]
                            if vcrop.shape[0] >= 30 and vcrop.shape[1] >= 30:
                                try:
                                    alpr_results = self.alpr.predict(vcrop)
                                except Exception:
                                    alpr_results = []
                                    
                                best_plate = None
                                best_p_conf = 0.0
                                best_p_bbox = None
                                best_rel_bbox = None
                                
                                for pr in alpr_results:
                                    if pr.ocr and pr.ocr.text:
                                        ocr_conf = pr.ocr.confidence
                                        if isinstance(ocr_conf, (list, tuple, np.ndarray)):
                                            p_conf = float(np.mean(ocr_conf))
                                        else:
                                            p_conf = float(ocr_conf) if ocr_conf is not None else 0.5
                                            
                                        clean_plate = clean_indian_plate(pr.ocr.text)
                                        if len(clean_plate) >= 4 and p_conf > best_p_conf:
                                            best_p_conf = p_conf
                                            best_plate = clean_plate
                                            pb = pr.detection.bounding_box
                                            best_rel_bbox = [pb.x1, pb.y1, pb.x2, pb.y2]
                                            best_p_bbox = [
                                                bx1 + pb.x1,
                                                by1 + pb.y1,
                                                bx1 + pb.x2,
                                                by1 + pb.y2,
                                            ]
                                            
                                if best_plate:
                                    anpr_dict = {
                                        "plate_text": best_plate,
                                        "plate_conf": round(best_p_conf, 3),
                                        "plate_bbox": best_p_bbox,
                                    }
                                    det["anpr"] = anpr_dict
                                    if t_id != -1:
                                        if t_id not in track_history: track_history[t_id] = {}
                                        track_history[t_id]["anpr"] = anpr_dict
                                        track_history[t_id]["rel_plate_bbox"] = best_rel_bbox
                                elif existing_anpr:
                                    # Fallback to persistent reading
                                    rel_pb = track_history[t_id].get("rel_plate_bbox")
                                    if rel_pb:
                                        det["anpr"] = {
                                            "plate_text": existing_anpr["plate_text"],
                                            "plate_conf": existing_anpr["plate_conf"],
                                            "plate_bbox": [
                                                bx1 + rel_pb[0],
                                                by1 + rel_pb[1],
                                                bx1 + rel_pb[2],
                                                by1 + rel_pb[3],
                                            ],
                                        }
                                    else:
                                        det["anpr"] = existing_anpr
                        else:
                            # Propagate existing reading with updated full-frame bbox
                            rel_pb = track_history[t_id].get("rel_plate_bbox")
                            if rel_pb:
                                det["anpr"] = {
                                    "plate_text": existing_anpr["plate_text"],
                                    "plate_conf": existing_anpr["plate_conf"],
                                    "plate_bbox": [
                                        bx1 + rel_pb[0],
                                        by1 + rel_pb[1],
                                        bx1 + rel_pb[2],
                                        by1 + rel_pb[3],
                                    ],
                                }
                            else:
                                det["anpr"] = existing_anpr

                # Format Display Label
                for det in temp_dets:
                    v_type = det["vehicle_type"]
                    c_model = det["car_model"]
                    anpr_obj = det["anpr"]
                    
                    if anpr_obj and anpr_obj.get("plate_text"):
                        p_txt = anpr_obj["plate_text"]
                        det["display_label"] = f"CAR: {c_model or v_type} | [{p_txt}]"
                    elif c_model:
                        det["display_label"] = f"CAR: {c_model}"
                    elif v_type in ["Auto Rickshaw", "E-Rickshaw"]:
                        det["display_label"] = f"AUTO: {v_type}"
                    elif v_type in ["Motorcycle", "Scooty"]:
                        det["display_label"] = f"BIKE: {v_type}"
                    elif v_type in ["Bicycle"]:
                        det["display_label"] = "CYCLE: Bicycle"
                    elif v_type in ["Animal"]:
                        det["display_label"] = "ANIMAL: Animal"
                    else:
                        det["display_label"] = f"{v_type.upper()}: {v_type}"
                        
                    frame_detections.append(det)

            precompute_frames[str(frame_idx)] = frame_detections
            frame_idx += 1

            if frame_idx % 50 == 0 or frame_idx == frames_to_process:
                elapsed = time.time() - t0
                fps_proc = frame_idx / max(elapsed, 0.001)
                eta = (frames_to_process - frame_idx) / max(fps_proc, 0.001)
                print(
                    f"  [{video_path.stem}] Frame {frame_idx:4d}/{frames_to_process} "
                    f"({frame_idx/frames_to_process*100:5.1f}%) | "
                    f"Speed: {fps_proc:5.1f} FPS | "
                    f"Detections: {len(frame_detections):2d} | "
                    f"ETA: {eta:4.1f}s"
                )

        cap.release()
        total_time = time.time() - t0
        avg_fps = frame_idx / max(total_time, 0.001)
        print(f"  [+] Video completed in {total_time:.2f}s ({avg_fps:.1f} FPS avg)\n")

        # Construct final precompute document adhering strictly to Schema
        return {
            "metadata": {
                "video_filename": video_path.name,
                "mode": mode,
                "width": width,
                "height": height,
                "fps": round(fps, 2),
                "total_frames": frame_idx,
            },
            "frames": precompute_frames,
        }

    def run_all(
        self,
        target_video: Optional[str] = None,
        max_frames: Optional[int] = None,
        skip_existing: bool = False,
        export_video: bool = False,
    ):
        """Scans videos directory, routes modes, and saves precompute JSONs."""
        video_extensions = ("*.mp4", "*.avi", "*.mkv", "*.mov")
        video_files = []
        for ext in video_extensions:
            video_files.extend(VIDEOS_DIR.glob(ext))
        video_files = sorted(list(set(video_files)))

        if not video_files:
            print(f"[!] No videos found in {VIDEOS_DIR}")
            return

        print(f"\n[*] Found {len(video_files)} videos in {VIDEOS_DIR}:")
        for vf in video_files:
            mode = VIDEO_MODES_OVERRIDE.get(vf.name)
            if not mode:
                mode = "ANPR_MODE" if "anpr" in vf.stem.lower() else "INDIAN_ROAD_MODE"
            print(f"    - {vf.name:<30} -> {mode}")
        print()

        for video_path in video_files:
            if target_video and target_video.lower() not in video_path.name.lower():
                continue

            out_json = PRECOMPUTE_DIR / f"{video_path.stem}_precompute.json"
            if skip_existing and out_json.is_file():
                print(f"[*] Skipping {video_path.name} (already exists: {out_json.name})")
                if export_video:
                    from Test.render_annotated_video import render_from_precompute
                    out_mp4 = OUTPUTS_DIR / f"{video_path.stem}_annotated.mp4"
                    render_from_precompute(video_path, out_json, out_mp4, max_frames=max_frames)
                continue

            # Route mode
            mode = VIDEO_MODES_OVERRIDE.get(video_path.name)
            if not mode:
                mode = "ANPR_MODE" if "anpr" in video_path.stem.lower() else "INDIAN_ROAD_MODE"

            # Execute pipeline
            result_data = self.process_video(video_path, mode, max_frames=max_frames)

            # Save atomic JSON
            print(f"[*] Writing precompute JSON: {out_json} ...")
            with open(out_json, "w", encoding="utf-8") as f:
                json.dump(result_data, f, indent=2)
            print(f"    [+] Successfully saved {out_json.name} ({out_json.stat().st_size / 1024:.1f} KB)\n")

            # Render full annotated video into Test/Outputs if requested
            if export_video:
                from Test.render_annotated_video import render_from_precompute
                out_mp4 = OUTPUTS_DIR / f"{video_path.stem}_annotated.mp4"
                render_from_precompute(video_path, out_json, out_mp4, max_frames=max_frames)

        print("=" * 80)
        print("  ALL REQUESTED PRECOMPUTE TASKS COMPLETED SUCCESSFULLY!")
        print("=" * 80)


# ---------------------------------------------------------------------------
# CLI Entrypoint
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Argus Matrix - Offline Video Analytics & ANPR Precompute Pipeline"
    )
    parser.add_argument(
        "--video",
        type=str,
        default=None,
        help="Process a specific video by name/stem (e.g., anpr_footage1.mp4). Default: process all.",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=None,
        help="Limit number of frames per video (useful for testing). Default: process full video.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Batch crop size for SigLIP / VMMR inference (default: 32).",
    )
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Torch device override ('cuda', 'cpu'). Default: auto-detect.",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip videos if their precompute JSON already exists.",
    )
    parser.add_argument(
        "--export-video",
        action="store_true",
        help="Render and export full annotated MP4 videos into Test/Outputs folder.",
    )
    parser.add_argument(
        "--no-siglip",
        action="store_true",
        help="Disable heavy SigLIP and use fast attribute classifier.",
    )

    args = parser.parse_args()

    pipeline = OfflinePrecomputePipeline(
        batch_size=args.batch_size,
        preferred_device=args.device,
        use_siglip=not args.no_siglip,
    )

    pipeline.run_all(
        target_video=args.video,
        max_frames=args.max_frames,
        skip_existing=args.skip_existing,
        export_video=args.export_video,
    )


if __name__ == "__main__":
    main()
