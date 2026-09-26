# Prototype IA - Tactical Surveillance Dashboard

A highly performant, tactical surveillance dashboard prototype built with Next.js and Python. It simulates a live AI security system by decoupling the heavy AI inference from the video playback, allowing 9 simultaneous 4K/1080p camera feeds to be rendered at 60 FPS in the browser with perfectly synchronized AI bounding boxes.

## 🏗 Architecture (The "Mock" Decoupled Pipeline)

Running YOLOv11 + License Plate OCR on 9 simultaneous 4K streams in real-time requires a massive server farm. For this prototype, we use a **Decoupled Architecture**:

1. **Precomputation (`precompute.py`)**: A Python script runs the heavy AI models (YOLOv11 + SORT Tracking + OCR) on the sample `.mp4` videos *once*, saving the frame-by-frame tracking coordinates into lightweight JSON files.
2. **Mock Server (`run_mock.py`)**: A lightweight Python ASGI server that simulates a live system by streaming those JSON coordinates over Server-Sent Events (SSE).
3. **Frontend (`CameraWall.tsx`)**: The Next.js dashboard plays the raw `.mp4` videos normally, while reading the SSE JSON stream and painting the tactical bounding boxes directly onto an invisible HTML5 `<canvas>` layered on top of the video in perfect synchronization.

---

## 🚀 Getting Started

Follow these steps to run the full prototype on your local Windows PC.

### Step 1: Precompute the AI Metadata
Before starting the servers, you must generate the AI tracking data for the videos. The script utilizes **Microsoft DirectML** to hardware-accelerate the ONNX models directly on your Intel Arc iGPU!

Open a terminal and run:
```powershell
backend\venv\Scripts\python backend\src\precompute.py
```
*Note: This will take some time (especially for the 4K video). It processes sequentially to prevent your iGPU from crashing. It saves the results to `backend/outputs/precomputed/`.*

### Step 2: Start the Mock AI Backend
Once the JSON files are generated, start the mock metadata server.

```powershell
backend\venv\Scripts\python backend\src\run_mock.py
```
*The mock server will start on `http://127.0.0.1:5556` and begin serving the precomputed metadata.*

### Step 3: Start the Next.js Dashboard
Open a **new terminal window** and start the frontend:

```powershell
# Install dependencies (only needed the first time)
npm install

# Start the dashboard
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The dashboard will automatically pull the MP4 videos and the SSE mock data, perfectly syncing them together with the bi-directional snap logic!

---

## ⚙️ Configuration

- **Video Streams:** Add or modify video feeds in `backend/configs/streams.yaml` and `prototype/configs/streams.yaml`.
- **Classes:** Define what objects you want YOLO to track (e.g., just cars and people) in `configs/classes.yaml`.

## 📡 Live Execution Mode (Optional)

If you have a powerful enough server (or if you are only running 1-2 cameras), you can run the system in completely **live** mode without precomputing. This streams the MJPEG video natively with the AI bounding boxes burned in.

```powershell
backend\venv\Scripts\python backend\src\run_live.py
```
*Note: This starts the live Flask server on `http://localhost:5555`.*
