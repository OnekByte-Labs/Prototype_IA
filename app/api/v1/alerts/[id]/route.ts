import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const pipelineHost = () => process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

/** GET /api/v1/alerts/{id} — full stored detail of one alert (event row, camera, post/company, zone, evidence) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${pipelineHost()}/api/v1/alerts/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: body?.detail ?? `Pipeline returned ${res.status}` }, { status: res.status });
    }
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}
