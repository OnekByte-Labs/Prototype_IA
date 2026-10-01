# Prototype Dataset Strategy & Implementation Report

**Project:** Military Video Intelligence System (Prototype Phase)  
**Target Deployment:** Kupwara, Northern Kashmir  
**Document Purpose:** Public Dataset Integration, Dashboard Mocking, and ML Pre-Training Strategy  
**Classification:** Internal / Development Team Use Only  
**Version:** 1.0  

---

## 1. Executive Summary

This report defines the comprehensive data strategy for building the pre-deployment prototype of our **Military Video Intelligence System**. Because the official classified military dataset will only be provided after prototype verification, we must utilize publicly available, defense-relevant datasets to build, demonstrate, and test our architecture today.

Our strategy is two-fold:

1. **Dashboard Simulation:** Stream raw video files from public datasets through our backend to populate the frontend React dashboard with realistic live feeds, alerts, and tracking data.
2. **ML Pre-Training:** Utilize annotated public datasets (thermal, aerial, perimeter) to develop our YOLO/tracking models so the pipeline is fully functional before receiving official data.

These public datasets are temporary proxies. The system architecture utilizes **"Data Adapters"** so that when the official military dataset arrives, the public data streams can be seamlessly swapped out without altering the core backend or frontend codebase.

---

## 2. Prototype Activities & Features

Our prototype must successfully demonstrate the following capabilities to stakeholders:

* **Video Intelligence:** Person/vehicle detection, classification, multi-object tracking, intrusion/geofence alerts, loitering detection, and thermal/night-vision surveillance.
* **Surveillance Operations:** Multi-camera grid monitoring, camera health/offline telemetry, event timelines, alert severity tagging, and historical playback.
* **Geospatial Intelligence:** Map-based tactical view, camera GPS coordinates, virtual checkpoints, and satellite terrain mapping.
* **Analytics:** Daily detection statistics, alert heatmaps, and camera uptime reports.

---

## 3. Dataset-to-Activity Mapping

| Activity | Primary Dataset | Why This Dataset | Data Type | Demonstration Role |
| :--- | :--- | :--- | :--- | :--- |
| **Person/Vehicle Detection** | VIRAT Video | Highly realistic outdoor surveillance angles. | HD Video | Live feed streaming & bounding boxes. |
| **Multi-Object Tracking** | MOT20 | Dense crowds, severe occlusion. | HD Video | Track ID persistence across frames. |
| **Thermal/Night Vision** | LLVIP | Paired visible/thermal pedestrian images. | Images | Nighttime intrusion detection toggles. |
| **Perimeter Intrusion** | Kaggle Border | Specific "fence climbing" simulated events. | Images | Geofence breach alerting in dashboard. |
| **Aerial/Drone View** | VisDrone | Tactical overhead surveillance view. | Video | Drone feed simulation. |
| **LPR / ANPR** | UFPR-ALPR | High-res license plate captures. | Images | Vehicle event logging / Search. |

---

## 4. Final Recommended Dataset Stack

### 4.1 Tier 1: Essential (Download Immediately)

1. **DARPA VIRAT Video Dataset**
   * **Provider:** DARPA / US Govt.
   * **Format:** 29 hours of 1080p Video (30fps) + Annotations.
   * **Use:** Primary video source for dashboard "Live Feeds."
2. **MOT20 (Multi-Object Tracking)**
   * **Provider:** MOTChallenge.
   * **Format:** HD Video sequences + Track ID bounding boxes.
   * **Use:** Stress-testing the dashboard tracking UI and DeepSORT models.

### 4.2 Tier 2: Useful (ML Pre-Training)

3. **LLVIP (Low-Light Thermal)**
   * **Provider:** BUPT.
   * **Format:** 30,976 paired visible/infrared images.
   * **Use:** Pre-training YOLOv11 thermal weights.
4. **AI Based Threat Detection Dataset for Border**
   * **Provider:** Project Falcon AI (Kaggle).
   * **Format:** Drone POV images of fence interactions.
   * **Use:** Training the "Intrusion/Climbing" classifier.

### 4.3 Tier 3: Geospatial & Telemetry (Dashboard Mocking)

5. **Sentinel-2 Copernicus Imagery**
   * **Provider:** European Space Agency.
   * **Use:** Base satellite layer for the Map/GIS dashboard view.

---

## 5. Exact Download / Access Links

* **VIRAT Video Dataset:**  
  * Official Page & Download: [https://viratdata.org/](https://viratdata.org/)  
  * License: Public Domain. No registration required.
* **MOT20:**  
  * Official Page: [https://motchallenge.net/data/MOT20/](https://motchallenge.net/data/MOT20/)  
  * Download: Registration required. Academic/Non-commercial license.
* **LLVIP (Thermal/Night):**  
  * Official Page: [https://bupt-ai-cz.github.io/LLVIP/](https://bupt-ai-cz.github.io/LLVIP/)  
  * Download: Via Baidu/Google Drive links on official page.
* **Border Threat Detection (Kaggle):**  
  * Official Page: [https://www.kaggle.com/datasets/shihabsarar/ai-based-threat-detection-dataset-for-border](https://www.kaggle.com/datasets/shihabsarar/ai-based-threat-detection-dataset-for-border)  
  * License: CC0 (Public Domain).
* **VisDrone:**  
  * Official Page: [https://github.com/VisDrone/VisDrone-Dataset](https://github.com/VisDrone/VisDrone-Dataset)  
  * Download: Links provided in GitHub Readme.
* **Sentinel-2 Maps:**  
  * Official Browser: [https://browser.dataspace.copernicus.eu/](https://browser.dataspace.copernicus.eu/)

---

## 6. Dataset Coverage Matrix

| Feature | VIRAT | MOT20 | LLVIP | Border (Kaggle) | VisDrone |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Person Detection** | Full | Full | Full | Full | Full |
| **Vehicle Detection** | Full | Partial | No | No | Full |
| **Multi-Tracking** | Partial | Full | No | No | Full |
| **Intrusion/Fence** | Partial | No | No | Full | No |
| **Thermal/Night** | No | No | Full | No | No |
| **Live Streaming** | Full | Full | No | No | Full |

---

## 7. Recommended Data Pipeline & Integration

### Pipeline Flow for the Prototype:

1. **Ingestion:** MediaMTX (RTSP server) loops `.mp4` files from VIRAT/MOT20.
2. **Inference:** NVIDIA DeepStream reads the RTSP streams, runs YOLOv11 (pre-trained on the datasets above), and generates bounding boxes.
3. **Event Generation:** Python daemon detects rules (e.g., bounding box crosses virtual fence line) and formats an MQTT JSON payload.
4. **Backend:** Express.js receives MQTT, saves to PostgreSQL.
5. **Frontend:** React dashboard receives Socket.IO alert and plays the WebRTC stream.

### Transition Architecture:
To ensure a smooth transition to the official military dataset, the RTSP Server (MediaMTX) acts as an abstraction layer. When deployed at the border, we simply change the RTSP URLs in the backend from `rtsp://localhost:8554/virat_mock` to the actual IP addresses of the military NVRs. The rest of the pipeline remains completely untouched.

---

## 8. Mock Data Strategy (Simulating Telemetry)

Public datasets do not contain hardware telemetry (e.g., camera voltage, CPU temps). We will simulate this using a Python `Faker` script.

### Camera Health Schema (Mock Data payload):
```json
{
  "device_id": "CAM_KUPWARA_04",
  "status": "ONLINE",
  "packet_loss_pct": 0.02,
  "internal_temp_c": 45.2,
  "timestamp": "2026-09-18T13:01:10Z"
}
```

### Event Schema (Generated by Inference):
```json
{
  "event_id": "EVT_99384",
  "camera_id": "CAM_KUPWARA_04",
  "timestamp": "2026-09-18T13:01:10Z",
  "event_type": "PERIMETER_BREACH",
  "severity": "CRITICAL",
  "confidence": 0.92,
  "track_id": 142
}
```

---

## 9. Camera Simulation Strategy

To simulate 10–15 independent cameras for the dashboard grid:

* **CAM 01 – 04 (Main Gate):** Map to MOT20 video sequences (dense crowds).
* **CAM 05 – 10 (Perimeter):** Map to VIRAT video sequences.
* **CAM 11 – 12 (Aerial View):** Map to VisDrone sequences.

Our backend will dynamically assign mock GPS coordinates to these virtual cameras so they appear spaced out along a virtual border in the GIS view. All timestamps will be overwritten at the RTSP ingestion layer to reflect the current system time, ensuring all mocked streams appear synchronized live.

---

## 10. Geospatial Data Plan

* **Map Rendering Engine:** Mapbox GL JS (Free tier for development). Provides sleek, dark-mode tactical map styles.
* **Satellite Imagery:** Sentinel-2 (Copernicus). We will download a high-res GeoTIFF of a generic remote mountainous region (to avoid using sensitive Kupwara coordinates during the public demo) and overlay it onto Mapbox.
* **Camera Coordinates:** Hardcoded mock GeoJSON coordinates fed via our backend API to plot camera icons on the map.

---

## 11. Model Development Plan

| Capability | Dataset | Model | Output |
| :--- | :--- | :--- | :--- |
| **Person/Vehicle Detection** | VIRAT / VisDrone | YOLOv11 | Bounding Boxes |
| **Thermal Detection** | LLVIP | YOLOv11 (Thermal weights) | Bounding Boxes |
| **Multi-Object Tracking** | MOT20 | DeepSORT / ByteTrack | Track IDs |
| **Intrusion Detection** | Kaggle Border | Custom Heuristics | Alert Trigger |

---

## 12. Transition to Official Military Dataset

The migration plan is designed for zero architectural rewrites:

1. **Video Transition:** Update the `cameras` table in PostgreSQL with the real RTSP URIs. The backend automatically points DeepStream to the new feeds.
2. **Model Transition:** The ML team will fine-tune the YOLOv11 models on the new classified dataset. Once trained, we simply replace the `.engine` or `.onnx` files in the DeepStream `models/` directory and restart the inference container.
3. **Map Transition:** Update the mock GeoJSON coordinates with the actual physical coordinates of the installed cameras.

---

## 13. Storage Requirements & Hardware Sizing

For the prototype development environment:

* **Raw Datasets Download:** 150 GB (VIRAT + MOT20 + LLVIP).
* **Extracted Frames/Processing:** 200 GB.
* **PostgreSQL Database:** < 5 GB (Metadata only).
* **Recommended Dev Server:** 1x NVIDIA RTX 3090 / 4090, 64GB RAM, 2TB NVMe SSD. This is sufficient to run the mock RTSP server, DeepStream, Express backend, and PostgreSQL locally for the demo.

---

## 14. Download Priority & Execution Plan

* **Phase 1 (Day 1–2):** Download VIRAT (for video streaming) and Mapbox API keys.
* **Phase 2 (Day 3–5):** Setup MediaMTX to loop VIRAT videos. Build the Express.js backend and React dashboard to consume these feeds.
* **Phase 3 (Day 6–10):** Download MOT20 and Kaggle Border dataset. ML team begins training YOLO/DeepSORT models.
* **Phase 4 (Day 11–14):** Integrate DeepStream inference with the RTSP streams. Generate MQTT events.
* **Phase 5 (Day 15–20):** Write Faker scripts for camera telemetry. Finalize dashboard UI (Map view, alert timeline).

---

## 15. Final Dataset Checklist

* [ ] VIRAT Video Dataset downloaded and verified.
* [ ] MOT20 downloaded and annotations parsed.
* [ ] LLVIP downloaded for thermal ML training.
* [ ] MediaMTX configured to loop mock RTSP streams.
* [ ] Faker script running for hardware telemetry.
* [ ] Mapbox token secured and Sentinel-2 base map configured.
* [ ] DeepStream configured to read mock RTSP and output JSON.
