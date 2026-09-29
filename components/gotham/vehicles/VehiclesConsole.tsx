"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  MOCK_VEHICLES,
  type TrackedVehicle,
  type VehicleStatus,
} from "@/lib/vehicles-data";
import { CAMERAS } from "@/lib/gotham/model";
import { Button, MicroLabel, StatusDot } from "../primitives";
import { useToast } from "../Toast";

type StatusFilter = VehicleStatus | "all";

export function VehiclesConsole() {
  const toast = useToast();
  const [vehicles, setVehicles] = useState<TrackedVehicle[]>(MOCK_VEHICLES);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [cameraFilter, setCameraFilter] = useState<string>("all");
  const [selectedVehicle, setSelectedVehicle] = useState<TrackedVehicle | null>(null);

  // Filtered vehicles
  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (
        cameraFilter !== "all" &&
        !v.sightings.some((s) => s.cameraId === cameraFilter)
      ) {
        return false;
      }
      if (q) {
        const hay = `${v.plate} ${v.cleanPlate} ${v.makeModel} ${v.category} ${v.color} ${v.driver ?? ""} ${v.unitOrAffiliation} ${v.sightings.map((s) => `${s.cameraId} ${s.cameraName}`).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [vehicles, search, statusFilter, cameraFilter]);

  // KPIs
  const totalVehicles = vehicles.length;
  const flaggedCount = vehicles.filter((v) => v.status === "flagged").length;
  const authorizedCount = vehicles.filter((v) => v.status === "authorized").length;
  const avgOcr = (
    vehicles.reduce((acc, v) => acc + v.ocrConfidence, 0) / (vehicles.length || 1)
  ).toFixed(1);

  const toggleFlagStatus = (plate: string) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.plate === plate) {
          const nextStatus: VehicleStatus =
            v.status === "flagged" ? "authorized" : "flagged";
          const updated = {
            ...v,
            status: nextStatus,
            statusReason:
              nextStatus === "flagged"
                ? "Flagged by Watchfloor Operator manual override"
                : "Security clearance re-verified by Operator",
          };
          if (selectedVehicle?.plate === plate) {
            setSelectedVehicle(updated);
          }
          toast(
            `Vehicle [${plate}] status changed to ${nextStatus.toUpperCase()}`,
            nextStatus === "flagged" ? "err" : "ok"
          );
          return updated;
        }
        return v;
      })
    );
  };

  const exportCsv = () => {
    const headers = [
      "License Plate",
      "Make & Model",
      "Category",
      "Status",
      "Driver",
      "Affiliation",
      "Clearance",
      "OCR Confidence",
      "Cameras Spotted In",
      "Last Camera",
      "Last Timestamp",
    ];

    const rows = filteredVehicles.map((v) => [
      v.plate,
      `"${v.makeModel}"`,
      `"${v.category}"`,
      v.status.toUpperCase(),
      `"${v.driver ?? "N/A"}"`,
      `"${v.unitOrAffiliation}"`,
      v.securityClearance,
      `${v.ocrConfidence}%`,
      `"${v.sightings.map((s) => s.cameraId).join(", ")}"`,
      `"${v.lastCameraId} - ${v.lastCameraName}"`,
      v.lastSpotted,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `anpr-vehicle-intelligence-${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast(`Exported ${filteredVehicles.length} vehicle records to CSV`, "ok");
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-g-bg text-g-text">
      {/* ------------------------------------------------------------- KPI Bar */}
      <div className="shrink-0 p-3 grid grid-cols-4 gap-2 bg-g-panel border-b border-g-border">
        <div className="p-3 bg-g-surface border border-g-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-micro uppercase text-g-muted">
            <span>Tracked Vehicles</span>
            <Icon name="directions_car" size={16} className="text-g-blue" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-data font-bold text-g-text">
              {totalVehicles}
            </span>
            <span className="text-micro text-g-muted">active in database</span>
          </div>
        </div>

        <div className="p-3 bg-g-surface border border-g-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-micro uppercase text-g-muted">
            <span>Authorized Cleared</span>
            <Icon name="verified" size={16} className="text-g-green" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-data font-bold text-g-green">
              {authorizedCount}
            </span>
            <span className="text-micro text-g-muted">green security passes</span>
          </div>
        </div>

        <div className="p-3 bg-g-surface border border-g-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-micro uppercase text-g-muted">
            <span>Flagged / Watchlist</span>
            <Icon name="warning" size={16} className="text-g-red" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-data font-bold text-g-red">
              {flaggedCount}
            </span>
            <span className="text-micro text-g-red">
              {flaggedCount > 0 ? "INTERCEPT REQUIRED" : "Nominal"}
            </span>
          </div>
        </div>

        <div className="p-3 bg-g-surface border border-g-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-micro uppercase text-g-muted">
            <span>FastPlateOCR Accuracy</span>
            <Icon name="memory" size={16} className="text-g-cyan" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-data font-bold text-g-cyan">
              {avgOcr}%
            </span>
            <span className="text-micro text-g-muted">zero-lag inference</span>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- Filter Bar */}
      <div className="h-11 shrink-0 px-3 flex items-center gap-3 bg-g-panel border-b border-g-border">
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-g-muted pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plate, vehicle, driver, or camera... (e.g. WZ092JV, CAM-01)"
            className="h-8 w-80 pl-8 pr-2.5 bg-g-bg border border-g-border-strong rounded-[2px] text-ui text-g-text placeholder:text-g-muted focus:border-g-blue focus:outline-none"
          />
        </div>

        {/* Status Filter Chips */}
        <div className="flex items-center gap-1 border-l border-g-border pl-3">
          {(["all", "authorized", "flagged", "escorted", "unregistered"] as StatusFilter[]).map(
            (status) => {
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`h-7 px-2.5 rounded-[2px] text-micro uppercase font-medium transition-none ${
                    active
                      ? "bg-g-blue text-white"
                      : "text-g-text-2 bg-g-surface hover:bg-g-hover border border-g-border"
                  }`}
                >
                  {status}
                </button>
              );
            }
          )}
        </div>

        {/* Camera Filter Dropdown */}
        <div className="flex items-center gap-2 border-l border-g-border pl-3">
          <MicroLabel>Spotted In</MicroLabel>
          <select
            value={cameraFilter}
            onChange={(e) => setCameraFilter(e.target.value)}
            className="h-7 px-2 bg-g-bg border border-g-border-strong rounded-[2px] text-ui text-g-text focus:border-g-blue focus:outline-none"
          >
            <option value="all">All Cameras (Any sector)</option>
            {CAMERAS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-data font-data text-g-muted">
            {filteredVehicles.length} of {totalVehicles} vehicles
          </span>
          <Button size="sm" onClick={exportCsv} title="Export current results as CSV">
            <Icon name="download" size={13} className="mr-1 inline-block" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ---------------------------------------------------- Main Table & Drawer */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Table View */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-g-panel">
              <tr className="h-8 border-b border-g-border text-left">
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[140px]">
                  Plate
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted">
                  Vehicle Details
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted">
                  Affiliation / Driver
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[120px]">
                  Status
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted">
                  Spotted In Cameras
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted w-[160px]">
                  Last Sighting
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted text-right w-[80px]">
                  OCR Conf
                </th>
                <th className="px-3 text-micro uppercase tracking-wider text-g-muted text-right w-[90px]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-g-border">
              {filteredVehicles.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="p-12 text-center text-g-muted font-mono"
                  >
                    No vehicles found matching current query or camera filters.
                  </td>
                </tr>
              ) : (
                filteredVehicles.map((v) => {
                  const isSelected = selectedVehicle?.plate === v.plate;
                  return (
                    <tr
                      key={v.plate}
                      onClick={() => setSelectedVehicle(v)}
                      className={`group h-12 cursor-pointer transition-none ${
                        isSelected
                          ? "bg-g-blue/15 border-l-2 border-l-g-blue"
                          : v.status === "flagged"
                          ? "bg-g-red/5 hover:bg-g-red/10 border-l-2 border-l-g-red"
                          : "hover:bg-g-hover border-l-2 border-l-transparent"
                      }`}
                    >
                      {/* Plate Badge */}
                      <td className="px-3">
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-amber-400 text-black font-mono font-bold text-xs rounded border border-amber-500 shadow-sm tracking-wider">
                          <span className="w-1.5 h-1.5 rounded-full bg-black/60" />
                          <span>{v.plate}</span>
                        </div>
                      </td>

                      {/* Vehicle Details */}
                      <td className="px-3">
                        <div className="text-ui text-g-text font-medium leading-tight">
                          {v.makeModel}
                        </div>
                        <div className="text-micro text-g-muted flex items-center gap-2 mt-0.5">
                          <span>{v.category}</span>
                          <span>•</span>
                          <span>{v.color}</span>
                        </div>
                      </td>

                      {/* Driver & Unit */}
                      <td className="px-3">
                        <div className="text-ui text-g-text truncate max-w-[220px]">
                          {v.driver || "Unidentified Driver"}
                        </div>
                        <div className="text-micro text-g-muted truncate max-w-[220px]">
                          {v.unitOrAffiliation}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[2px] text-micro uppercase font-bold tracking-wider ${
                            v.status === "authorized"
                              ? "bg-g-green/15 text-g-green border border-g-green/30"
                              : v.status === "flagged"
                              ? "bg-g-red/20 text-g-red border border-g-red/40 animate-pulse"
                              : v.status === "escorted"
                              ? "bg-g-amber/20 text-g-amber border border-g-amber/40"
                              : "bg-g-surface text-g-muted border border-g-border"
                          }`}
                        >
                          <StatusDot
                            tone={
                              v.status === "authorized"
                                ? "ok"
                                : v.status === "flagged"
                                ? "err"
                                : v.status === "escorted"
                                ? "warn"
                                : "idle"
                            }
                          />
                          {v.status}
                        </span>
                      </td>

                      {/* Spotted In Cameras */}
                      <td className="px-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {v.sightings.map((s) => (
                            <span
                              key={s.id}
                              title={`${s.cameraName} (${s.zone}) at ${s.timestamp} · ${s.direction.toUpperCase()} · ${s.speedKmh} km/h`}
                              className="px-1.5 py-0.5 rounded bg-g-surface border border-g-border-strong text-micro font-mono text-g-cyan hover:border-g-cyan hover:bg-g-raised cursor-help"
                            >
                              {s.cameraId}
                            </span>
                          ))}
                          <span className="text-micro text-g-muted">
                            ({v.sightings.length} {v.sightings.length === 1 ? "hit" : "hits"})
                          </span>
                        </div>
                      </td>

                      {/* Last Sighting */}
                      <td className="px-3">
                        <div className="text-data font-data text-g-text leading-tight">
                          {v.lastSpotted}
                        </div>
                        <div className="text-micro text-g-muted truncate max-w-[150px]">
                          {v.lastCameraId} · {v.lastCameraName}
                        </div>
                      </td>

                      {/* OCR Confidence */}
                      <td className="px-3 text-right">
                        <span className="text-data font-data text-g-cyan font-bold">
                          {v.ocrConfidence.toFixed(1)}%
                        </span>
                      </td>

                      {/* Action */}
                      <td className="px-3 text-right">
                        <Button
                          size="sm"
                          onClick={() => setSelectedVehicle(v)}
                        >
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ---------------------------------------------- Sighting Dossier Drawer */}
        {selectedVehicle && (
          <div className="w-[420px] shrink-0 bg-g-panel border-l border-g-border flex flex-col z-20 shadow-2xl animate-g-in">
            {/* Drawer Header */}
            <div className="h-12 px-4 flex items-center justify-between border-b border-g-border bg-g-surface">
              <div className="flex items-center gap-2">
                <Icon name="badge" size={16} className="text-g-blue" />
                <span className="text-ui font-bold text-g-text uppercase tracking-wide">
                  Vehicle Tactical Dossier
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedVehicle(null)}
                className="w-7 h-7 flex items-center justify-center text-g-text-2 hover:text-g-text hover:bg-g-hover rounded"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Dossier Body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {/* Plate Banner */}
              <div className="p-4 bg-g-bg border border-g-border-strong rounded flex items-center justify-between">
                <div>
                  <MicroLabel>License Plate (FastPlateOCR)</MicroLabel>
                  <div className="mt-1.5 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-400 text-black font-mono font-bold text-base rounded border border-amber-500 shadow tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-black/60" />
                    <span>{selectedVehicle.plate}</span>
                  </div>
                </div>
                <div className="text-right">
                  <MicroLabel>Confidence</MicroLabel>
                  <div className="text-lg font-data font-bold text-g-cyan">
                    {selectedVehicle.ocrConfidence}%
                  </div>
                </div>
              </div>

              {/* Status and Actions Bar */}
              <div className="flex items-center justify-between p-3 bg-g-surface border border-g-border rounded">
                <div>
                  <MicroLabel>Security Status</MicroLabel>
                  <div className="text-ui font-bold uppercase mt-0.5 text-g-text">
                    {selectedVehicle.status}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={selectedVehicle.status === "flagged" ? "default" : "danger"}
                  onClick={() => toggleFlagStatus(selectedVehicle.plate)}
                >
                  {selectedVehicle.status === "flagged" ? "Clear Flag" : "Flag Vehicle"}
                </Button>
              </div>

              {selectedVehicle.statusReason && (
                <div className="p-2.5 bg-g-red/10 border border-g-red/30 rounded text-micro text-g-red">
                  <strong>Status Advisory:</strong> {selectedVehicle.statusReason}
                </div>
              )}

              {/* Profile Details */}
              <div className="p-3 bg-g-surface border border-g-border rounded space-y-2.5">
                <MicroLabel>Vehicle Specifications & Crew</MicroLabel>
                <div className="grid grid-cols-2 gap-2 text-ui">
                  <div>
                    <span className="text-micro text-g-muted block">Make & Model</span>
                    <span className="font-medium text-g-text">
                      {selectedVehicle.makeModel}
                    </span>
                  </div>
                  <div>
                    <span className="text-micro text-g-muted block">Class</span>
                    <span className="font-medium text-g-text">
                      {selectedVehicle.category}
                    </span>
                  </div>
                  <div>
                    <span className="text-micro text-g-muted block">Color</span>
                    <span className="font-medium text-g-text">
                      {selectedVehicle.color}
                    </span>
                  </div>
                  <div>
                    <span className="text-micro text-g-muted block">Clearance</span>
                    <span className="font-medium text-g-green">
                      {selectedVehicle.securityClearance}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-micro text-g-muted block">Driver</span>
                    <span className="font-medium text-g-text">
                      {selectedVehicle.driver || "Unidentified Driver"}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-micro text-g-muted block">Affiliation</span>
                    <span className="font-medium text-g-text">
                      {selectedVehicle.unitOrAffiliation}
                    </span>
                  </div>
                </div>
              </div>

              {/* Multi-Camera Sightings Journey Trail */}
              <div className="p-3 bg-g-surface border border-g-border rounded space-y-3">
                <div className="flex items-center justify-between">
                  <MicroLabel>Sightings Journey ({selectedVehicle.sightings.length} Cameras)</MicroLabel>
                  <span className="text-micro text-g-cyan font-mono">
                    Time Span: {selectedVehicle.firstSpotted} → {selectedVehicle.lastSpotted}
                  </span>
                </div>

                <div className="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-g-border-strong">
                  {selectedVehicle.sightings.map((s, idx) => (
                    <div key={s.id} className="relative">
                      {/* Step circle */}
                      <span className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-g-panel border-2 border-g-blue flex items-center justify-center text-[10px] font-bold text-g-blue">
                        {idx + 1}
                      </span>
                      <div className="bg-g-bg border border-g-border p-2.5 rounded space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-ui font-bold text-g-text font-mono">
                            {s.cameraId} · {s.cameraName}
                          </span>
                          <span className="text-micro font-mono text-g-cyan">
                            {s.timestamp}
                          </span>
                        </div>
                        <div className="text-micro text-g-muted flex items-center gap-2">
                          <span className="uppercase">{s.zone}</span>
                          <span>•</span>
                          <span className="capitalize">{s.direction}</span>
                          <span>•</span>
                          <span>{s.speedKmh} km/h</span>
                          <span>•</span>
                          <span className="text-g-cyan">{s.confidence.toFixed(1)}% OCR</span>
                        </div>
                        {s.notes && (
                          <div className="text-micro text-g-text-2 bg-g-panel p-1.5 rounded border border-g-border mt-1">
                            {s.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-3 border-t border-g-border bg-g-surface flex items-center justify-between">
              <Button
                size="sm"
                onClick={() =>
                  toast(`Gate pass printed for [${selectedVehicle.plate}]`, "ok")
                }
              >
                <Icon name="print" size={14} className="mr-1 inline-block" />
                Print Pass
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  toast(
                    `Live ANPR tracking lock acquired for [${selectedVehicle.plate}]`,
                    "ok"
                  )
                }
              >
                <Icon name="track_changes" size={14} className="mr-1 inline-block" />
                Lock Track
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- Status Bar */}
      <div className="h-7 shrink-0 px-3 flex items-center justify-between bg-g-panel border-t border-g-border">
        <MicroLabel>
          FastPlateOCR & ByteTrack ANPR Engine · Real-time multi-camera plate correlation active
        </MicroLabel>
        <span className="flex items-center gap-1.5 text-micro uppercase text-g-muted">
          <StatusDot tone="ok" />
          Zero-Lag Precomputed Plate Pipeline Ready
        </span>
      </div>
    </div>
  );
}
