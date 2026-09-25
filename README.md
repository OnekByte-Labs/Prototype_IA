# AI Surveillance Pipeline

A complete AI-powered video surveillance dashboard with real-time YOLO object detection, tracking, and License Plate Recognition (ANPR). 

This project consists of two parts:
1. **Frontend**: A modern Next.js React dashboard.
2. **Backend**: A high-performance Python pipeline that processes video streams with ONNX models and serves MJPEG feeds via a Flask server.

---

## 🚀 Getting Started

To run this project, you need to start both the Python backend and the Next.js frontend simultaneously.

### 1. Start the AI Backend (Python)

The backend handles all video decoding, AI inference (YOLO/OCR), and video streaming.

**On Windows:**
```bash
# 1. Activate the virtual environment
.\backend\venv\Scripts\activate

# 2. Run the pipeline
python backend\src\main.py
```

**On Mac / Linux:**
```bash
# 1. Activate the virtual environment
source backend/venv/bin/activate

# 2. Run the pipeline
python backend/src/main.py
```

*Note: The backend will start a Flask MJPEG streaming server on `http://localhost:5555`.*

### 2. Start the Frontend Dashboard (Next.js)

Open a **new terminal window** and run the Next.js development server:

```bash
# Install dependencies (only needed the first time)
npm install

# Start the dashboard
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the live dashboard.

---

## ⚙️ Configuration

- **Video Streams:** You can add or modify video feeds by editing `backend/configs/streams.yaml`.
- **AI Models:** The system uses YOLOv11 for primary detection and YOLOv8 for license plate cropping. ONNX models are stored in the `models/` directory.

## 🛑 Troubleshooting

- **Feeds are missing/lagging:** Ensure the Python backend is actively running. The Next.js frontend relies completely on the Python server for video streams.
- **Port conflicts:** If port 5555 or 3000 is already in use, you can modify the ports in `backend/src/output/server.py` and `package.json`.
