"use client";

import { useMemo } from "react";
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

  return (
    <tr className="bg-canvas/90 border-b border-line shadow-inner">
      <td colSpan={10} className="p-4">
        <div className="bg-surface border border-line rounded-xl p-4 flex flex-col lg:flex-row gap-6 shadow-card">
          {/* 1. Large Plate Card & Vehicle Header */}
          <div className="w-full lg:w-72 shrink-0 flex flex-col gap-3 pb-4 lg:pb-0 lg:border-r border-line lg:pr-6">
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

          {/* 2. Tactical Sensor & Geospatial Context */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 pb-4 lg:pb-0 lg:border-r border-line lg:pr-6">
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

            <div className="mt-2 bg-canvas/60 p-3 rounded-lg border border-line flex items-center justify-between">
              <div>
                <div className="text-caption font-semibold text-ink">Bounding Box Bounding Area</div>
                <div className="text-[11px] font-data text-ink-3">
                  X:{record.bbox?.[0] ?? 0} Y:{record.bbox?.[1] ?? 0} W:{record.bbox?.[2] ?? 0} H:{record.bbox?.[3] ?? 0}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => router.push(`/map?camera=${record.cameraId}`)}
              >
                <Icon name="map" size={14} /> Open in Tactical Map
              </Button>
            </div>
          </div>

          {/* 3. Multi-Camera Sighting Intelligence Timeline */}
          <div className="w-full lg:w-80 shrink-0 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider">
                Fleet Sightings History
              </span>
              <span className="font-data text-caption text-ink-2">
                {sightings.length} {sightings.length === 1 ? "sighting" : "sightings"}
              </span>
            </div>

            <div className="flex-1 max-h-56 overflow-y-auto space-y-2 pr-1">
              {sightings.map((s, idx) => {
                const isCurrent = s.id === record.id;
                const timeStr = new Date(s.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
                return (
                  <div
                    key={s.id}
                    className={`p-2 rounded-lg border text-caption flex items-start gap-2.5 transition-colors ${
                      isCurrent
                        ? "bg-accent/15 border-accent text-ink font-medium"
                        : "bg-canvas border-line text-ink-2 hover:bg-hover"
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-surface border border-line flex items-center justify-center text-[10px] font-data shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-ink font-data">{s.cameraId}</span>
                        <span className="text-[10px] font-data text-ink-3">{timeStr}</span>
                      </div>
                      <div className="text-[11px] text-ink-3 truncate">{s.cameraName}</div>
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
  );
}
