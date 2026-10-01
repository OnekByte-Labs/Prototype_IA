import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Proxy for the pipeline's real AI alerts: GET /api/alerts?after=<seq> */
export async function GET(request: Request) {
  const pipelineHost = process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';
  const after = new URL(request.url).searchParams.get('after') ?? '-1';

  try {
    const res = await fetch(`${pipelineHost}/alerts?after=${encodeURIComponent(after)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Pipeline returned ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (error) {
    console.error('[alerts] Pipeline unavailable:', error);
    return NextResponse.json({ seq: -1, alerts: [] }, { status: 503 });
  }
}
