import { NextRequest, NextResponse } from "next/server";
import anprLogsData from "@/lib/datasets/anpr_logs.json";

export interface AnprLogRecord {
  id: string;
  eventId: number;
  timestamp: string;
  plate: string;
  rawPlate: string;
  vehicleType: "Car" | "Truck" | "Bus" | "Taxi" | "Auto" | "Motorcycle";
  model: string;
  cameraId: string;
  cameraName: string;
  sector: string;
  zone: string;
  mgrs: string;
  confidence: number;
  plateConfidence: number;
  trackId: number;
  speedKmh: number;
  status: "VERIFIED" | "FLAGGED" | "WATCHLIST" | "MULTI_SIGHTING";
  sightingsCount: number;
  bbox?: number[];
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const camera = url.searchParams.get("camera") ?? "all";
  const vehicleType = url.searchParams.get("vehicleType") ?? "all";
  const minConf = parseFloat(url.searchParams.get("minConf") ?? "0");
  const status = url.searchParams.get("status") ?? "all";
  const plateTarget = (url.searchParams.get("plate") ?? "").trim().toUpperCase();

  const allLogs = anprLogsData as AnprLogRecord[];

  let filtered = allLogs;

  if (plateTarget) {
    filtered = filtered.filter(
      (l) => l.plate.replace(/\s+/g, "") === plateTarget.replace(/\s+/g, "") || l.rawPlate === plateTarget
    );
  }

  if (camera !== "all") {
    filtered = filtered.filter((l) => l.cameraId.toUpperCase() === camera.toUpperCase());
  }

  if (vehicleType !== "all") {
    filtered = filtered.filter((l) => l.vehicleType.toLowerCase() === vehicleType.toLowerCase());
  }

  if (minConf > 0) {
    filtered = filtered.filter((l) => (l.confidence ?? 1) >= minConf);
  }

  if (status !== "all") {
    filtered = filtered.filter((l) => l.status === status);
  }

  if (q) {
    filtered = filtered.filter((l) => {
      const hay = `${l.id} ${l.plate} ${l.model} ${l.vehicleType} ${l.cameraId} ${l.cameraName} ${l.sector} ${l.zone} ${l.mgrs}`.toLowerCase();
      return hay.includes(q);
    });
  }

  const highConfCount = allLogs.filter((l) => (l.confidence ?? 0) >= 0.85).length;
  const uniquePlatesSet = new Set(allLogs.map((l) => l.plate));
  const activeCamerasSet = new Set(allLogs.map((l) => l.cameraId));
  const flaggedCount = allLogs.filter((l) => l.status === "FLAGGED" || l.status === "WATCHLIST").length;

  return NextResponse.json({
    stats: {
      totalCaptures: allLogs.length,
      uniquePlates: uniquePlatesSet.size,
      highConfidencePct: Number(((highConfCount / (allLogs.length || 1)) * 100).toFixed(1)),
      activeCameras: activeCamerasSet.size,
      flaggedCount,
      filteredCount: filtered.length,
    },
    logs: filtered,
  });
}
