"use client";

import useSWR from 'swr';
import type { Camera } from './dashboard-data';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useCameras() {
  const { data, error, isLoading } = useSWR<Camera[]>('/api/cameras', fetcher, {
    refreshInterval: 10000,
    fallbackData: [],
  });

  return {
    cameras: data || [],
    isLoading,
    isError: error,
  };
}
