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

## 🎛️ Runtime Detection Modes

Every camera runs **exactly one** detection pipeline, chosen by the operator at
runtime (Live Feed camera card → **Detection Mode**) — no restart, other cameras
unaffected. The active mode is shown on each camera card.

| Mode | Pipeline | Events |
|---|---|---|
| `none` | no inference (raw video) | — |
| `intrusion` | YOLO26n (persons) → tracker → camera restricted polygon | `PERIMETER_BREACH` (+ alert) |
| `anpr` | TrafficCamNet → tracker → LPDNet → LPRNet | `VEHICLE_OBSERVED`, `PLATE_READ` |
| `vehicle_counting` | TrafficCamNet → tracker → counting line / zone | `VEHICLE_COUNT` |
| `person_counting` | PeopleNet → tracker → counting line / zone | `PERSON_COUNT` |
| `anomaly` | YOLO26n → tracker → statistical baseline (see limits) | `ANOMALY` (+ alert) |

**Architecture.** Video sources are decoded once and fanned out to their cameras.
Inference worker processes each run a *Pipeline Manager* that owns one pipeline per
camera (`backend/src/pipelines/`), with a reference-counted model registry: a model
is loaded once per worker and unloaded when its last camera stops using it. A
switch detaches and stops the old pipeline (models released, tracker dropped)
before the new one starts; states are `idle · starting · running · stopping · error`.
Models run on ONNX Runtime + TensorRT FP16 (CUDA fallback); the NVIDIA TAO models
use DeepStream's DetectNet_v2 pre/post-processing.

**Source of truth.** `backend/data/command_center.db` (SQLite): each camera's mode,
its zone/line geometry, and every normalized event. `configs/cameras.yaml` only
seeds the database on first start.

**API**
```
PATCH /api/v1/cameras/{camera_id}/detection-mode   {"mode": "intrusion"}   → 202 (409 while switching)
GET   /api/v1/cameras                               cameras + mode + pipeline state
GET   /api/v1/pipelines/health                      per-camera fps/latency + loaded models
GET   /api/v1/events?camera_id=CAM-07&limit=100     normalized events from the database
WS    /api/v1/ws                                    pipeline_state / event / alert pushes
```
Normalized event fields: `camera_id, detection_mode, event_type, timestamp, track_id,
confidence, bounding_box, zone_id, vehicle_type, plate_text, plate_confidence`.
Only a camera's active pipeline can produce events (enforced in the worker and again
in the main process).

**Models** (`models/`): `yolo26n.onnx` (Ultralytics v8.4.0) and NVIDIA TAO models from
NGC in `models/tao/` — TrafficCamNet (pruned ONNX v1.0.4), PeopleNet (deployable
quantized ONNX v2.6.3), LPDNet (USA pruned v2.3.1), LPRNet (US, deployable ONNX v1.1).
First start builds TensorRT engines (minutes); they're cached in `backend/.trt_cache/`.

**Known limitations**
* **ANPR** uses NVIDIA's **US-plate** LPDNet/LPRNet. On the UK plates in the sample
  videos, plate localisation and reading are noticeably weaker (e.g. `KH05 ZZK` read as
  `KW05Z7K`); a region-appropriate LPD/LPR model is needed for production accuracy.
* **Anomaly Detection is a statistical baseline, not a learned anomaly model** (none
  exists in this repository). Per camera it learns normal behaviour online and flags
  `ABNORMAL_MOTION` (speed ≫ the camera's learned normal, robust median+k·MAD, in
  body-heights/s), `LOITERING` (a person staying in one area > 20 s),
  `CROWD_SURGE` (people count ≥ mean+3σ) and `UNUSUAL_OBJECT` (a class never seen
  during learning). It detects statistical outliers, **not intent or actions**
  (fights, theft, falls); needs a 60 s warm-up per start; its baseline is not
  persisted; looping demo clips make it converge on that clip; perspective and
  occlusion can distort speed estimates. Tunables are under `pipelines:` in
  `configs/pipeline.yaml`.
* Counting modes need a counting line (or zone) drawn per camera
  (camera panel → **Edit counting line**); without one they report in-view objects only.

---

## 📡 Live NVR / RTSP Ingest

Cameras CAM-01…CAM-20 are bound to NVR channels 1…20 (`nvr` / `channel` in
`configs/cameras.yaml`, seeded into the `cameras` table). With `ingest.profile: live`
(`configs/streams.yaml`) they ingest the live NVR instead of the recorded clips; the
detection pipelines, events, alerts, map and dashboard are unchanged.

```
NVR ──RTSP, 1 connection per channel──▶ MediaMTX (supervised by the backend)
          ├─▶ AI ingest: ffmpeg NVDEC (hevc/h264_cuvid) → 12.5 fps NV12 → pipelines → events → WebSocket
          └─▶ browser: WebRTC (WHEP via /api/live/{camera}/whep → backend proxy)
```

**Setup.** Put each NVR's own `CPPLUS_NVR_*` / `HIKVISION_NVR_*` (`HOST`, `PORT`, `USERNAME`, `PASSWORD`;
see `.env.example`) in the project-root `.env`. Every camera in `cameras.yaml` names its `nvr` and
`nvr_type` (`cpplus` | `hikvision`), which must match `streams.yaml`; two NVRs can never read the same
variable, and an NVR with missing credentials is not contacted. Hikvision RTSP paths are
`/Streaming/Channels/<channel>0<stream>` (01 main, 02 sub) (git-ignored; variables already set in the environment win) and
install the media server once: `backend/scripts/install_mediamtx.sh` (→ `backend/bin/mediamtx`,
also accepts a local tarball for air-gapped hosts). Credentials are only ever passed to the
MediaMTX child process environment — never written to config, database, logs or API responses.

**Source abstraction** (`backend/src/sources/`): `recorded` (looping clip), `rtsp` (NVR channel
via the media server) and `onvif` (reserved) all emit the same `FramePacket`. Sub stream
(`subtype=1`) feeds tiles and AI by default; set `subtype: 0` on a camera to run AI on the main
stream (resized inside NVDEC). The main stream is also pulled on demand for the focused view.

**Browser playback.** Each tile plays WebRTC with the stream passed through untouched when the
browser decodes its codec (the test NVR sends H.265: e.g. Brave/Chrome with hardware HEVC);
detections, zones and lines are drawn over it from the metadata stream. Browsers without H.265
show the AI stream's MJPEG in tiles, and the focused view gets the main stream as H.264 transcoded
on the GPU (NVDEC→NVENC) only while it is open (`media_server.browser_transcode`). Recorded clips
are never used as a fallback for live cameras. Workers JPEG-encode a camera only while someone
watches its MJPEG.

**Stream status** (card badge, `GET /api/v1/streams`, WebSocket `stream_status` / `stream_health`,
`cameras.stream_status`): `CONNECTED` · `DEGRADED` (late frames / fps < 60 % of target) ·
`RECONNECTING` (decoder restart with backoff; NVR polled every second while down) ·
`DISCONNECTED` (lost > 30 s, still retried) · `ERROR` (NVR answered 401/403/404, unsupported codec).
A media-server crash is restarted by the backend; no application restart is needed.

**Measured on the development laptop** (RTX 3050 6 GB, 16 GB RAM; 16 live 720p H.265 channels,
16 detection pipelines, operators watching): every pipeline at the full 12.5 fps ingest rate,
decode→result 16–24 ms, GPU 42 %, NVDEC 13 %, VRAM 3.2 GB (1.7 GB of it the 16 NVDEC decoders),
backend CPU ≈ 6 cores, NVR ingress 18 Mbit/s. A focused H.264 view adds NVENC ≈ 4 %, ~330 MB VRAM
and ~3.5 Mbit/s. Channels 17–20 of the test NVR return 404/403 and report `ERROR`.

---

## 🗺️ Tactical GIS Map (`/map`)

Terrain-oriented battalion map: **Battalion HQ → 8 Companies → 8–10 Posts each → 2 Cameras
per Post** (74 posts, 148 cameras in the prototype), on satellite imagery with real
hillshade and contours, live status, camera FOV wedges, coverage-gap analysis and an
authorized Edit Map mode.

> ⚠ **All positions are synthetic placeholders.** The seed in `backend/configs/map.yaml`
> generates the layout over an arbitrary stretch of forested mountains (a US national park,
> chosen only for its mountain / valley / jungle-like terrain). No real post / company /
> camera location is in the repository — replace them through **Edit Map**.

**Terrain.** Relief comes from an elevation model, not decoration: the browser decodes
Terrarium DEM tiles and computes hillshade (sun from the NW) and contour lines (index
contour every 5th; interval shown at the bottom of the map with the cursor's elevation).
Imagery is colour-graded for a subdued tactical look; roads are a reference overlay.

| Basemap (`basemaps:` in map.yaml) | Imagery | Elevation (hillshade/contours) | Roads |
|---|---|---|---|
| `satellite_terrain` (default, dev) | Esri World Imagery | AWS Terrain Tiles | Esri transportation |
| `relief_dev` (dev) | — (hypsometric relief) | AWS Terrain Tiles | Esri transportation |
| `local_offline` / `local_relief` | `backend/data/tiles/{z}/{x}/{y}` | `backend/data/dem/{z}/{x}/{y}.png` | — |

The dev sources are online and for development only (check Esri's terms). The `local_*`
basemaps are served by the backend and proxied same-origin (`/api/tiles/…`, `/api/dem/…`) —
the air-gapped option: fill those folders with XYZ imagery and Terrarium DEM tiles.

**Seed / hierarchy.** `seed:` in map.yaml lists exactly 8 companies (location + number of
posts). On seeding, posts are scattered around their company (deterministic, ≥ 700 m apart,
inside the AOR), placed on the highest of several candidates, and each post's 2 cameras are
aimed downhill (with a DEM; without one, placement is terrain-agnostic). The 32 cameras bound
to video in `cameras.yaml` keep their ids and feeds and are spread 4 per company; the other
116 are registered **without a video source** and honestly report OFFLINE ("NO FEED") until a
stream is bound in `cameras.yaml`. The seed runs when the database has none, or when
`seed.version` is raised — the previous layout is then backed up to
`backend/data/map_backup_<time>.json`. Otherwise the database is the source of truth.

**Data model** (same SQLite database as the cameras — `backend/data/command_center.db`):

| Table | Holds |
|---|---|
| `map_units` | Battalion / company / post: `unit_id, unit_type, parent_id, name, latitude, longitude` (+ the battalion's AOR `boundary`) |
| `cameras` (existing) | + `post_id, latitude, longitude, bearing, fov_angle, range_m` (detection mode as before) |
| `nvrs` | One per company: `nvr_id, company_id, name, latitude, longitude` |
| `camera_relationships` | Derived on every save: `overlap` (FOV intersection, m² and ratio), `adjacent` (< `adjacent_m`), `same_post`, `same_company` — the hook for future cross-camera handoff |
| `map_meta` | Configuration `revision` (a save against a stale revision is rejected with 409) and `seed_version` |

**Status** is derived from the live pipeline, never simulated, and rolls up Camera → Post → Company → Battalion:

| Camera | When |
|---|---|
| `ALERT` | a real pipeline alert in the last `alert_hold_s` (60 s) |
| `OFFLINE` | no video source / pipeline, or no frame for `frame_stale_s` (5 s); always in mock mode |
| `DEGRADED` | pipeline in `error`, or frames late by > `frame_degraded_s` (2 s) |
| `ONLINE` | otherwise |

Parents: any child ALERT → ALERT; all children OFFLINE (or none) → OFFLINE; any
OFFLINE/DEGRADED → DEGRADED; else ONLINE. With 116 video-less cameras every company is
therefore DEGRADED in the prototype. **NVR health** is the live ingest of the company's
cameras that have a video pipeline (all streaming → ONLINE, some → DEGRADED, none → OFFLINE).
Changes are pushed over the existing `/api/v1/ws` as `map_status`; a saved edit as `map_config`.

**Rendering.** The hierarchy comes from the backend; the map draws the level you are on —
Battalion: company markers with camera count / health; Company: its posts; Post: its cameras
with FOV wedges — and, when you zoom in manually, posts (≥ z14) and cameras (≥ z16) inside the
view only. Markers use tactical symbology (unit frames with echelon marks for HQ `II` and
Company `I`, an observation-post triangle, a camera glyph rotated to its bearing, an NVR rack).

**Layers:** Companies · Posts · Cameras · Camera FOV · Restricted zones · Alerts · Camera
health (fps / frame age) · NVR health · Coverage gaps · Camera relationships · Hillshade ·
Contours · Roads (remembered per browser).

**Operator features:** drill-down with Up/breadcrumb · camera panel reusing the live feed and
Detection Mode selector (+ *Open in cameras*) · **Alert → map** (Alerts console *Map* action or
the map's alert list) centres on the camera and shows its Post → Company, FOV, projected zone
and nearby related cameras · **Coverage gaps** (AOR minus the union of FOV wedges, optionally
ignoring OFFLINE cameras; recomputed live for unsaved drafts) · **What could have seen this?**
(click a point → every camera whose FOV contains it).

The projected zone/line on the map is an *uncalibrated flat-ground approximation* of the
camera's image-space zone (x across the FOV, y from near to max range).

**Edit Map** needs the passphrase from `MAP_EDIT_PASSPHRASE` in the backend's environment
(falls back to `edit.dev_passphrase` in `map.yaml`, with a startup warning). Drag HQ /
companies / posts / NVRs / cameras / boundary vertices, click companies and posts to drill in,
aim a camera with its handle or the bearing / FOV / range fields, add, remove, rename and
reassign companies, posts and cameras. **Save** persists atomically; **Cancel** restores the
last saved configuration.

```
GET    /api/v1/map                           hierarchy, placement, FOV, NVRs, live status, basemaps
PUT    /api/v1/map                           save (X-Map-Edit-Token, revision-checked)
POST   /api/v1/map/edit-session              {"passphrase"} → {"token", "expires_at"}
GET    /api/v1/map/health                    live ingest per camera (fps, frame age) and NVR
GET    /api/v1/map/coverage?exclude_offline= coverage gaps (POST = unsaved draft)
GET    /api/v1/map/cameras-at?lat=&lon=      cameras whose FOV contains the point
GET    /api/v1/map/relationships?camera_id=  overlap / adjacent / same post / same company
```

---

## 🛡️ Argus Agent (`/argus`)

Argus is the Command Centre's conversational assistant. Operators ask in plain English
("What is happening right now?", "Why is CAM-09 not working?", "How many intrusion alerts
happened today?") and Argus answers **only** from data returned by backend tools. It
cites camera / alert / incident / NVR IDs that link to the existing screens.

```
RTSP / NVR ─▶ DeepStream-style CV pipeline ─▶ events ─▶ SQLite (backend/data/command_center.db)
                                                   └─▶ alerts ─▶ incidents      device health ─▶ device_status / device_health
SQLite + live runtime ─▶ SituationService ─▶ REST /api/v1/{status,alerts,incidents,health,events/recent}
                                        └─▶ Argus tools ─▶ Ollama (qwen3.5:4b, local GPU) ─▶ /api/agent/chat ─▶ /argus
```

**Storage (SQLite, local).** Besides cameras, NVRs and every detection event, the backend
now persists `alerts` (one row per raised alert, with severity, evidence snapshot path and
acknowledgement), `incidents` (alerts of one camera + class grouped while they keep coming;
active until `situation.incident_gap_s` passes without a new alert), `device_status` and
`device_health` (camera / ingest-NVR / company-recorder health and its transitions).
Snapshots stay on disk under `backend/outputs/evidence`; only paths go in SQLite. Existing
alerts are migrated from the events table on first start.

**Tools.** `get_system_status`, `get_active_alerts`, `search_alerts`, `get_camera_status`,
`get_nvr_status`, `get_incident_details`, `get_recent_events`. They call the same functions
as the REST API and respect the signed-in user's camera scope. IDs in an answer that do not
appear in the retrieved data are flagged *unverified* and never linked.

**Run it (everything stays on the laptop):**

```bash
# once: install Ollama (user-local; no sudo needed) and the model
mkdir -p ~/.local/opt/ollama && curl -sSL https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst \
  | tar --zstd -x -C ~/.local/opt/ollama && ln -sf ~/.local/opt/ollama/bin/ollama ~/.local/bin/ollama
ollama serve &            # or: npm run agent:ollama
ollama pull qwen3.5:4b

npm run live:linux        # backend (APIs, pipeline, Argus tools)
npm run dev               # frontend → http://localhost:3000/argus
```

Settings live in `backend/configs/pipeline.yaml` (`agent:` model, context size, reasoning
mode; `situation:` incident gap, health check interval). For an air-gapped install copy
`~/.ollama/models` from a connected machine and set `OLLAMA_NO_CLOUD=1`.

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
