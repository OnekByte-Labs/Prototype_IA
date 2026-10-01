import { NextResponse } from 'next/server';
import { authHeaders } from '@/lib/server/backend';

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
    return await forward(await fetch(`${pipelineHost()}/api/v1/cameras/${encodeURIComponent(id)}/detection-mode`, { cache: 'no-store' }));
  } catch {
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}

/** PATCH /api/v1/cameras/{id}/detection-mode  {"mode": "intrusion"} */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    return await forward(await fetch(`${pipelineHost()}/api/v1/cameras/${encodeURIComponent(id)}/detection-mode`, {
      method: 'PATCH',
      headers: { ...authHeaders(request), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  } catch {
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}
