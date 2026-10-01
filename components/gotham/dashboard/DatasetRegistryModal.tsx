"use client";

import { useState } from "react";
import { Badge, Button, Icon, KeyValue, Modal, Tabs } from "@/components/ds";
import {
  DATASET_CATALOG,
  type DatasetSource,
} from "@/lib/datasets/dataset-definitions";

interface DatasetRegistryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AGENT_SKILLS = [
  {
    name: "issue-workflow-sop",
    title: "Master Issue Workflow SOP",
    category: "Workflow & Automation",
    status: "Active",
    description:
      "Fully autonomous Zero-Touch SWE workflow from branch creation to strict build, in-depth testing, and Pull Request shipping.",
  },
  {
    name: "design-taste-frontend",
    title: "Anti-Slop Frontend Skill",
    category: "UI Engineering",
    status: "Active",
    description:
      "Contextual aesthetic inference, color calibration, typography discipline, layout diversification, and strict pre-flight checks.",
  },
  {
    name: "in-depth-testing-standards",
    title: "QA Automation & In-Depth Testing",
    category: "Quality Assurance",
    status: "Active",
    description:
      "Comprehensive test coverage for Happy Path, Validation & Edge Cases, and Security across frontend and backend modules.",
  },
  {
    name: "backend-engineering-standards",
    title: "Backend & API Architecture",
    category: "Backend & Services",
    status: "Active",
    description:
      "Zero-trust input validation (Zod), standardized JSON envelopes, N+1 query elimination, pagination, and unified error handling.",
  },
  {
    name: "ui-ux-pro-max",
    title: "UI/UX Pro Max Intelligence",
    category: "Experience Design",
    status: "Active",
    description:
      "Human-computer interaction guidelines, information density optimization, and tactical operator ergonomics.",
  },
  {
    name: "design-system",
    title: "Military Design Tokens & Consistency",
    category: "Design System",
    status: "Active",
    description:
      "Standardized palette (charcoal, tactical blues, radar greens, breach ambers/reds), square micro-dots, and hairline panels.",
  },
];

export function DatasetRegistryModal({ isOpen, onClose }: DatasetRegistryModalProps) {
  const [tab, setTab] = useState<"datasets" | "skills" | "pipeline">("datasets");

  const datasetKeys = Object.keys(DATASET_CATALOG) as DatasetSource[];

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="xl"
      title="Datasets & agent skills"
      description="Prototype registry"
      footer={
        <>
          <span className="mr-auto text-caption text-ink-3">Target sector: Kupwara, Northern Kashmir · Classification: Restricted</span>
          <Button onClick={onClose}>Dismiss</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Tabs
          label="Registry sections"
          value={tab}
          onChange={setTab}
          items={[
            { id: "datasets", label: "Public datasets", count: datasetKeys.length },
            { id: "skills", label: "Active agent skills", count: AGENT_SKILLS.length },
            { id: "pipeline", label: "Architecture pipeline" },
          ]}
        />

        {tab === "datasets" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {datasetKeys.map((key) => {
              const ds = DATASET_CATALOG[key];
              return (
                <div key={key} className="bg-surface border border-line rounded-lg p-4 flex flex-col gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-section text-ink">{ds.name}</h3>
                      <Badge>{ds.tier.charAt(0) + ds.tier.slice(1).replace("_", " ").toLowerCase()}</Badge>
                    </div>
                    <div className="text-caption text-ink-3 mb-1.5">{ds.provider}</div>
                    <p className="text-ui text-ink-2">{ds.demonstrationRole}</p>
                  </div>

                  <dl className="border-t border-line pt-2.5 flex flex-col gap-1.5">
                    <KeyValue label="Modality">{ds.modality}</KeyValue>
                    <KeyValue label="Model engine">{ds.inferenceModel}</KeyValue>
                    <KeyValue label="Latency" mono>{ds.modelLatencyMs} ms</KeyValue>
                    <KeyValue label="RTSP stream" mono>{ds.sampleRtspUri}</KeyValue>
                    <KeyValue label="Assigned cameras">{ds.targetCameras.join(", ")}</KeyValue>
                  </dl>

                  <div className="flex justify-between items-center text-caption">
                    <span className="text-ink-3">License: {ds.license}</span>
                    <a
                      href={ds.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-ink hover:underline inline-flex items-center gap-1"
                    >
                      Access link
                      <Icon name="open_in_new" size={13} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "skills" && (
          <div className="flex flex-col gap-3">
            <div className="p-4 bg-canvas rounded-lg shadow-inset-sm text-ui text-ink-2">
              <span className="text-ink font-semibold block mb-0.5">Active .agents customization system</span>
              The following specialized agent skills are active in this workspace, enforcing strict
              architectural standards, autonomous issue workflows, and frontend design calibration.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {AGENT_SKILLS.map((sk) => (
                <div key={sk.name} className="bg-surface border border-line rounded-lg p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-section text-ink">{sk.title}</h3>
                    <Badge tone="ok">{sk.status}</Badge>
                  </div>
                  <div className="text-caption text-ink-3 font-data">.agents/{sk.name}</div>
                  <p className="text-ui text-ink-2">{sk.description}</p>
                  <div className="border-t border-line pt-2 mt-auto flex justify-between text-caption text-ink-3">
                    <span>Category: {sk.category}</span>
                    <span className="font-data">v1.0 ready</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "pipeline" && (
          <div className="flex flex-col gap-4">
            <div className="bg-surface border border-line rounded-lg p-4">
              <h3 className="text-section text-ink mb-3">Transition pipeline flow (prototype to military deployment)</h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-center">
                {[
                  ["Stage 1", "MediaMTX", "RTSP loop server (:8554)"],
                  ["Stage 2", "DeepStream", "YOLOv11x + ByteTrack"],
                  ["Stage 3", "MQTT daemon", "JSON event engine"],
                  ["Stage 4", "Backend API", "Express.js + PostgreSQL"],
                  ["Stage 5", "Tactical UI", "Next.js WebRTC / sockets"],
                ].map(([stage, name, sub]) => (
                  <div key={stage} className="p-3 bg-canvas rounded-md shadow-inset-sm flex flex-col items-center gap-0.5">
                    <span className="text-caption text-ink-3">{stage}</span>
                    <strong className="text-ui text-ink">{name}</strong>
                    <span className="text-caption text-ink-2">{sub}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 p-3 bg-accent-wash rounded-md text-ui text-ink-2">
                <strong className="text-ink block mb-0.5">Zero-rewrite military migration</strong>
                The RTSP server acts as an abstraction layer. In production at the Kupwara border,
                we simply update the RTSP URLs in the database from <code className="font-data text-data">rtsp://localhost:8554/...</code>{" "}
                to the live IP addresses of the battalion CP Plus NVRs. The core inference and tactical
                UI pipeline remains 100% unchanged.
              </div>
            </div>

            <div className="bg-surface border border-line rounded-lg p-4">
              <h3 className="text-section text-ink mb-3">Hardware sizing (battalion on-premise)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  ["AI workloads", "30–35 channels"],
                  ["Total cameras", "100–120 CCTV / NVRs"],
                  ["Dev compute", "1× RTX 3090/4090 (64 GB)"],
                  ["Air-gap status", "100% local / on-premise"],
                ].map(([k, v]) => (
                  <div key={k} className="p-3 bg-canvas rounded-md shadow-inset-sm">
                    <span className="text-caption text-ink-2 block">{k}</span>
                    <span className="text-ui text-ink font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
