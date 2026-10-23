"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  CameraTile,
  EmptyState,
  Icon,
  IconButton,
  Input,
  KeyValue,
  PageHeader,
  SegmentedControl,
  DataTable,
  StatusDot,
  StatusIndicator,
} from "@/components/ds";
import { cx } from "@/lib/design/cx";
import {
  DATASET_CATALOG,
  TACTICAL_CAMERAS,
  type DatasetSource,
} from "@/lib/datasets/dataset-definitions";
import { useConsole } from "@/components/gotham/ConsoleProvider";
import { TacticalVideoFeed } from "@/components/gotham/dashboard/TacticalVideoFeed";
import { RestrictedZoneEditor } from "@/components/gotham/dashboard/RestrictedZoneEditor";
import { DetectionModeSelector } from "@/components/gotham/dashboard/DetectionModeSelector";

type GridDensity = "2x2" | "3x3" | "4x4" | "all" | "table";
type ZoneFilter = "ALL" | "HQ COMPLEX" | "PERIMETER EAST" | "PERIMETER WEST" | "DEPOT" | "MOTOR POOL" | "TEST FEED";

/** `initialInspectId` opens that camera's inspector (tactical map → "Open in cameras"). */
export function CameraConsole({ initialInspectId }: { initialInspectId?: string } = {}) {
  const { alerts, liveStreams, cameras, pipelines } = useConsole();
  const [zoneEditorCamId, setZoneEditorCamId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedZone, setSelectedZone] = useState<ZoneFilter>("ALL");
  const [selectedDataset, setSelectedDataset] = useState<DatasetSource | "ALL">("ALL");
  const [density, setDensity] = useState<GridDensity>("4x4");
  const [inspectedCamId, setInspectedCamId] = useState<string | null>(initialInspectId ?? null);
  const [showAiBoxes, setShowAiBoxes] = useState(true);

  // Set of alerting camera IDs
  const alertingCameraIds = useMemo(() => {
    return new Set(alerts.filter((a) => a.status === "new").map((a) => a.cameraId));
  }, [alerts]);

  // Filtered cameras based on search, zone, dataset
  const filteredCameras = useMemo(() => {
    return TACTICAL_CAMERAS.filter((cam) => {
      if (selectedZone !== "ALL" && cam.zone !== selectedZone) return false;
      if (selectedDataset !== "ALL" && cam.dataset !== selectedDataset) return false;
      if (search.trim()) {
        const query = search.toLowerCase();
        const match =
          cam.id.toLowerCase().includes(query) ||
          cam.name.toLowerCase().includes(query) ||
          cam.ip.toLowerCase().includes(query) ||
          cam.model.toLowerCase().includes(query) ||
          cam.sector.toLowerCase().includes(query) ||
          cam.mgrs.toLowerCase().includes(query);
        if (!match) return false;
      }
      return true;
    });
  }, [search, selectedZone, selectedDataset]);

  const inspectedCamera = useMemo(() => {
    return TACTICAL_CAMERAS.find((c) => c.id === inspectedCamId) || null;
  }, [inspectedCamId]);


  const zones: ZoneFilter[] = [
    "ALL",
    "HQ COMPLEX",
    "PERIMETER EAST",
    "PERIMETER WEST",
    "DEPOT",
    "MOTOR POOL",
    "TEST FEED",
  ];

  const sectionTitle = (t: string) => <h4 className="text-ui font-semibold text-ink pb-1.5 border-b border-line">{t}</h4>;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Cameras"
        description="Live optical surveillance with real-time AI analytics"
        meta={
          <>
            <span className="tnum">{TACTICAL_CAMERAS.length} deployed</span>
            <StatusIndicator tone="ok" dim>
              {TACTICAL_CAMERAS.filter((c) => c.online).length} / {TACTICAL_CAMERAS.length} online
            </StatusIndicator>
            <StatusIndicator tone={alertingCameraIds.size > 0 ? "crit" : "idle"} dim={alertingCameraIds.size === 0}>
              {alertingCameraIds.size} unacknowledged
            </StatusIndicator>
          </>
        }
        actions={
          <Button
            pressed={showAiBoxes}
            onClick={() => setShowAiBoxes(!showAiBoxes)}
            title="Toggle real-time AI bounding box overlays"
          >
            <Icon name="grid_on" size={15} />
            AI overlay {showAiBoxes ? "on" : "off"}
          </Button>
        }
      />

      {/* Filters and density */}
      <div className="px-5 pb-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-80 shrink-0">
            <Icon
              name="search"
              size={16}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, name, sector, IP, MGRS…"
              aria-label="Search cameras"
              className="w-full pl-8 pr-8"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
              >
                <Icon name="close" size={15} />
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <SegmentedControl<ZoneFilter>
              label="Zone"
              value={selectedZone}
              onChange={setSelectedZone}
              items={zones.map((zone) => ({
                id: zone,
                label: `${zone === "ALL" ? "All" : zone} (${
                  zone === "ALL" ? TACTICAL_CAMERAS.length : TACTICAL_CAMERAS.filter((c) => c.zone === zone).length
                })`,
              }))}
            />
          </div>
        </div>

        <SegmentedControl<GridDensity>
          label="Layout"
          value={density}
          onChange={setDensity}
          items={[
            { id: "2x2", label: "2×2" },
            { id: "3x3", label: "3×3" },
            { id: "4x4", label: "4×4" },
            { id: "all", label: `All ${TACTICAL_CAMERAS.length}` },
            { id: "table", label: "Table" },
          ]}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 flex gap-3 px-5 pb-4 overflow-hidden">
        {/* Camera wall or table */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          {density === "table" ? (
            <DataTable
              className="border border-line rounded-lg bg-surface"
              rows={filteredCameras}
              rowKey={(cam) => cam.id}
              selectedKey={inspectedCamId}
              onRowClick={(cam) => setInspectedCamId(cam.id)}
              rowClassName={(cam) => (alertingCameraIds.has(cam.id) && inspectedCamId !== cam.id ? "bg-crit-wash/40" : undefined)}
              columns={[
                {
                  key: "camera",
                  header: "Camera",
                  cell: (cam) => (
                    <div className="flex items-center gap-2">
                      <StatusDot tone={alertingCameraIds.has(cam.id) ? "crit" : "ok"} />
                      <span className="font-data text-data text-ink">{cam.id}</span>
                      <span className="text-ink">{cam.name}</span>
                    </div>
                  ),
                },
                {
                  key: "sector",
                  header: "Sector / zone",
                  cell: (cam) => (
                    <span className="text-ink-2">
                      {cam.sector} <span className="text-ink-3">({cam.zone})</span>
                    </span>
                  ),
                },
                { key: "model", header: "Model", cell: (cam) => <span className="text-ink-2 truncate block max-w-[160px]">{cam.model}</span> },
                { key: "res", header: "Resolution & FPS", mono: true, cell: (cam) => <span className="text-ink-2">{cam.resolution} @ {cam.fps}fps</span> },
                { key: "ip", header: "IP", mono: true, cell: (cam) => <span className="text-ink-3">{cam.ip}</span> },
                {
                  key: "ai",
                  header: "Dataset / AI",
                  cell: (cam) => (
                    <Badge mono>
                      {cam.dataset} · {cam.aiWorkload}
                    </Badge>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (cam) =>
                    alertingCameraIds.has(cam.id) ? (
                      <StatusIndicator tone="crit" className="font-medium">Breach alert</StatusIndicator>
                    ) : (
                      <StatusIndicator tone="ok" dim>Nominal</StatusIndicator>
                    ),
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  cell: (cam) => (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectedCamId(cam.id);
                      }}
                    >
                      Inspect
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            <div
              className={`grid gap-3 ${
                density === "2x2"
                  ? "grid-cols-1 md:grid-cols-2"
                  : density === "3x3"
                    ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
                    : density === "4x4"
                      ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                      : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
              }`}
            >
              {filteredCameras.map((cam) => {
                const isBreached = alertingCameraIds.has(cam.id);
                const isInspected = inspectedCamId === cam.id;
                return (
                  <CameraTile
                    key={cam.id}
                    onClick={() => setInspectedCamId(cam.id)}
                    selected={isInspected}
                    alerting={isBreached && !isInspected}
                    className="cursor-pointer aspect-video"
                  >
                    <TacticalVideoFeed
                      camera={cam}
                      liveMjpegUrl={liveStreams[cam.id]?.mjpegUrl}
                      pipeline={pipelines[cam.id]}
                      focused={isInspected}
                      showAiBoxes={showAiBoxes}
                      isBreached={isBreached}
                      onClick={() => setInspectedCamId(cam.id)}
                    />
                  </CameraTile>
                );
              })}
            </div>
          )}

          {filteredCameras.length === 0 && (
            <div className="h-64">
              <EmptyState message="No tactical cameras match the current query and filters">
                <Button
                  onClick={() => {
                    setSearch("");
                    setSelectedZone("ALL");
                    setSelectedDataset("ALL");
                  }}
                >
                  Clear filters
                </Button>
              </EmptyState>
            </div>
          )}
        </div>

        {/* Camera inspector */}
        {inspectedCamera && (
          <aside className="w-80 lg:w-[380px] shrink-0 bg-surface border border-line rounded-lg shadow-card flex flex-col overflow-y-auto">
            <div className="min-h-11 shrink-0 px-4 py-2 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <StatusDot tone="ok" />
                <h2 className="text-section text-ink truncate">
                  <span className="font-data text-data mr-2">{inspectedCamera.id}</span>
                  Telemetry
                </h2>
              </div>
              <IconButton label="Close inspector" size="sm" onClick={() => setInspectedCamId(null)}>
                <Icon name="close" size={18} />
              </IconButton>
            </div>

            {/* Active stream preview */}
            <div className="p-4 border-b border-line">
              <CameraTile className="aspect-video w-full">
                <TacticalVideoFeed
                  camera={inspectedCamera}
                  liveMjpegUrl={liveStreams[inspectedCamera.id]?.mjpegUrl}
                  pipeline={pipelines[inspectedCamera.id]}
                  focused={true}
                  showAiBoxes={showAiBoxes}
                  isBreached={alertingCameraIds.has(inspectedCamera.id)}
                />
              </CameraTile>

              <div className="mt-2 flex items-center justify-between text-caption">
                <span className="text-ok-ink font-medium">Live optical surveillance</span>
                <span className="text-ink-3 font-data">{inspectedCamera.resolution}</span>
              </div>
            </div>

            {/* Runtime detection mode (backend-controlled pipeline) */}
            <div className="px-4 pt-4">
              <DetectionModeSelector cameraId={inspectedCamera.id} />
            </div>

            {/* Zone / counting line for the camera's current mode */}
            <RestrictedZonePanel
              cameraId={inspectedCamera.id}
              mode={pipelines[inspectedCamera.id]?.mode}
              zone={cameras.find((c) => c.id === inspectedCamera.id)?.analytics?.zone}
              line={cameras.find((c) => c.id === inspectedCamera.id)?.analytics?.line}
              onEdit={() => setZoneEditorCamId(inspectedCamera.id)}
            />

            {/* Specs and intelligence */}
            <div className="p-4 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                {sectionTitle("Location & sensor")}
                <dl className="flex flex-col gap-1.5">
                  <KeyValue label="Name">{inspectedCamera.name}</KeyValue>
                  <KeyValue label="Sector">{inspectedCamera.sector}</KeyValue>
                  <KeyValue label="Zone">{inspectedCamera.zone}</KeyValue>
                  <KeyValue label="MGRS grid" mono>{inspectedCamera.mgrs}</KeyValue>
                  <KeyValue label="Elevation" mono>{inspectedCamera.elevationM} m MSL</KeyValue>
                </dl>
              </div>

              <div className="flex flex-col gap-1.5">
                {sectionTitle("Hardware & carrier")}
                <dl className="flex flex-col gap-1.5">
                  <KeyValue label="Hardware">{inspectedCamera.model}</KeyValue>
                  <KeyValue label="IP address" mono>{inspectedCamera.ip}</KeyValue>
                  <KeyValue label="Sensor uptime" mono>{inspectedCamera.uptimePct}%</KeyValue>
                  <KeyValue label="Core temperature" mono>{inspectedCamera.tempC}°C</KeyValue>
                  <KeyValue label="Packet loss" mono>{inspectedCamera.packetLossPct}%</KeyValue>
                  <KeyValue label="Carrier status" mono>1000BASE-T locked</KeyValue>
                </dl>
              </div>

              <div className="flex flex-col gap-1.5">
                {sectionTitle("AI detection model")}
                <dl className="flex flex-col gap-1.5">
                  <KeyValue label="Dataset">{inspectedCamera.dataset}</KeyValue>
                  <KeyValue label="Inference model">
                    {DATASET_CATALOG[inspectedCamera.dataset]?.inferenceModel || "Neural-OpticalEdge"}
                  </KeyValue>
                  <KeyValue label="Workload">{inspectedCamera.aiWorkload}</KeyValue>
                  <KeyValue label="Latency" mono>
                    {DATASET_CATALOG[inspectedCamera.dataset]?.modelLatencyMs || 12.4} ms
                  </KeyValue>
                  <KeyValue label="Palette">Natural RGB optical</KeyValue>
                </dl>
              </div>
            </div>
          </aside>
        )}
      </div>
      {zoneEditorCamId && (
        <RestrictedZoneEditor
          cameraId={zoneEditorCamId}
          kind={pipelines[zoneEditorCamId]?.mode === "intrusion" ? "zone" : "line"}
          onClose={() => setZoneEditorCamId(null)}
        />
      )}
    </div>
  );
}

/** Inspector panel: the zone/line used by the camera's current detection mode. */
function RestrictedZonePanel({
  cameraId,
  mode,
  zone,
  line,
  onEdit,
}: {
  cameraId: string;
  mode?: string;
  zone?: number[][];
  line?: number[][];
  onEdit: () => void;
}) {
  const counting = mode === "vehicle_counting" || mode === "person_counting";
  if (mode !== "intrusion" && !counting) return null;
  const has = counting ? Boolean(line && line.length >= 2) : Boolean(zone && zone.length >= 3);
  return (
    <div className="px-4 pt-5 flex flex-col gap-2">
      <h4 className="text-ui font-semibold text-ink pb-1.5 border-b border-line">
        {counting ? "Counting line" : "Restricted zone · intrusion"}
      </h4>
      <div className="flex justify-between items-baseline gap-3">
        <span className="text-caption text-ink-2">Status</span>
        <span className={cx("text-ui font-medium text-right", has ? (counting ? "text-ink" : "text-crit-ink") : "text-warn-ink")}>
          {has
            ? counting
              ? `Active · ${line!.length} points`
              : `Armed · ${zone!.length} vertices`
            : counting
              ? "No line — draw one to count"
              : "No zone — draw one to arm"}
        </span>
      </div>
      <p className="text-caption text-ink-3">
        {counting
          ? `${cameraId} counts each tracked object once when it crosses the line.`
          : "Alerts fire once when a person enters the red zone; re-entry after leaving alerts again."}
      </p>
      <Button variant={counting ? "default" : "danger"} onClick={onEdit}>
        {counting
          ? has ? "Edit counting line" : "Draw counting line"
          : has ? "Edit restricted zone" : "Draw restricted zone"}
      </Button>
    </div>
  );
}
