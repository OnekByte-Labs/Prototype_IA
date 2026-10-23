"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon, StatusIndicator } from "@/components/ds";
import { PlateBadge } from "./PlateBadge";
import type { AnprLogRecord } from "@/app/api/v1/anpr/route";

interface AnprDetailRowProps {
  record: AnprLogRecord;
  allLogs: AnprLogRecord[];
  onFilterPlate: (plate: string) => void;
  onClose: () => void;
}

export function AnprDetailRow({
  record,
  allLogs,
  onFilterPlate,
  onClose,
}: AnprDetailRowProps) {
  const router = useRouter();
  const [showFullImageModal, setShowFullImageModal] = useState(false);

  // Find all sightings of this exact vehicle plate across the fleet
  const sightings = useMemo(() => {
    return allLogs
      .filter((l) => l.plate === record.plate || l.rawPlate === record.rawPlate)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [allLogs, record.plate, record.rawPlate]);

  const categoryColor = {
    Car: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    Truck: "text-blue-400 border-blue-500/30 bg-blue-500/10",
    Bus: "text-purple-400 border-purple-500/30 bg-purple-500/10",
    Taxi: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    Auto: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    Motorcycle: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
  }[record.vehicleType] ?? "text-white border-white/20 bg-white/10";

  const handleDownloadCrop = () => {
    if (!record.carCropUrl) return;
    const a = document.createElement("a");
    a.href = record.carCropUrl;
    a.download = `${record.id}_${record.rawPlate}_crop.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <tr className="bg-canvas/90 border-b border-line shadow-inner">
        <td colSpan={10} className="p-4">
          <div className="bg-surface border border-line rounded-xl p-4 flex flex-col xl:flex-row gap-6 shadow-card">
            
            {/* 1. Registration Readout & Profile */}
            <div className="w-full xl:w-64 shrink-0 flex flex-col gap-3 pb-4 xl:pb-0 xl:border-r border-line xl:pr-6">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider">
                  Registration Readout
                </span>
                <StatusIndicator tone={record.confidence >= 0.85 ? "ok" : "warn"}>
                  {(record.confidence * 100).toFixed(1)}% conf
                </StatusIndicator>
              </div>

              <div className="py-2 flex items-center justify-center bg-black/40 rounded-lg border border-line p-3">
                <PlateBadge
                  plate={record.plate}
                  size="lg"
                  isCommercial={record.vehicleType === "Truck" || record.vehicleType === "Taxi" || record.vehicleType === "Auto"}
                />
              </div>

              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                <Icon name="check_circle" size={14} className="shrink-0" />
                <span>Format Validated & Matched</span>
              </div>

              <div className="flex flex-col gap-1 text-ui">
                <div className="flex items-center justify-between">
                  <span className="text-ink-2">Class:</span>
                  <span className={`px-2 py-0.5 rounded text-caption font-semibold border ${categoryColor}`}>
                    {record.vehicleType}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-2">Make / Model:</span>
                  <span className="font-semibold text-ink">{record.model || "Standard"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-2">Speed estimate:</span>
                  <span className="font-data text-ink">{record.speedKmh} km/h</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-2">Track ID:</span>
                  <span className="font-data text-ink-3">#{record.trackId}</span>
                </div>
              </div>

              <div className="pt-2 flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onFilterPlate(record.plate)}
                  title="Filter all sightings of this plate"
                >
                  <Icon name="filter_alt" size={14} /> Filter this plate ({sightings.length})
                </Button>
                <Button
                  size="sm"
                  onClick={() => router.push(`/cameras?camera=${record.cameraId}`)}
                >
                  <Icon name="videocam" size={14} /> View in Cameras
                </Button>
              </div>
            </div>

            {/* 2. Visual Evidence & Vehicle Crop (The user's requested verification feature) */}
            <div className="w-full xl:w-80 shrink-0 flex flex-col gap-2.5 pb-4 xl:pb-0 xl:border-r border-line xl:pr-6">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider flex items-center gap-1.5">
                  Visual Evidence & Crop
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  Peak Conf Match
                </span>
              </div>

              {/* Crop image container */}
              <div
                className="relative rounded-lg border border-line overflow-hidden bg-black aspect-video flex items-center justify-center group cursor-pointer shadow-inner"
                onClick={() => setShowFullImageModal(true)}
                title="Click to view full-resolution crop"
              >
                {record.carCropUrl ? (
                  <img
                    src={record.carCropUrl}
                    alt={`Crop of ${record.plate}`}
                    className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-105"
                  />
                ) : (
                  <div className="text-ink-3 text-caption flex flex-col items-center gap-1">
                    <Icon name="videocam_off" size={24} />
                    <span>No crop available</span>
                  </div>
                )}

                {/* Overlaid frame tag */}
                <div className="absolute top-2 left-2 bg-black/75 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-mono font-bold text-white border border-white/10 select-none">
                  FRAME #{record.frameIdx ?? 0}
                </div>

                {/* Click to inspect overlay hover button */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <span className="bg-canvas/90 text-ink text-[11px] font-medium px-2.5 py-1 rounded-md border border-line shadow flex items-center gap-1">
                    <Icon name="fullscreen" size={14} /> Enlarge Crop
                  </span>
                </div>
              </div>

              {/* Verification Telemetry Pill */}
              <div className="bg-canvas p-2.5 rounded-lg border border-line flex flex-col gap-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-ink-3">Detection Confidence:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {(record.confidence * 100).toFixed(1)}% (Optimal)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-3">Source Sensor:</span>
                  <span className="font-mono text-ink font-semibold">{record.cameraId} ({record.cameraName})</span>
                </div>
                <div className="text-ink-3 text-[10px] mt-0.5 pt-1 border-t border-line/60">
                  {record.verificationNote || `Extracted from frame #${record.frameIdx ?? 0} with highest confidence plate`}
                </div>
              </div>

              {/* Crop Actions */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => setShowFullImageModal(true)}
                >
                  <Icon name="fullscreen" size={14} /> Enlarge Crop
                </Button>
                {record.carCropUrl && (
                  <Button
                    size="sm"
                    onClick={handleDownloadCrop}
                    title="Download high-resolution vehicle crop"
                  >
                    <Icon name="download" size={14} /> Save Crop
                  </Button>
                )}
              </div>
            </div>

            {/* 3. Tactical Sensor & Geospatial Context */}
            <div className="flex-1 min-w-0 flex flex-col gap-3 pb-4 xl:pb-0 xl:border-r border-line xl:pr-6">
              <span className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider">
                Sensor & Tactical Telemetry
              </span>

              <div className="grid grid-cols-2 gap-3 text-caption">
                <div className="bg-canvas p-2.5 rounded-lg border border-line flex flex-col gap-1">
                  <span className="text-ink-3">Sensor Channel</span>
                  <span className="text-ui font-semibold text-ink font-data">{record.cameraId}</span>
                  <span className="text-ink-2 text-[11px] truncate">{record.cameraName}</span>
                </div>

                <div className="bg-canvas p-2.5 rounded-lg border border-line flex flex-col gap-1">
                  <span className="text-ink-3">Tactical Post & Sector</span>
                  <span className="text-ui font-semibold text-ink truncate">{record.sector}</span>
                  <span className="text-ink-2 text-[11px] truncate">{record.zone}</span>
                </div>

                <div className="bg-canvas p-2.5 rounded-lg border border-line flex flex-col gap-1">
                  <span className="text-ink-3">MGRS Grid Coordinate</span>
                  <span className="text-ui font-semibold text-ink font-data">{record.mgrs}</span>
                  <span className="text-ink-3 text-[10px]">Zone 43R Military Grid</span>
                </div>

                <div className="bg-canvas p-2.5 rounded-lg border border-line flex flex-col gap-1">
                  <span className="text-ink-3">Capture Timestamp</span>
                  <span className="text-ui font-semibold text-ink font-data">
                    {new Date(record.timestamp).toISOString().slice(11, 19)}Z
                  </span>
                  <span className="text-ink-3 text-[10px]">
                    {new Date(record.timestamp).toLocaleTimeString()} Local
                  </span>
                </div>
              </div>

              <div className="mt-auto bg-canvas/60 p-3 rounded-lg border border-line flex items-center justify-between">
                <div>
                  <div className="text-caption font-semibold text-ink">Target Bounding Box</div>
                  <div className="text-[11px] font-data text-ink-3">
                    X:{record.bbox?.[0] ?? 0} Y:{record.bbox?.[1] ?? 0} W:{record.bbox?.[2] ?? 0} H:{record.bbox?.[3] ?? 0}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => router.push(`/map?camera=${record.cameraId}`)}
                >
                  <Icon name="map" size={14} /> Open in Map
                </Button>
              </div>
            </div>

            {/* 4. Multi-Camera Sighting Intelligence Timeline */}
            <div className="w-full xl:w-72 shrink-0 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider">
                  Fleet Sightings History
                </span>
                <span className="font-data text-caption text-ink-2">
                  {sightings.length} {sightings.length === 1 ? "sighting" : "sightings"}
                </span>
              </div>

              <div className="flex-1 max-h-60 overflow-y-auto space-y-2 pr-1">
                {sightings.map((s, idx) => {
                  const isCurrent = s.id === record.id;
                  const timeStr = new Date(s.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });
                  return (
                    <div
                      key={s.id ? `${s.id}-${idx}` : `sighting-${idx}`}
                      className={`p-2 rounded-lg border text-caption flex items-start gap-2.5 transition-colors ${
                        isCurrent
                          ? "bg-accent/15 border-accent text-ink font-medium"
                          : "bg-canvas border-line text-ink-2 hover:bg-hover"
                      }`}
                    >
                      <div className="w-5 h-5 rounded-full bg-line flex items-center justify-center font-mono text-[10px] font-bold text-ink shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-ink font-data">{s.cameraId}</span>
                          <span className="text-[10px] text-ink-3 font-mono">{timeStr}</span>
                        </div>
                        <div className="text-[11px] text-ink-2 truncate">{s.cameraName}</div>
                        <div className="text-[10px] text-ink-3 truncate">{s.sector}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 flex justify-end">
                <Button size="sm" onClick={onClose}>
                  Close details
                </Button>
              </div>
            </div>

          </div>
        </td>
      </tr>

      {/* Full Resolution Modal for Visual Verification */}
      {showFullImageModal && record.carCropUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-150"
          onClick={() => setShowFullImageModal(false)}
        >
          <div
            className="bg-surface border border-line rounded-2xl max-w-3xl w-full p-5 flex flex-col gap-4 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-3">
                <PlateBadge
                  plate={record.plate}
                  size="md"
                  isCommercial={record.vehicleType === "Truck" || record.vehicleType === "Taxi" || record.vehicleType === "Auto"}
                />
                <div>
                  <h3 className="text-ui font-bold text-ink">
                    Optical Verification · {record.model} ({record.vehicleType})
                  </h3>
                  <p className="text-caption text-ink-3">
                    {record.cameraId} · Frame #{record.frameIdx ?? 0} · Confidence: {(record.confidence * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFullImageModal(false)}
                className="text-ink-3 hover:text-ink p-1 rounded-md hover:bg-hover"
              >
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="rounded-xl border border-line overflow-hidden bg-black flex items-center justify-center max-h-[65vh]">
              <img
                src={record.carCropUrl}
                alt={`Crop of ${record.plate}`}
                className="w-full h-auto max-h-[65vh] object-contain"
              />
            </div>

            <div className="flex items-center justify-between text-caption pt-1 border-t border-line">
              <span className="text-ink-3 font-mono">
                {record.cameraName} // MGRS: {record.mgrs}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleDownloadCrop}>
                  <Icon name="download" size={14} /> Download Crop
                </Button>
                <Button size="sm" variant="primary" onClick={() => setShowFullImageModal(false)}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
