import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** GET /api/v1/pipelines/health — per-camera pipeline health + loaded models */
export async function GET() {
  const pipelineHost = process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';
  try {
    const res = await fetch(`${pipelineHost}/api/v1/pipelines/health`, { cache: 'no-store' });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}
