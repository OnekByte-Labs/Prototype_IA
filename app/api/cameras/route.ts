import { NextResponse } from 'next/server';
import { TACTICAL_CAMERAS } from '@/lib/datasets/dataset-definitions';
import { getCameraDetectionMode } from '@/lib/server/camera-modes';

export const dynamic = 'force-dynamic';

function getFallbackCameras() {
  return TACTICAL_CAMERAS.map((cam, index) => {
    const isOnline = index < 5; // CAM-01 to CAM-05
    const streamId = cam.id.toLowerCase().replace('-', '_');
    const override = getCameraDetectionMode(cam.id);
    const defaultMode = cam.id === 'CAM-03' ? 'vehicle' : isOnline ? 'both' : 'none';
    const mode = override ?? defaultMode;
    const active = mode === 'none' ? null : mode;
    const state = mode === 'none' ? 'idle' : 'running';
    return {
      id: cam.id,
      name: cam.name,
      label: `${cam.id} · ${cam.name}`,
      online: isOnline,
      hlsUrl: isOnline ? `/api/live/${streamId}/hls` : '',
      mjpegUrl: isOnline ? `/api/live/${streamId}/mjpeg` : undefined,
      metadataUrl: isOnline ? `/api/live/${streamId}/metadata` : undefined,
      aiEnabled: isOnline && mode !== 'none',
      streamId: streamId,
      width: 1920,
      height: 1080,
      detectionMode: mode,
      activeMode: active,
      pipelineState: state,
      pipelineError: null,
      stateSince: 0,
      sourceType: isOnline ? 'recorded' : 'none',
      nvrId: isOnline ? 'NVR-01' : null,
      channel: isOnline ? index + 1 : null,
      codec: isOnline ? 'H264' : null,
      stream: isOnline
        ? {
            status: 'CONNECTED',
            fps: 25.0,
            target_fps: 25.0,
            bitrate_kbps: 4200,
            latency_ms: 18,
            codec: 'H264',
            last_frame_age_s: 0.04,
          }
        : {
            status: 'DISCONNECTED',
            fps: 0,
            bitrate_kbps: 0,
          },
      webrtcProfiles: isOnline ? ['main_h264', 'sub'] : [],
    };
  });
}

export async function GET() {
  const pipelineHost = process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

  try {
    const res = await fetch(`${pipelineHost}/cameras`, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`Pipeline returned ${res.status}`);
    const cameras = await res.json();

    // Shard across distinct loopback addresses (127.0.0.1 - 127.0.0.20)
    // to bypass the browser's 6-connection-per-host limit in HTTP/1.1!
    const rewritten = cameras.map((cam: any, index: number) => {
      let mjpeg = cam.mjpegUrl;
      let meta = cam.metadataUrl;
      const hostIp = `127.0.0.${(index % 20) + 1}`;
      
      if (mjpeg) {
        mjpeg = mjpeg.replace(/127\.0\.0\.1|localhost/, hostIp);
      }
      if (meta) {
        meta = meta.replace(/127\.0\.0\.1|localhost/, hostIp);
      }

      return {
        ...cam,
        mjpegUrl: mjpeg,
        metadataUrl: meta,
      };
    });

    return NextResponse.json(rewritten);
  } catch (_error) {
    // Air-gapped / offline operational fallback: 5 online tactical AI camera streams
    return NextResponse.json(getFallbackCameras());
  }
}

