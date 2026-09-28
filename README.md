# Tactical AI Surveillance & Reconnaissance Console

A real-time, military-grade surveillance operations dashboard built with **Next.js 16 (React 19)**, **Tailwind CSS**, and a high-performance **Python/ONNX live inference backend**. The system provides multi-camera monitoring, real-time object detection, multi-object tracking (ByteTrack), automatic number plate recognition (ANPR), and dynamic spatial analytics (tripwire counting and intrusion zones).

---

## 🚀 Key Features

* **Multi-Camera Tactical Wall:** Monitor up to 12 simultaneous video feeds in customizable grid configurations (4, 6, 9, 12 layout tiles).
* **Live AI Inference Pipeline (`run_live`):**
  * **Primary Object Detection:** YOLOv8/YOLO11 ONNX inference for vehicles, persons, animals, and tactical objects.
  * **Multi-Object Tracking:** Real-time ByteTrack tracking with ID persistence across occlusions.
  * **High-Speed ANPR Cascade:** Vehicle plate localization + Fast-Plate-OCR with intelligent track caching and frame throttling.
  * **Spatial Analytics:** Interactive tripwire line-crossing (traffic counting) and polygon intrusion perimeter monitoring.
  * **Zero Precompute Dependency:** Fully standalone real-time execution directly on incoming video feeds.
* **Instant Inference Toggle:** Disable/enable AI models per camera on the fly with **0% wasted compute** on disabled feeds.
* **Interactive Geometry Calibration:** Calibrate and move tripwires and polygon boundaries directly on the live camera canvas in real time.
* **Lightweight Mock Replay Mode (`run_mock`):** Instantly simulate full operational feeds using precomputed metadata without requiring GPU or model computation.

---

## 📋 System Requirements

* **Node.js:** v18.0.0 or higher (v20+ recommended)
* **npm:** v9.0.0 or higher (or pnpm / yarn)
* **Python:** 3.10 – 3.13
* **OS:** Windows 10/11, Linux (Ubuntu 20.04+), or macOS
* **Hardware:** Any modern multi-core CPU. NVIDIA GPU with CUDA recommended for real-time live inference on multiple 4K streams (CPU fallback supported).

---

## ⚡ Quick Start Guide

Running the project requires starting two processes: the **Python Backend** and the **Next.js Frontend**.

### Step 1: Clone & Frontend Setup

```bash
# Clone the repository
git clone https://github.com/OnekByte-Labs/Prototype_IA.git
cd Prototype_IA

# Install Node dependencies
npm install
```

---

### Step 2: Python Backend Environment Setup

#### Windows (PowerShell / Command Prompt):
```powershell
# Create Python virtual environment inside backend/
python -m venv backend/venv

# Activate virtual environment
# In PowerShell:
.\backend\venv\Scripts\Activate.ps1
# In CMD:
.\backend\venv\Scripts\activate.bat

# Upgrade pip and install dependencies
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
```

#### Linux / macOS:
```bash
# Create Python virtual environment
python3 -m venv backend/venv

# Activate virtual environment
source backend/venv/bin/activate

# Upgrade pip and install dependencies
pip install --upgrade pip
pip install -r backend/requirements.txt
```

> **Note for CPU-only systems (No NVIDIA CUDA GPU):**  
> If your machine does not have an NVIDIA GPU or CUDA installed, install the CPU runtime:
> ```bash
> pip install onnxruntime
> ```

---

### Step 3: Launch the Application

You can run the backend in either **Live AI Mode** (real models running live) or **Mock Mode** (lightweight instant replay):

#### Mode A: Real-Time Live AI Inference (Recommended)

1. **Terminal 1 — Start Live Backend:**
   ```bash
   # Windows convenience shortcut:
   npm run live

   # Or manually with activated venv:
   python backend/src/run_live.py
   ```
   *The live backend will start on `http://127.0.0.1:5556`.*

2. **Terminal 2 — Start Frontend Dashboard:**
   ```bash
   npm run dev
   ```
   *The tactical UI dashboard will start on `http://localhost:3000`.*

---

#### Mode B: Fast Mock Replay Mode (Zero GPU / Ultra-Lightweight)

1. **Terminal 1 — Start Mock Backend:**
   ```bash
   # Windows convenience shortcut:
   npm run mock

   # Or manually with activated venv:
   python backend/src/run_mock.py
   ```
   *The mock backend will start on `http://127.0.0.1:5556`.*

2. **Terminal 2 — Start Frontend Dashboard:**
   ```bash
   npm run dev
   ```

---

### Step 4: Access the Console

Open your web browser and navigate to:
```
http://localhost:3000
```

* **Dashboard View:** Shows the live Camera Wall grid with telemetry, alerts, and active detections.
* **Cameras Console:** Click on any camera feed to view detailed telemetry, inspect license plates, toggle AI on/off, or calibrate tripwires and intrusion zones.
* **Analytics Calibration:** Switch boundary mode to `TRIPWIRE` or `INTRUSION ZONE` and click **"CALIBRATE BOUNDARY"** to drag coordinate points live on the camera canvas.

---

## 📁 Repository Structure

```
├── app/                        # Next.js App Router (pages & API proxy routes)
│   ├── api/cameras/            # Backend API proxy handlers
│   └── page.tsx                # Main application entrance
├── backend/                    # Python Backend
│   ├── configs/                # Configuration files
│   │   ├── classes.yaml        # Class labels & confidence mappings
│   │   ├── pipeline.yaml       # Model paths & spatial analytics geometry
│   │   └── streams.yaml        # Camera stream definitions & video paths
│   ├── requirements.txt        # Python package dependencies
│   └── src/                    # Python source code
│       ├── analytics/          # Tripwire and Intrusion Zone engines
│       ├── inference/          # YOLOv8, Plate Detector, and Plate OCR
│       ├── ingestion/          # Multi-threaded Video Readers
│       ├── output/             # FastAPI REST & SSE/MJPEG streaming server
│       ├── tracking/           # ByteTrack tracker implementation
│       ├── run_live.py         # Real-time multi-model live pipeline
│       └── run_mock.py         # Mock replay server
├── components/                 # React UI Components
│   └── gotham/                 # Tactical military design system components
│       ├── dashboard/          # CameraWall, AlertBar, VideoCanvas
│       └── cameras/            # CamerasConsole, StreamDetail, Calibration
├── Dataset/Test/               # Sample tactical and surveillance video files
├── models/                     # ONNX Models (YOLO11, Plate YOLO, OCR)
└── outputs/precomputed/        # Precomputed telemetry for mock replay
```

---


## 📄 License
Internal Prototype - Confidential. All rights reserved.
