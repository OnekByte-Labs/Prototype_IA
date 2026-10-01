import { NextResponse } from 'next/server';
import { authHeaders, pipelineHost } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/**
 * Argus Agent turn: relays the backend's NDJSON event stream as it is produced.
 * Aborting the browser request (Stop) aborts the upstream fetch, which closes
 * the backend stream and stops the local model generating.
 */
export async function POST(request: Request) {
  const body = await request.text();
  try {
    const res = await fetch(`${pipelineHost()}/api/agent/chat`, {
      method: 'POST',
      headers: { ...authHeaders(request), 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      signal: request.signal,
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ error: data?.detail ?? `Agent returned ${res.status}` }, { status: res.status });
    }
    return new Response(res.body, {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
    });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}
