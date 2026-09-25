"use client";

import useSWR from 'swr';
import type { Camera } from './dashboard-data';
import type { CameraRow } from './devices-data';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useDeviceCameras() {
  const { data, error, isLoading } = useSWR<Camera[]>('/api/cameras', fetcher, {
    refreshInterval: 10000,
    fallbackData: [],
  });

  const std = [{ label: "PING", tone: "default" as const }, { label: "DIAG", tone: "default" as const }];

  const mappedCameras: CameraRow[] = (data || []).map((cam) => {
    return {
      state: cam.online ? "ok" : "err",
      id: cam.id,
      name: cam.label.split(' · ')[1] || cam.label,
      zone: "Unknown", // Would come from real API
      ip: "0.0.0.0", // Would come from real API
      model: "Unknown", // Would come from real API
      firmware: { text: "v1.0", tone: cam.online ? "ok" : "err" },
      stream: { label: cam.online ? "1080P30 HLS" : "NO SIGNAL", tone: cam.online ? "ok" : "err" },
      recording: { label: cam.online ? "ACTIVE" : "OFFLINE", tone: cam.online ? "ok" : "err" },
      storage: { label: "N/A", tone: "ok" },
      uptime: { label: cam.online ? "99.9%" : "0%", tone: cam.online ? "ok" : "err" },
      fault: { label: cam.online ? "None" : "Offline", tone: cam.online ? "ok" : "err" },
      actions: std,
    };
  });

  return {
    cameras: mappedCameras,
    isLoading,
    isError: error,
  };
}
