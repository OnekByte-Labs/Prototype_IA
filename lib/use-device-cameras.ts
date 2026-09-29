"use client";

import useSWR from 'swr';
import { CAMERAS } from './gotham/model';
import type { Camera } from './dashboard-data';
import type { CameraRow } from './devices-data';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useDeviceCameras() {
  const { data, error, isLoading } = useSWR<Camera[]>('/api/cameras', fetcher, {
    refreshInterval: 10000,
    fallbackData: CAMERAS as unknown as Camera[],
  });

  const std = [{ label: "PING", tone: "default" as const }, { label: "DIAG", tone: "default" as const }];

  const mappedCameras: CameraRow[] = (data || []).map((cam) => {
    const isOnline = cam.online !== false;
    return {
      state: isOnline ? "ok" : "err",
      id: cam.id,
      name: cam.name || cam.label.split(' · ')[1] || cam.label,
      zone: cam.zone || "HQ COMPLEX",
      ip: cam.ip || "10.142.12.101",
      model: cam.model || "CP PLUS CP-UNC-TA51ZL6",
      firmware: { text: cam.firmware ? `v${cam.firmware}` : "v11.8", tone: isOnline ? "ok" : "err" },
      stream: { label: isOnline ? `${cam.resolution || "1080P"}@${cam.fps || 30}FPS` : "NO SIGNAL", tone: isOnline ? "ok" : "err" },
      recording: { label: cam.recording ? "ACTIVE" : "OFFLINE", tone: isOnline ? "ok" : "err" },
      storage: { label: "N/A", tone: "ok" },
      uptime: { label: isOnline ? `${cam.uptime ?? 99.9}%` : "0%", tone: isOnline ? "ok" : "err" },
      fault: { label: isOnline ? "None" : "Offline", tone: isOnline ? "ok" : "err" },
      actions: std,
    };
  });

  return {
    cameras: mappedCameras,
    isLoading,
    isError: error,
  };
}
