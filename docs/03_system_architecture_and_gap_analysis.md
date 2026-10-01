# System Architecture & Technical Gap Analysis

**System:** AI-Powered Tactical Video Intelligence Platform  
**Target Operational Environment:** Kupwara Sector, Northern Kashmir  
**Document Purpose:** Comparative analysis between Operational Requirements, Prototype Dataset Strategy, and Current Frontend Implementation  
**Classification:** Technical Assessment & Engineering Roadmap  

---

## 1. Context & Architectural Overview

The project bridges three critical domains:
1. **Field Operational Reality (The Army Requirement):** An on-premise, air-gapped system deployed at a battalion headquarters in Kupwara, Northern Kashmir, integrating 100–120 existing CCTV cameras/NVRs (predominantly CP Plus/Indian makes), with active AI inference concentrated on 30–35 high-priority channels. It emphasizes event-driven surveillance (16–32 tiles dynamically highlighting alert sources while pinning critical posts).
2. **Pre-Deployment Dataset Strategy:** A proxy pipeline using public, defense-relevant datasets (VIRAT, MOT20, LLVIP, Kaggle Border, VisDrone, Sentinel-2) ingested via MediaMTX, processed by NVIDIA DeepStream with YOLOv11/DeepSORT, and streamed to the UI via WebRTC/Socket.IO.
3. **Current Codebase State (`military_ui`):** A high-fidelity tactical C2 web application built with Next.js 16 (App Router), React 19, and TailwindCSS v4, featuring Gotham-styled military consoles for Dashboard, Alerts, Tactical Map, Device Matrix, and Admin configuration.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CURRENT IMPLEMENTATION VS TARGET                   │
├──────────────────────────────┬──────────────────────────────┬───────────────┤
│ Operational Requirement      │ Prototype Dataset Strategy   │ Codebase UI   │
├──────────────────────────────┼──────────────────────────────┼───────────────┤
│ 100–120 Field Cameras        │ 10–15 Simulated Streams      │ 8–9 Hardcoded │
│ 30–35 AI Inference Channels  │ 4 Workload Tiers (YOLOv11)   │ Mock alerts   │
│ 16–32 Dynamic/Fixed Tiles    │ MediaMTX RTSP -> WebRTC      │ Static Wall   │
│ Vehicle ANPR & Type Class    │ UFPR-ALPR & VIRAT Vehicles   │ Generic "veh" │
│ Kupwara Mountain Terrain GIS │ Sentinel-2 GeoTIFF + Mapbox  │ Static SVG    │
│ Air-gapped On-Premises C2    │ Express + Postgres + MQTT    │ Client State  │
└──────────────────────────────┴──────────────────────────────┴───────────────┘
```

---

## 2. Component-by-Component Mapping & Verification

### 2.1 Dashboard & Camera Wall (`components/gotham/dashboard/`)
* **Current State:**
  * Displays a 9-camera grid (`CameraWall.tsx`), alert feed (`FeedRow`), device health summary, and quick KPI strip.
  * Driven by mock models (`lib/gotham/model.ts`) with deterministic procedural generation.
* **Requirement Alignment:**
  * Target requires **16–32 camera tiles** visible simultaneously on operator displays.
  * Requires a **dual-tile architecture**:
    * **Fixed Tiles (Permanent):** Main Gate, Checkpoint Alpha, Armoury, Ammunition Dump.
    * **Dynamic Tiles (Event-Driven):** Automatically populated when an alert or anomaly triggers on any of the other 80+ cameras.
* **Engineering Gap:**
  1. Grid layout needs responsive configuration for 16, 24, and 32 tile matrices.
  2. Implement state machine for **dynamic slot eviction**: when an alert fires, the least-recently active dynamic tile is replaced by the alerting camera with visual indicator (border pulse).
  3. Video feeds currently display mock images (`/alerts/incident-8821-ir-frame.jpg`); needs WebRTC / low-latency HLS video stream player components.

---

### 2.2 Alert Management & Intelligence (`components/gotham/alerts/`)
* **Current State:**
  * Comprehensive military console (`AlertConsole.tsx`, `AlertsTable.tsx`, `IncidentDrawer.tsx`).
  * Features severity classification (High, Medium, Low), acknowledge/dispatch QRF workflows, class tags (`person`, `vehicle`, `animal`), and audit status.
* **Requirement Alignment:**
  * Strong alignment on triage workflow, severity tagging, and operator acknowledgment.
  * Supports event drill-down with snapshot viewer.
* **Engineering Gap:**
  1. **Alert Classes:** Need expansion beyond `person`, `vehicle`, `animal` to include specific defense threat events defined in the specs:
     * `PERIMETER_BREACH` (Fence climbing / boundary crossing from Kaggle Border dataset)
     * `ANOMALY_LOITERING` (Off-hours dwell time)
     * `TRAFFIC_ANOMALY` (Unusual convoy volume or off-pattern military/civilian vehicles)
     * `ANPR_HIT` (License plate watchlist match)
     * `CAMERA_TAMPER` / `SIGNAL_LOSS` (RTSP stream loss or optical obstruction)
  2. **Snapshot & Clip Playback:** Currently renders a single static preview; needs 5-second pre-event and 10-second post-event clip playback buffer integration.

---

### 2.3 Tactical Map & GIS Sector View (`components/map/`)
* **Current State:**
  * Custom tactical SVG map (`TacticalMapSvg.tsx`) showing cantonment perimeter, building outlines, radar arcs, IR tripwires, and camera markers.
  * Side panels for zone status, camera specs popover, and MGRS / coordinate telemetry (`lib/map-data.ts`).
  * Coordinates currently set to New Delhi (`28.6139° N, 77.2090° E`).
* **Requirement & Strategy Alignment:**
  * Operational target is **Kupwara, Northern Kashmir** (mountainous border terrain, LOC proximity).
  * Dataset Strategy specifies:
    * Mapbox GL JS engine with dark tactical vector tiles.
    * Sentinel-2 Copernicus satellite imagery overlay of generic rugged mountain terrain (to prevent exposing sensitive operational grid coordinates during prototype demonstrations).
    * Dynamic GeoJSON camera markers plotted along virtual defense sectors.
* **Engineering Gap:**
  1. Replace or augment static SVG with a Mapbox GL / Leaflet container supporting tactical satellite imagery overlays.
  2. Update tactical readouts from New Delhi to Kupwara-relevant military coordinates (e.g., Grid 43S / Kupwara sector elevations ~1,600m–2,800m MSL).
  3. Wire camera icons on the map to trigger live popover feeds and camera wall focus.

---

### 2.4 Device Telemetry & Health Monitoring (`components/devices/`)
* **Current State:**
  * `DevicesOverview.tsx`, `SensorMatrix.tsx`, `PreviewPanels.tsx`.
  * Displays camera status, IP addresses, firmware versions, stream resolution, FPS, temperature, uptime percentage, and packet loss metrics.
* **Requirement Alignment:**
  * Meets the core requirement for continuous camera health and outage monitoring.
  * Integrates NVR health status (storage used/total, temperature, fault state).
* **Engineering Gap:**
  1. Expand camera models to reflect the technical inventory reality: **CP Plus** and indigenous Indian surveillance hardware (e.g., CP Plus Aditya / Coral series, Sparsh, Matrix) rather than Western brands (Axis, Bosch, Pelco).
  2. Connect to the proposed Python `Faker` telemetry daemon (or live SNMP/ONVIF device polling service) transmitting live packet loss, bitrate, and temperature readings.

---

### 2.5 Search, Investigation & Vehicle Analytics (Missing Dedicated View)
* **Current State:**
  * Admin and Alerts consoles have search filters, but there is no dedicated **Investigation / ANPR Retrieval Workspace**.
* **Requirement Alignment:**
  * Section 4 & Section 7 of Army Requirements explicitly demand:
    * Historical vehicle queries (previous sightings, timestamps, frequency).
    * ANPR / LPR database integration.
    * Person/vehicle retrieval with feature attributes for the designated 30–35 high-priority cameras.
* **Engineering Gap:**
  1. Design and implement an **Investigation & Forensic Search Screen** (`/search` or `/investigation`):
     * Plate number query input (partial regex / wildcard match).
     * Vehicle type filters (Tanker, Heavy Truck, Light Utility, Civilian, Unknown).
     * Time-window slider with multi-camera timeline reconstruction.
     * Sighting cards with captured plate crops and scene context images.

---

### 2.6 Backend & Pipeline Infrastructure Gaps
* **Current State:**
  * Pure frontend Next.js application with procedural client-side data generation.
* **Required Architecture (as defined in Dataset Strategy §7):**
  1. **MediaMTX RTSP Server:** Containerized RTSP server looping `.mp4` test files from VIRAT, MOT20, and VisDrone.
  2. **AI Inference Layer:** NVIDIA DeepStream pipeline running YOLOv11 for detection + ByteTrack/DeepSORT for tracking.
  3. **Event Daemon:** Lightweight Python service evaluating boundary rules (virtual tripwires) and emitting MQTT payloads.
  4. **Backend API:** Express.js / Fastify service ingesting MQTT, persisting events to PostgreSQL, and providing Socket.IO / WebSockets to the Next.js frontend.
  5. **Streaming Gateway:** WebRTC or Low-Latency HLS (LL-HLS) converting RTSP streams for HTML5 `<video>` rendering.

---

## 3. Dataset Mapping to Frontend Components

| Dataset | Modality | Primary Role in System | Target Frontend Component |
| :--- | :--- | :--- | :--- |
| **DARPA VIRAT** | 1080p HD Video | Perimeter & checkpoint vehicle/person surveillance | `CameraWall.tsx`, `TacticalMapSvg.tsx` popover |
| **MOT20** | Dense Crowds | High-density entry gate multi-object tracking | `CAM 01–04 (Main Gate)` tiles |
| **LLVIP** | Paired IR/Visible | Night vision & thermal perimeter monitoring | Thermal toggle on `CameraWall` & `IncidentDrawer` |
| **Kaggle Border** | Drone / POV Images | Fence breaching & perimeter climbing intrusion alerts | `AlertsTable.tsx` Critical alert generator |
| **VisDrone** | Aerial 4K Video | High-angle tactical overview / UAV surveillance | `CAM 11–12 (Aerial View)` |
| **UFPR-ALPR** | High-Res Vehicle/Plate | License plate recognition & vehicle classification | Vehicle Analytics & Investigation Console |
| **Sentinel-2** | Satellite Imagery | High-altitude terrain mapping for tactical GIS | Mapbox Satellite Base Layer on `/map` |

---

## 4. Technical Implementation Roadmap

### Phase 1: Frontend Alignment & Tactical Polish (Immediate)
1. **Dynamic Grid Upgrade:** Update `components/gotham/dashboard/CameraWall.tsx` to support 16 and 32 tile modes, with fixed pinned slots and dynamic alert-triggered slots.
2. **Kupwara Sector Localization:** Update `lib/map-data.ts` and `lib/gotham/model.ts` to reflect Northern Kashmir operational context (MGRS grid references, CP Plus camera hardware, mountain sector labels, snow/fog environmental indicators).
3. **Investigation & ANPR Module:** Add an Investigation & Search page (`app/(shell)/investigation/`) allowing vehicle search, plate lookups, and visual audit timelines.
4. **Enhanced Alert Taxonomy:** Add `PERIMETER_BREACH`, `TRAFFIC_ANOMALY`, and `ANPR_HIT` alert types to `lib/alerts-data.ts` and `lib/gotham/model.ts`.

### Phase 2: Mock Telemetry & Event Streaming (Next Step)
1. Implement a WebSocket/SSE client hook in Next.js to receive live alert events and camera telemetry.
2. Build the Python `Faker` script specified in §8 of the Dataset Strategy to emit realistic camera health metrics and DeepStream-formatted intrusion events.

### Phase 3: MediaMTX & DeepStream Pipeline (Full Integration)
1. Deploy MediaMTX in Docker to stream VIRAT/MOT20 clips over RTSP.
2. Connect NVIDIA DeepStream running YOLOv11 models.
3. Bridge RTSP feeds to WebRTC for sub-500ms browser video playback in the Next.js camera tiles.

### Phase 4: Field Hardware Readiness (Transition to Military Deployment)
1. Ingest camera/NVR inventory from upcoming technical survey.
2. Replace mock RTSP endpoints with CP Plus NVR RTSP URLs.
3. Replace Sentinel-2 mock coordinates with surveyed military site coordinates.
4. Finalize air-gapped on-premise deployment package (Docker Compose / Podman / Offline RPMs).
