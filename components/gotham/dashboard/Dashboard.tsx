"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DatasetSource } from "@/lib/datasets/dataset-definitions";
import { NVRS, cameraById, hms, type Alert } from "@/lib/gotham/model";
import { useConsole } from "../ConsoleProvider";
import { Button, ClassTag, KpiCard, Panel, SeverityChip, StatusDot } from "../primitives";
import { CameraWall } from "./CameraWall";
import {
  DatasetControlBar,
  type GridDensity,
  type TileMode,
} from "./DatasetControlBar";

/* ----------------------------------------------------------------- alert feed */

function FeedRow({
  a,
  onAck,
  onSelectCamera,
}: {
  a: Alert;
  onAck: (id: string) => void;
  onSelectCamera?: (cameraId: string) => void;
}) {
  const cam = cameraById(a.cameraId);
  const unacked = a.status === "new";

  return (
    <div
      data-testid="feed-row"
      data-status={a.status}
      onClick={() => onSelectCamera?.(a.cameraId)}
      title={`Click to focus ${a.cameraId} (${cam?.name ?? ""}) on tactical wall`}
      className={`group h-11 px-3 flex items-center gap-2.5 border-l-2 hover:bg-g-hover transition-none cursor-pointer ${
        unacked ? "border-l-g-red bg-red-950/10" : "border-l-transparent"
      } ${a.live ? "animate-g-in" : ""}`}
    >
      <span className="text-data font-data text-g-text-2 w-[58px] shrink-0">{hms(a.t)}</span>
      <ClassTag cls={a.cls} />
      <div className="min-w-0 flex-1">
        <div className={`text-ui truncate ${unacked ? "text-g-text font-medium" : "text-g-text-2"}`}>
          {a.cameraId} · {cam?.name ?? ""}
        </div>
        <div className="text-micro uppercase text-g-muted truncate">
          {a.zone} · {a.confidence.toFixed(1)}%
        </div>
      </div>
      <SeverityChip severity={a.severity} />
      {unacked ? (
        <Button
          size="sm"
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            onAck(a.id);
          }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100"
          title={`Acknowledge ${a.id}`}
        >
          Ack
        </Button>
      ) : (
        <span className="text-micro uppercase text-g-muted w-14 text-right truncate">
          {a.status === "dispatched" ? "QRF" : (a.ackBy ?? "Ack")}
        </span>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- device health */

function DeviceHealth({ degraded }: { degraded: string[] }) {
  const router = useRouter();

  return (
    <Panel
      label="Device health & NVR status"
      flush
      aside={
        <Link href="/devices" className="text-micro uppercase text-g-blue hover:underline">
          All devices
        </Link>
      }
    >
      <div className="divide-y divide-g-border">
        {NVRS.map((n) => {
          const pct = Math.round((n.usedTb / n.totalTb) * 100);
          const fault = n.state === "fault";
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => router.push("/devices")}
              className="w-full h-11 px-3 flex items-center gap-3 hover:bg-g-hover text-left transition-none"
            >
              <StatusDot tone={fault ? "err" : "ok"} />
              <div className="min-w-0 flex-1">
                <div className="text-ui text-g-text truncate">
                  {n.id} · {n.name}
                </div>
                <div className="text-micro uppercase text-g-muted truncate">
                  {n.camsOk}/{n.cams} cams · {n.tempC}°C
                </div>
              </div>
              <div className="w-16 shrink-0">
                <div className="h-1 bg-g-bg border border-g-border">
                  <div
                    className={`h-full ${pct >= 90 ? "bg-g-amber" : "bg-g-green"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-micro font-data text-g-muted mt-0.5 text-right">{pct}%</div>
              </div>
              <span
                className={`text-micro uppercase w-12 text-right shrink-0 ${fault ? "text-g-red" : "text-g-muted"}`}
              >
                {fault ? "Fault" : "OK"}
              </span>
            </button>
          );
        })}

        {degraded.map((id) => (
          <div
            key={id}
            data-testid="degraded-row"
            className="h-11 px-3 flex items-center gap-3 bg-g-red/5 border-l-2 border-l-g-red animate-g-in"
          >
            <StatusDot tone="err" className="animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="text-ui text-g-red truncate">{id} · link lost</div>
              <div className="text-micro uppercase text-g-muted truncate">
                Carrier drop · auto-recovery armed
              </div>
            </div>
            <span className="text-micro uppercase text-g-red shrink-0">Offline</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ dashboard */

export function Dashboard() {
  const { alerts, unacked, ack, cameras, degraded, liveOn, toggleLive } = useConsole();

  // Dataset & Matrix State
  const [activeDataset, setActiveDataset] = useState<DatasetSource | "ALL">("ALL");
  const [density, setDensity] = useState<GridDensity>(16);
  const [tileMode, setTileMode] = useState<TileMode>("all");
  const [showAiBoxes] = useState(false);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  const alertingCameraIds = useMemo(() => {
    return Array.from(new Set(alerts.filter((a) => a.status === "new").map((a) => a.cameraId)));
  }, [alerts]);

  const handleAcknowledgeCamera = (camId: string) => {
    const matchingAlerts = alerts.filter((a) => a.cameraId === camId && a.status === "new");
    matchingAlerts.forEach((a) => ack(a.id));
  };

  const offlineCams = cameras.filter((c) => !c.online);
  const nvrFaults = NVRS.filter((n) => n.state === "fault").length;
  const feed = alerts.slice(0, 7);

  const camTone = degraded.length ? "red" : offlineCams.length ? "amber" : "default";
  const camNote = degraded.length
    ? `${degraded[0]} link lost — recovering`
    : offlineCams.length
      ? `${offlineCams.map((c) => c.id).join(", ")} offline`
      : "Kupwara Battalion HQ Nominal";

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 p-2 overflow-hidden bg-[#06080a]">
      {/* Top KPI Strip */}
      <div className="grid grid-cols-4 gap-2 shrink-0">
        <KpiCard
          label="Battalion Cameras"
          value={
            <>
              32
              <span className="text-g-muted">/32 Active AI</span>
            </>
          }
          note={camNote}
          tone={camTone}
        />
        <KpiCard
          label="Unacknowledged Alerts"
          value={unacked}
          note={unacked ? "Operator Action Mandated" : "Sectors Clear"}
          tone={unacked ? "red" : "green"}
        />
        <KpiCard
          label="NVR Ingest Clusters"
          value={
            <>
              {NVRS.length - nvrFaults}
              <span className="text-g-muted">/{NVRS.length}</span>
            </>
          }
          note="CP Plus / RTSP Ingest Active"
          tone={nvrFaults ? "amber" : "default"}
        />
        <KpiCard
          label="24H Event Log"
          value={alerts.length}
          note={`${alerts.filter((a) => a.severity === "high").length} High Priority Breaches`}
        />
      </div>

      {/* Dataset & Matrix Diagnostic Control Bar */}
      <DatasetControlBar
        activeDataset={activeDataset}
        onSelectDataset={setActiveDataset}
        density={density}
        onChangeDensity={setDensity}
        tileMode={tileMode}
        onChangeTileMode={setTileMode}
        alertCount={alertingCameraIds.length}
      />

      {/* Surveillance Matrix & Side Intelligence Panels */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-2">
        {/* Left/Main Column: Tactical Camera Wall */}
        <div className="lg:col-span-3 min-h-0 flex flex-col">
          <CameraWall
            density={density}
            activeDataset={activeDataset}
            tileMode={tileMode}
            showAiBoxes={showAiBoxes}
            alertingCameraIds={alertingCameraIds}
            onAcknowledgeCamera={handleAcknowledgeCamera}
            selectedCameraId={selectedCameraId}
            onClearSelectedCamera={() => setSelectedCameraId(null)}
          />
        </div>

        {/* Right Column: Alert Feed & Hardware Health */}
        <div className="lg:col-span-2 min-h-0 grid grid-rows-2 gap-2">
          {/* Live Alert Feed */}
          <Panel
            label="Live alert feed"
            flush
            aside={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="live-toggle"
                  onClick={toggleLive}
                  title={liveOn ? "Pause live feed" : "Resume live feed"}
                  className="flex items-center gap-1 text-micro uppercase text-g-text-2 hover:text-g-text font-mono"
                >
                  <StatusDot tone={liveOn ? "ok" : "idle"} className={liveOn ? "animate-pulse" : ""} />
                  {liveOn ? "STREAM: LIVE" : "STREAM: PAUSED"}
                </button>
                <Link href="/alerts" className="text-micro uppercase text-g-blue hover:underline font-mono">
                  All Alerts
                </Link>
              </div>
            }
          >
            <div className="h-full overflow-y-auto divide-y divide-g-border">
              {feed.map((a) => (
                <FeedRow
                  key={a.id}
                  a={a}
                  onAck={ack}
                  onSelectCamera={(camId) => setSelectedCameraId(camId)}
                />
              ))}
            </div>
          </Panel>

          {/* Device & NVR Status */}
          <DeviceHealth degraded={degraded} />
        </div>
      </div>
    </div>
  );
}
