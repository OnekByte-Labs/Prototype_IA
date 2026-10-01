# Army Deployment Project: Kupwara, Northern Kashmir

**Organization:** OneKByte Labs Private Limited  
**Target:** Battalion-Level Deployment, Kupwara, Northern Kashmir  
**Document Purpose:** Operational Requirements, Command Philosophy, and Technical Architecture Specification  
**Classification:** Restricted / Operational Specification  

---

## Executive Summary

1. **OneKByte Labs Private Limited** proposes an on-premise AI-powered Video Intelligence & Surveillance Platform for a battalion-level deployment in Kupwara, Northern Kashmir.
2. The initial deployment will integrate approximately **100–120 existing CCTV cameras and NVRs** into a unified dashboard with:
   * Real-time alerts
   * Intrusion and anomaly detection
   * Vehicle analytics & ANPR/LPR
   * Event recording and intelligent search
3. The system will use an **event-driven monitoring approach**, keeping critical cameras visible while automatically surfacing cameras that generate alerts. The architecture will also support future expansion to cluster and higher-command levels.
4. **Target deployment timeline:** approximately 3 months.

---

## 1. Requirement Understanding

* **Scale:** Approximately 80–100 cameras at the initial battalion deployment (expanding to 100–120).
* **Infrastructure Reuse:** Existing NVRs and cameras must be integrated rather than unnecessarily replaced.
* **Native Alert Ingestion:** Existing NVR-generated alerts should be brought into the unified dashboard where technically accessible.
* **Air-Gapped Operation:** Fully on-premise operation is required (zero external cloud dependencies).
* **Event-Driven Philosophy:** Monitoring should be alert-driven rather than continuous manual monitoring of every camera.
* **Fixed Tiles:** Important locations should remain permanently visible through fixed live camera tiles.
* **Dynamic Tiles:** Other camera tiles should be dynamically populated when relevant alerts occur.
* **Timeline:** Target deployment period of approximately three months, subject to site readiness and technical access.
* **Support:** On-site implementation and engineering support will be required.

---

## 2. Monitoring & Command Philosophy

* **Battalion Dashboard:** One unified operational view of cameras, alerts, health, and statistics.
* **Live Display Grid:** Approximately 16–32 camera tiles visible at a time.
* **Fixed Tiles:** A selected set of critical cameras remains permanently pinned.
* **Dynamic Tiles:** Remaining grid positions are dynamically populated by cameras that trigger relevant alerts.
* **AI Analytics Scope:**
  > **CRITICAL NOTE:** AI analytics will **NOT** be implemented on all cameras. Hardly **30–35 cameras** should have active AI analytics running simultaneously due to edge compute sizing and operational relevance.
* **Alert Continuity:** Alerts remain active for all applicable cameras, including fixed cameras.
* **Higher Command Federation:** Primarily statistics, aggregated alerts, health status, and selected feeds rather than continuous raw streaming of hundreds of streams.
* **Example Statistics:** Intrusion alerts in the last 24 hours, camera outages/downtime in the last 24 hours.

---

## 3. Core Functional Requirements

* **Unified Dashboard:** Centralized camera and NVR view.
* **Real-Time Alerts:** Categorized by camera ID, physical sector, and severity.
* **Camera Health & Outage Monitoring:** Continuous status checks, packet loss, and downtime alerts.
* **Intrusion Detection:** Defined-zone and virtual tripwire event integration.
* **General Anomaly Detection:** Site/use-case-specific model configuration (e.g., unusual loitering, off-hours movement).
* **Alert Metrics:** Per-camera daily alert tallies and trend tracking.
* **Alert Drill-Down:** Direct click-through to individual snapshots, event timings, and clip playback.
* **Database Storage:** Database-backed event, telemetry, and metadata persistence.
* **Vehicle Analytics:** Vehicle counting and broad vehicle-type classification (car, truck, tanker, etc.) on suitable road-facing cameras.
* **Traffic Anomaly Detection:** Comparison of vehicle volume/types against established baseline patterns.
* **ANPR / LPR:** Automatic license plate recognition/capture where camera angle and resolution permit.
* **Historical Vehicle Queries:** Past sightings, timestamp logs, and directional history.

---

## 4. Search & Investigation Scope

* **Selective Indexing:** Deep search and indexing are **not** required for every camera.
* **Survey-Driven Selection:** Only a selected subset of cameras will require richer searchability (exact number confirmed during technical survey).
* **Searchable Entities:** Searchable cameras will maintain richer records for:
  * Vehicles & license plates
  * Person detections & attributes
  * Precise timestamps and associated metadata
* **Non-Searchable Cameras:** Operate primarily as analytics and alert triggers with event snapshots and daily statistics.
* **Investigation Workflows:** Must support previous sightings, timestamp filtering, camera/location cross-referencing, and probable candidate matching where confidence is limited.

---

## 5. Camera & NVR Integration

* **Vendor Ecosystem:** Understood to be predominantly **CP Plus**, with other Indian camera brands present.
* **Compliance:** No Chinese-brand cameras were indicated during requirements discussions.
* **Inventory Verification:** Exact makes/models to be cataloged during the upcoming technical survey.
* **Reusability:** Existing operational infrastructure reused wherever supported.
* **Integration Interfaces:** RTSP, ONVIF (Profiles S/G/T), and vendor APIs/SDKs, subject to permissions.
* **NVR Ingestion:** Existing NVR-generated alarms/events ingested via accessible interfaces/SDKs.
* **Extensibility:** New or upgraded ONVIF-compatible cameras easily added into the management layer.

---

## 6. Proposed System Architecture

```
Camera / NVR Layer
       │
       ▼
Integration Layer (Stream, Event & Health Adapters)
       │
       ▼
Edge AI & Analytics (DeepStream / YOLOv11 / Heuristics)
       │
       ▼
Event & Metadata Layer (PostgreSQL / Structured Store)
       │
       ▼
Alert / Search Layer (Prioritization & Dynamic Surfacing)
       │
       ▼
Battalion Dashboard (React / Next.js Tactical UI)
       │
       ▼
Higher-Level Federation (Command Aggregation & Rollup)
```

### Architectural Layer Breakdown:
1. **Camera/NVR Layer:** Existing cameras, NVRs, and native manufacturer analytics.
2. **Integration Layer:** Stream ingest (MediaMTX / RTSP), event listeners, and device-health polling adapters.
3. **Edge AI Layer:** Local GPU inference for selected computer-vision workloads (30–35 channels).
4. **Event Layer:** Structured storage of events, timestamps, camera references, snapshots, and model inference results.
5. **Alert Layer:** Severity filtering, alert deduplication, and dynamic dashboard presentation logic.
6. **Investigation Layer:** Entity search, vehicle tracking history, and candidate matching for the high-priority camera subset.
7. **Command Layer:** Battalion local dashboard and future upstream aggregation.

---

## 7. Proposed Analytics Modules

1. **Intrusion Analytics:** Defined-zone or perimeter boundary crossing on perimeter cameras.
2. **Anomaly Analytics:** Configurable heuristics for unusual activity and timing.
3. **Vehicle Analytics:** Detection, counting, and broad classification (car, truck, tanker, military vehicle) on road-facing cameras.
4. **Traffic Anomaly Analytics:** Variance detection against historical volume baselines.
5. **ANPR / LPR:** High-resolution optical plate capture and OCR recognition.
6. **Person / Vehicle Retrieval:** Searchable visual and attribute records for designated priority cameras.
7. **Camera Health Monitoring:** Continuous ping, RTSP heartbeat, packet loss, and FPS telemetry.

---

## 8. Event & Data Model

* **Camera Identifier & Location:** Unique ID, geographic zone, and tactical post reference.
* **Event Type & Timestamp:** Precise ISO 8601 timestamp and classified trigger type.
* **Visual Evidence:** High-resolution snapshot image reference and short pre/post event video buffer.
* **Vehicle Metadata:** Detected class, confidence score, OCR plate string (if legible), and travel vector.
* **Entity Representation:** Feature vectors/embeddings for searchable entities subject to approved data governance.
* **Historical Traceability:** Every alert remains permanently traceable to its originating camera and timestamp.

---

## 9. On-Premise Deployment Specifications

* **Local Hosting:** 100% of core components hosted within the designated battalion server room.
* **Air-Gapped Isolation:** Zero dependency on external public cloud or unclassified networks.
* **Edge Compute Sizing:** Hardware sized for 30–35 concurrent active AI inference streams + 100–120 total video streams.
* **Storage Sizing:** Sized for event metadata, snapshot retention, searchable index, and agreed video retention windows.
* **Facility Requirements:** Regulated power, online UPS redundancy, server rack space, climate control, and physical security.
* **Network Topology:** Dedicated surveillance VLANs, strict segmentation, and firewall rules between camera subnet, AI compute, and operator consoles.

---

## 10. Training, Calibration & Validation

* **Model Specialization:** Different terrain, season (snow/rain in Kupwara), and nighttime IR require tuned models.
* **Site Calibration:** Geometry calibration for camera mounting angles, lens distortion, and optical zoom levels.
* **Acceptance Criteria:** Rigorous validation against defined military scenarios and false-alarm tolerances.
* **Sensitive Data Protocol:** Formal authorization process for capturing, transferring, storing, and purging on-site training imagery.
* **Legal / Security:** NDA and security clearances established prior to data access.

---

## 11. Information Required Before Final Engineering

* **Camera Inventory:** Make, model, resolution, FPS, codec (H.264/H.265), IP/analog status, IR/optical capability, and placement.
* **NVR Inventory:** Make, model, channel density, storage capacity, RTSP/ONVIF support, and API interfaces.
* **Network Architecture:** Topology diagrams, switch locations, backbone bandwidth, and VLAN layout.
* **Server Room Facility Details:** Rack U-space, power availability, UPS capacity, and cooling specs.
* **Retention Policy:** Mandated video storage duration and event snapshot retention periods.
* **Analytics Priority Matrix:** Exact assignment of the 30–35 cameras requiring AI workloads (intrusion, anomaly, vehicle, ANPR).
* **Search Camera List:** Exact subset of cameras requiring high-resolution indexing and attribute search.
* **Security & Governance:** Formal protocols for handling sensitive imagery and role-based permissions matrix.

---

## 12. Security & Operational Controls

* **Role-Based Access Control (RBAC):** Tiered permissions for Sentinel Operators, Watch Officers, System Administrators, and Higher Command.
* **Authentication:** Strong local authentication mechanisms.
* **Audit Logging:** Tamper-evident logging of operator actions, alert acknowledgments, clip exports, and config modifications.
* **Network Segmentation:** Physical or VLAN isolation of camera and inference subnets.
* **Evidence Handling:** Cryptographic verification and controlled export workflows for incident evidence.
* **OS & System Hardening:** Hardened Linux base OS conforming to defense cyber guidelines.

---

## 13. Scalability & Higher-Command Architecture

* **Battalion Node:** Baseline deployment serving 100–120 cameras locally.
* **Federation Interface:** Lightweight telemetry, high-level alerts, incident summaries, and on-demand streaming to sector/division headquarters.
* **Bandwidth Preservation:** Avoids naive raw video forwarding; uses event-driven push to respect tactical low-bandwidth links.
* **Progressive Expansion:** Standardized architecture enabling replication across adjacent battalions in Northern Kashmir.

---

## 14. Proposed Deliverables

1. Technical architecture and deployment design documentation.
2. Camera & NVR integration abstraction layer.
3. On-premise surveillance application and tactical dashboard.
4. Real-time alert and event-management engine.
5. Camera health and network telemetry monitor.
6. Core AI analytics modules (Intrusion, Vehicle, Anomaly, ANPR).
7. Event database, metadata store, and reporting engine.
8. Search and investigation subsystem for priority cameras.
9. On-site deployment, hardware configuration, and camera calibration.
10. Operator and administrator training manuals.
11. Complete technical handover and maintenance documentation.

---

## 15. Assumptions & Dependencies

* Existing cameras and NVRs provide accessible RTSP/ONVIF streams.
* Network cabling and switch infrastructure can support continuous local video streaming.
* Stakeholders furnish timely technical data and site access.
* Hardware procurement (GPU servers, storage arrays) aligns with the 3-month schedule.
* Any third-party integration licenses or vendor SDKs are acquired during the discovery phase.
* Acceptance test protocols are finalized collaboratively prior to final sign-off.
