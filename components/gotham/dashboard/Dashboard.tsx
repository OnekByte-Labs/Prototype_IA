"use client";

import { useMemo, useState } from "react";
import { useConsole } from "../ConsoleProvider";
import { CameraWall, type GridDensity } from "./CameraWall";
import { AlertFeedPanel, AlertHistogramPanel, DeviceTelemetryPanel, KpiCard, type LiveNvr } from "./GlassPanels";

/**
 * Main command dashboard — the Stitch "ISCC Liquid Glass Command Console":
 * four key figures and a 7/5 split (surveillance matrix + histogram |
 * real-time alerts + NVR telemetry) under the shared glass title bar and dock. Every figure,
 * tile and alert is the live console state; nothing here is simulated.
 */
export function Dashboard() {
  const { alerts: allAlerts, ack, cameras, degraded, liveOn, toggleLive, liveStreams, intrusionCameraIds, streamHealth } = useConsole();

  // Real NVRs: channels bound to live cameras and how many are streaming right now
  const liveNvrs = useMemo(() => {
    const by: Record<string, LiveNvr> = {};
    for (const [camId, s] of Object.entries(liveStreams)) {
      if (s.sourceType !== "rtsp" || !s.nvrId) continue;
      const n = (by[s.nvrId] ??= { id: s.nvrId, bound: 0, up: 0, kbps: 0, down: [] });
      const h = streamHealth[camId];
      n.bound += 1;
      if (h?.status === "CONNECTED" || h?.status === "DEGRADED") {
        n.up += 1;
        n.kbps += h.bitrate_kbps ?? 0;
      } else n.down.push(camId);
    }
    return Object.values(by).sort((a, b) => a.id.localeCompare(b.id));
  }, [liveStreams, streamHealth]);
  const liveAiCount = Object.keys(liveStreams).length;

  // The main dashboard is an intrusion console: only restricted-zone intrusion
  // alerts from the intrusion cameras. Other alert types live on the Alerts page.
  const alerts = useMemo(
    () => allAlerts.filter((a) => a.cls === "intrusion" && intrusionCameraIds.includes(a.cameraId)),
    [allAlerts, intrusionCameraIds],
  );
  const unacked = alerts.filter((a) => a.status === "new").length;

  // Wall state
  const [density, setDensity] = useState<GridDensity>(12);
  const [alertFirst, setAlertFirst] = useState(false);
  const [showAiBoxes, setShowAiBoxes] = useState(true);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  const alertingCameraIds = useMemo(
    () => Array.from(new Set(alerts.filter((a) => a.status === "new").map((a) => a.cameraId))),
    [alerts],
  );
  const handleAcknowledgeCamera = (camId: string) => {
    alerts.filter((a) => a.cameraId === camId && a.status === "new").forEach((a) => ack(a.id));
  };

  // Key figures
  const offlineCams = cameras.filter((c) => !c.online);
  const nvrUp = liveNvrs.reduce((a, n) => a + n.up, 0);
  const nvrBound = liveNvrs.reduce((a, n) => a + n.bound, 0);
  const nvrDown = liveNvrs.reduce((a, n) => a + n.down.length, 0);
  const deviceFaults = degraded.length + offlineCams.length + nvrDown;
  const liveNote = degraded.length
    ? `${degraded.length} reconnect`
    : offlineCams.length
      ? `${offlineCams[0].id} offline`
      : liveAiCount
        ? "All nominal"
        : "Start the backend";
  const faultNote = degraded[0]
    ? `${degraded[0]} link lost`
    : nvrDown
      ? `${liveNvrs.find((n) => n.down.length)?.down[0]} down`
      : offlineCams[0]
        ? `${offlineCams[0].id} offline`
        : undefined;

  return (
    <div className="h-full flex flex-col gap-2.5 overflow-y-auto lg:overflow-hidden">

      {/* Key figures */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 shrink-0" aria-label="Key figures">
        <KpiCard
          icon="videocam"
          label="Cameras online"
          value={liveAiCount}
          unit={`/ ${cameras.length}`}
          chip={liveAiCount ? `${((liveAiCount / Math.max(1, cameras.length)) * 100).toFixed(1)}%` : "AI OFFLINE"}
          note={liveNote}
          tone={!liveAiCount ? "crit" : degraded.length || offlineCams.length ? "warn" : "ok"}
        />
        <KpiCard
          icon="dns"
          label="NVR channels"
          value={nvrUp}
          unit={`/ ${nvrBound}`}
          chip={nvrBound ? `${Math.round((nvrUp / nvrBound) * 100)}% STREAMING` : "NO INGEST"}
          note={liveNvrs.map((n) => n.id).join(" · ") || "No live NVR"}
          tone={nvrBound && nvrUp === nvrBound ? "neutral" : nvrUp === 0 ? "crit" : "warn"}
        />
        <KpiCard
          icon="notifications_active"
          label="Active intrusions"
          value={unacked}
          unit={unacked ? "UNACKED" : "CLEAR"}
          chip={unacked ? "ACTION REQ" : "SECTORS CLEAR"}
          note={`${alerts.length} in log`}
          tone={unacked ? "crit" : "neutral"}
        />
        <KpiCard
          icon="build"
          label="Device faults"
          value={deviceFaults}
          unit={deviceFaults ? "PENDING" : "NONE"}
          chip={deviceFaults ? "ATTN PENDING" : "NOMINAL"}
          note={faultNote}
          tone={deviceFaults ? "warn" : "neutral"}
        />
      </section>

      {/* Operational workspace: matrix + histogram | alerts + telemetry */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 lg:flex-1 min-h-0 lg:overflow-hidden">
        <div className="lg:col-span-7 flex flex-col gap-2.5 min-h-[560px] lg:min-h-0 lg:h-full lg:overflow-hidden">
          <CameraWall
            density={density}
            onChangeDensity={setDensity}
            alertFirst={alertFirst}
            onChangeAlertFirst={setAlertFirst}
            showAiBoxes={showAiBoxes}
            alertingCameraIds={alertingCameraIds}
            onAcknowledgeCamera={handleAcknowledgeCamera}
            selectedCameraId={selectedCameraId}
            onClearSelectedCamera={() => setSelectedCameraId(null)}
          />
          <AlertHistogramPanel alerts={alerts} />
        </div>

        <div className="lg:col-span-5 flex flex-col gap-2.5 min-h-[480px] lg:min-h-0 lg:h-full lg:overflow-hidden">
          <AlertFeedPanel
            alerts={alerts}
            unacked={unacked}
            liveOn={liveOn}
            onToggleLive={toggleLive}
            onAck={ack}
            onSelect={setSelectedCameraId}
          />
          <DeviceTelemetryPanel nvrs={liveNvrs} degraded={degraded} />
        </div>
      </main>

    </div>
  );
}
