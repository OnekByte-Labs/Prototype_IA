"use client";

import { useEffect, useMemo } from "react";
import useSWR from "swr";
import { useConsole } from "@/components/gotham/ConsoleProvider";
import type { MapConfig, MapStatus } from "./types";

export const MAP_KEY = "/api/v1/map";

/** SWR key for a camera's relationships; the revision refreshes it after a saved edit. */
export const relationshipsKey = (cameraId: string, revision: number) =>
  `/api/v1/map/relationships?camera_id=${encodeURIComponent(cameraId)}&rev=${revision}`;

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error ?? `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

/** Overlay live statuses (WebSocket) on a config's entities. */
export function withStatuses(cfg: MapConfig, statuses?: Record<string, MapStatus>): MapConfig {
  if (!statuses) return cfg;
  const s = <T extends { id: string; status: MapStatus }>(e: T): T =>
    statuses[e.id] && statuses[e.id] !== e.status ? { ...e, status: statuses[e.id] } : e;
  return {
    ...cfg,
    battalion: cfg.battalion ? s(cfg.battalion) : null,
    companies: cfg.companies.map(s),
    posts: cfg.posts.map(s),
    cameras: cfg.cameras.map(s),
    nvrs: (cfg.nvrs ?? []).map(s),
  };
}

/**
 * The saved tactical map (hierarchy, placement, FOV) from the backend database,
 * with live Camera → Post → Company → Battalion status from the pipeline
 * WebSocket. Refetches whenever the WebSocket announces a newer saved revision.
 */
export function useTacticalMap() {
  const { mapLive } = useConsole();
  const { data, error, isLoading, mutate } = useSWR<MapConfig>(MAP_KEY, (u: string) => fetchJson<MapConfig>(u), {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  });

  const liveRevision = mapLive?.revision;
  useEffect(() => {
    if (data && liveRevision != null && liveRevision > data.revision) void mutate();
  }, [liveRevision, data, mutate]);

  const statuses = mapLive?.statuses;
  const config = useMemo(() => (data ? withStatuses(data, statuses) : null), [data, statuses]);
  return { config, saved: data ?? null, statuses, error: error as (Error & { status?: number }) | undefined, isLoading, mutate };
}
