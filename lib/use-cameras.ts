"use client";

import useSWR from 'swr';
import type { Camera } from './dashboard-data';
import { apiFetcher } from './api-fetcher';

export function useCameras() {
  const { data, error, isLoading } = useSWR<Camera[]>('/api/cameras', apiFetcher, {
    refreshInterval: 10000,
    fallbackData: [],
  });

  return {
    cameras: data || [],
    isLoading,
    isError: error,
  };
}
