import { NextResponse } from 'next/server';
import { authHeaders } from '@/lib/server/backend';
import { getCameraDetectionMode, setCameraDetectionMode } from '@/lib/server/camera-modes';

export const dynamic = 'force-dynamic';

const pipelineHost = () => process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

async function forward(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: body?.detail ?? `Pipeline returned ${res.status}` }, { status: res.status });
  }
  return NextResponse.json(body, { status: res.status });
}

/** GET /api/v1/cameras/{id}/detection-mode — real pipeline state for a camera */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${pipelineHost()}/api/v1/cameras/${encodeURIComponent(id)}/detection-mode`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) return await forward(res);
  } catch {
    // Offline fallback
  }

  const savedMode = getCameraDetectionMode(id) ?? 'both';
  return NextResponse.json({
    camera_id: id,
    detection_mode: savedMode,
    active_mode: savedMode === 'none' ? null : savedMode,
    state: savedMode === 'none' ? 'idle' : 'running',
    error: null,
  });
}

/** PATCH /api/v1/cameras/{id}/detection-mode  {"mode": "intrusion"} */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const mode = body?.mode;
    if (mode) {
      setCameraDetectionMode(id, mode);
    }

    try {
      const res = await fetch(`${pipelineHost()}/api/v1/cameras/${encodeURIComponent(id)}/detection-mode`, {
        method: 'PATCH',
        headers: { ...authHeaders(request), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return await forward(res);
    } catch {
      // Offline fallback
    }

    return NextResponse.json({
      ok: true,
      camera_id: id,
      detection_mode: mode ?? 'both',
      active_mode: mode === 'none' ? null : mode,
      state: mode === 'none' ? 'idle' : 'running',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Invalid request' }, { status: 400 });
  }
}
