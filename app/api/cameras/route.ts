import { NextResponse } from 'next/server';
import { CAMERAS } from '@/lib/gotham/model';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pipelineHost = process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

  try {
    const res = await fetch(`${pipelineHost}/cameras`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`Pipeline returned ${res.status}`);
    const cameras = await res.json();

    type PipelineCam = Record<string, unknown> & {
      id: string;
      name?: string;
      mjpegUrl?: string;
      metadataUrl?: string;
      label?: string;
      sector?: string;
      mgrs?: string;
      elevationM?: number;
      dataset?: string;
      aiWorkload?: string;
      videoUrl?: string;
      precomputedUrl?: string;
    };
    const rewritten = cameras.map((cam: PipelineCam, index: number) => {
      const fallback = CAMERAS.find((c) => c.id === cam.id);
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
        ...fallback,
        ...cam,
        label: cam.label || fallback?.label || `${cam.id} · ${cam.name}`,
        sector: cam.sector || fallback?.sector,
        mgrs: cam.mgrs || fallback?.mgrs,
        elevationM: cam.elevationM ?? fallback?.elevationM,
        dataset: cam.dataset || fallback?.dataset,
        aiWorkload: cam.aiWorkload || fallback?.aiWorkload,
        videoUrl: cam.videoUrl || fallback?.videoUrl || `/api/videos/${cam.id}`,
        precomputedUrl: cam.precomputedUrl || fallback?.precomputedUrl || `/api/precomputed/${cam.id}`,
        mjpegUrl: mjpeg,
        metadataUrl: meta,
      };
    });

    return NextResponse.json(rewritten);
  } catch (error) {
    console.warn('[cameras] Pipeline unavailable, returning full fallback telemetry profiles:', error);
    return NextResponse.json(CAMERAS);
  }
}

