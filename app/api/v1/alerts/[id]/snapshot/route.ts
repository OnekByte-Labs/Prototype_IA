import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const pipelineHost = () => process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

/** GET /api/v1/alerts/{id}/snapshot — the annotated frame the alert fired on (JPEG, immutable) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${pipelineHost()}/api/v1/alerts/${encodeURIComponent(id)}/snapshot`, { cache: 'no-store' });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `Evidence unavailable (${res.status})` }, { status: res.status === 200 ? 502 : res.status });
    }
    return new Response(res.body, {
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': res.headers.get('cache-control') ?? 'private, max-age=86400, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}
