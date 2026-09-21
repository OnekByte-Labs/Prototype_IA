"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  DATASET_CATALOG,
  type DatasetSource,
} from "@/lib/datasets/dataset-definitions";
import { MicroLabel } from "../primitives";

interface DatasetRegistryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AGENT_SKILLS = [
  {
    name: "issue-workflow-sop",
    title: "Master Issue Workflow SOP",
    category: "Workflow & Automation",
    status: "ACTIVE",
    description:
      "Fully autonomous Zero-Touch SWE workflow from branch creation to strict build, in-depth testing, and Pull Request shipping.",
  },
  {
    name: "design-taste-frontend",
    title: "Anti-Slop Frontend Skill",
    category: "UI Engineering",
    status: "ACTIVE",
    description:
      "Contextual aesthetic inference, color calibration, typography discipline, layout diversification, and strict pre-flight checks.",
  },
  {
    name: "in-depth-testing-standards",
    title: "QA Automation & In-Depth Testing",
    category: "Quality Assurance",
    status: "ACTIVE",
    description:
      "Comprehensive test coverage for Happy Path, Validation & Edge Cases, and Security across frontend and backend modules.",
  },
  {
    name: "backend-engineering-standards",
    title: "Backend & API Architecture",
    category: "Backend & Services",
    status: "ACTIVE",
    description:
      "Zero-trust input validation (Zod), standardized JSON envelopes, N+1 query elimination, pagination, and unified error handling.",
  },
  {
    name: "ui-ux-pro-max",
    title: "UI/UX Pro Max Intelligence",
    category: "Experience Design",
    status: "ACTIVE",
    description:
      "Human-computer interaction guidelines, information density optimization, and tactical operator ergonomics.",
  },
  {
    name: "design-system",
    title: "Military Design Tokens & Consistency",
    category: "Design System",
    status: "ACTIVE",
    description:
      "Standardized palette (charcoal, tactical blues, radar greens, breach ambers/reds), square micro-dots, and hairline panels.",
  },
];

export function DatasetRegistryModal({ isOpen, onClose }: DatasetRegistryModalProps) {
  const [tab, setTab] = useState<"datasets" | "skills" | "pipeline">("datasets");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="bg-g-panel border border-g-border rounded-[4px] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden font-mono text-ui">
        {/* Modal Header */}
        <header className="h-10 px-4 flex items-center justify-between border-b border-g-border bg-[#080d10] shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-g-blue animate-pulse" />
            <MicroLabel>PROTOTYPE REGISTRY // DATASETS & AGENT SKILLS</MicroLabel>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTab("datasets")}
              className={`px-3 py-1 rounded-[2px] text-micro uppercase transition-none ${
                tab === "datasets"
                  ? "bg-g-blue text-white font-bold"
                  : "text-g-text-2 hover:text-g-text hover:bg-g-hover"
              }`}
            >
              Public Datasets (6)
            </button>
            <button
              type="button"
              onClick={() => setTab("skills")}
              className={`px-3 py-1 rounded-[2px] text-micro uppercase transition-none ${
                tab === "skills"
                  ? "bg-g-blue text-white font-bold"
                  : "text-g-text-2 hover:text-g-text hover:bg-g-hover"
              }`}
            >
              Active Agent Skills (6)
            </button>
            <button
              type="button"
              onClick={() => setTab("pipeline")}
              className={`px-3 py-1 rounded-[2px] text-micro uppercase transition-none ${
                tab === "pipeline"
                  ? "bg-g-blue text-white font-bold"
                  : "text-g-text-2 hover:text-g-text hover:bg-g-hover"
              }`}
            >
              Architecture Pipeline
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-g-muted hover:text-g-text p-1 rounded"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#06080a]">
          {tab === "datasets" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(Object.keys(DATASET_CATALOG) as DatasetSource[]).map((key) => {
                const ds = DATASET_CATALOG[key];
                return (
                  <div
                    key={key}
                    className="bg-g-bg border border-g-border rounded p-3 flex flex-col justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-bold text-g-text text-sm">{ds.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white font-mono">
                          {ds.tier.replace("_", " ")}
                        </span>
                      </div>
                      <div className="text-micro text-g-muted mb-2">{ds.provider}</div>
                      <p className="text-micro text-g-text-2 leading-relaxed mb-3">
                        {ds.demonstrationRole}
                      </p>
                    </div>

                    <div className="border-t border-g-border/50 pt-2 space-y-1 text-[10px]">
                      <div className="flex justify-between">
                        <span className="text-g-muted">MODALITY:</span>
                        <span className="text-g-text">{ds.modality}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-g-muted">MODEL ENGINE:</span>
                        <span className="text-cyan-400 font-semibold">{ds.inferenceModel}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-g-muted">LATENCY:</span>
                        <span className="text-emerald-400">{ds.modelLatencyMs} ms</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-g-muted">RTSP STREAM:</span>
                        <span className="text-g-blue truncate max-w-[200px]">{ds.sampleRtspUri}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-g-muted">ASSIGNED CAMS:</span>
                        <span className="text-g-text-2">{ds.targetCameras.join(", ")}</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-between items-center text-[10px]">
                      <span className="text-g-muted">License: {ds.license}</span>
                      <a
                        href={ds.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-g-blue hover:underline flex items-center gap-1"
                      >
                        <span>Access Link</span>
                        <Icon name="open_in_new" size={10} />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "skills" && (
            <div className="space-y-3">
              <div className="p-3 bg-g-bg border border-g-border rounded text-micro text-g-text-2 leading-relaxed">
                <span className="text-g-text font-bold uppercase tracking-wider block mb-1">
                  Active .agents Customization System
                </span>
                The following specialized agent skills are active in this workspace, enforcing strict
                architectural standards, autonomous issue workflows, and frontend design calibration.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {AGENT_SKILLS.map((sk) => (
                  <div
                    key={sk.name}
                    className="bg-g-bg border border-g-border rounded p-3 flex flex-col justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-bold text-g-text text-sm">{sk.title}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-300">
                          {sk.status}
                        </span>
                      </div>
                      <div className="text-micro text-cyan-400 font-mono mb-2">
                        .agents/{sk.name}
                      </div>
                      <p className="text-micro text-g-text-2 leading-relaxed">{sk.description}</p>
                    </div>

                    <div className="border-t border-g-border/50 pt-2 flex justify-between items-center text-[10px] text-g-muted">
                      <span>Category: {sk.category}</span>
                      <span className="text-g-text-2 font-mono">v1.0 Ready</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "pipeline" && (
            <div className="space-y-4">
              <div className="bg-g-bg border border-g-border rounded p-4">
                <h4 className="font-bold text-g-text text-sm mb-2 uppercase tracking-wider">
                  Transition Pipeline Flow (Prototype to Military Deployment)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-micro text-center py-2">
                  <div className="p-2 bg-black/40 border border-g-border rounded flex flex-col items-center justify-center">
                    <span className="text-[10px] text-g-muted">STAGE 1</span>
                    <strong className="text-cyan-400">MediaMTX</strong>
                    <span className="text-[10px] text-g-text-2">RTSP Loop Server (:8554)</span>
                  </div>
                  <div className="p-2 bg-black/40 border border-g-border rounded flex flex-col items-center justify-center">
                    <span className="text-[10px] text-g-muted">STAGE 2</span>
                    <strong className="text-emerald-400">DeepStream</strong>
                    <span className="text-[10px] text-g-text-2">YOLOv11x + ByteTrack</span>
                  </div>
                  <div className="p-2 bg-black/40 border border-g-border rounded flex flex-col items-center justify-center">
                    <span className="text-[10px] text-g-muted">STAGE 3</span>
                    <strong className="text-purple-400">MQTT Daemon</strong>
                    <span className="text-[10px] text-g-text-2">JSON Event Engine</span>
                  </div>
                  <div className="p-2 bg-black/40 border border-g-border rounded flex flex-col items-center justify-center">
                    <span className="text-[10px] text-g-muted">STAGE 4</span>
                    <strong className="text-amber-400">Backend API</strong>
                    <span className="text-[10px] text-g-text-2">Express.js + PostgreSQL</span>
                  </div>
                  <div className="p-2 bg-black/40 border border-g-border rounded flex flex-col items-center justify-center">
                    <span className="text-[10px] text-g-muted">STAGE 5</span>
                    <strong className="text-blue-400">Tactical UI</strong>
                    <span className="text-[10px] text-g-text-2">Next.js WebRTC / Sockets</span>
                  </div>
                </div>

                <div className="mt-3 p-3 bg-blue-950/20 border border-blue-500/30 rounded text-micro text-g-text-2 leading-relaxed">
                  <strong className="text-blue-300 block mb-1">Zero-Rewrite Military Migration:</strong>
                  The RTSP Server acts as an abstraction layer. In production at the Kupwara border,
                  we simply update the RTSP URLs in the database from <code>rtsp://localhost:8554/...</code>
                  to the live IP addresses of the battalion CP Plus NVRs. The core inference and tactical
                  UI pipeline remains 100% unchanged.
                </div>
              </div>

              {/* Hardware Sizing */}
              <div className="bg-g-bg border border-g-border rounded p-4 text-micro space-y-2">
                <h4 className="font-bold text-g-text uppercase tracking-wider text-xs">
                  Hardware Sizing Specifications (Battalion On-Premise)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                  <div className="p-2 bg-black/40 border border-g-border rounded">
                    <span className="text-g-muted block">AI Workloads:</span>
                    <span className="text-g-text font-bold">30–35 Channels</span>
                  </div>
                  <div className="p-2 bg-black/40 border border-g-border rounded">
                    <span className="text-g-muted block">Total Cameras:</span>
                    <span className="text-g-text font-bold">100–120 CCTV/NVRs</span>
                  </div>
                  <div className="p-2 bg-black/40 border border-g-border rounded">
                    <span className="text-g-muted block">Dev Compute:</span>
                    <span className="text-g-text font-bold">1x RTX 3090/4090 (64GB)</span>
                  </div>
                  <div className="p-2 bg-black/40 border border-g-border rounded">
                    <span className="text-g-muted block">Air-Gap Status:</span>
                    <span className="text-emerald-400 font-bold">100% Local / On-Premise</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <footer className="h-9 px-4 flex items-center justify-between border-t border-g-border bg-[#080d10] shrink-0 text-micro">
          <span className="text-g-muted">
            Target Sector: Kupwara, Northern Kashmir · Classification: Restricted
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 bg-g-bg border border-g-border text-g-text-2 hover:text-g-text hover:bg-g-hover rounded-[2px]"
          >
            DISMISS
          </button>
        </footer>
      </div>
    </div>
  );
}
