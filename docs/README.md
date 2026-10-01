# Project Documentation & System Specifications

This directory contains internal specifications, dataset integration guides, operational requirement documents, and technical gap analyses for the **Military Video Intelligence System** (Kupwara, Northern Kashmir Deployment).

> [!NOTE]
> This folder and its contents are intentionally excluded from version control via `.gitignore` to maintain confidentiality and isolation of deployment and tactical specifications.

---

## Documents Index

1. **[01_prototype_dataset_strategy.md](./01_prototype_dataset_strategy.md)**  
   *Prototype Dataset Strategy & Implementation Report (v1.0)*  
   Covers public dataset selection (VIRAT, MOT20, LLVIP, Kaggle Border, VisDrone, Sentinel-2), dataset-to-feature mapping, ingestion pipeline (MediaMTX -> DeepStream YOLOv11 -> MQTT -> Express -> React), mock data schemas, hardware sizing, and phased execution checklist.

2. **[02_army_deployment_requirements.md](./02_army_deployment_requirements.md)**  
   *Army Deployment Project: Kupwara, Northern Kashmir Proposal & Specifications*  
   Details operational philosophy (battalion C2 dashboard, 100–120 cameras with 30–35 active AI channels, 16–32 dynamic/fixed camera tiles), on-premise air-gapped constraints, CP Plus camera & NVR reuse, analytics modules (intrusion, anomaly, vehicle, ANPR), security & RBAC, and phased timeline.

3. **[03_system_architecture_and_gap_analysis.md](./03_system_architecture_and_gap_analysis.md)**  
   *System Architecture & Technical Gap Analysis*  
   Cross-references the operational requirements and dataset strategy with the current Next.js `military_ui` codebase. Evaluates existing UI components against target specs, identifies key engineering gaps (dynamic tile eviction, ANPR/investigation console, live RTSP/WebRTC streams, Kupwara geospatial overlay), and outlines the technical roadmap.
