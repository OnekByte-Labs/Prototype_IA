import { NextResponse } from 'next/server';
import { authHeaders, pipelineHost } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

const PROFILES = new Set(['sub', 'main', 'main_h264']);

function target(id: string, request: Request, suffix = '') {
  const profile = new URL(request.url).searchParams.get('profile') ?? 'sub';
  if (!PROFILES.has(profile)) return null;
  return `${pipelineHost()}/api/v1/cameras/${encodeURIComponent(id)}/webrtc${suffix}?profile=${profile}`;
}

/**
 * POST /api/live/{id}/whep?profile=sub|main|main_h264 — WebRTC (WHEP) offer for a
 * live camera. The backend resolves the camera to its media-server path and
 * relays the SDP; the browser never sees NVR addresses or credentials.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = target(id, request);
  if (!url) return NextResponse.json({ error: 'Unknown profile' }, { status: 422 });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders(request), 'Content-Type': 'application/sdp' },
      body: await request.text(),
      cache: 'no-store',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ error: data?.detail ?? `Pipeline returned ${res.status}` }, { status: res.status });
    }
    return new NextResponse(await res.text(), {
      status: 201,
      headers: {
        'Content-Type': 'application/sdp',
        'X-Session-Id': res.headers.get('x-session-id') ?? '',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}

/** DELETE /api/live/{id}/whep?profile=…&session=… — end the WebRTC session. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = new URL(request.url).searchParams.get('session') ?? '';
  const url = target(id, request, `/${encodeURIComponent(session)}`);
  if (!url || !session) return new NextResponse(null, { status: 400 });
  try {
    const res = await fetch(url, { method: 'DELETE', headers: authHeaders(request), cache: 'no-store' });
    return new NextResponse(null, { status: res.status });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
