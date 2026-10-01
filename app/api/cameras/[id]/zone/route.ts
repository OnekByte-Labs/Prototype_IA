import { NextResponse } from 'next/server';
import { authHeaders } from '@/lib/server/backend';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pipelineHost = process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

  try {
    const data = await request.json();
    const res = await fetch(`${pipelineHost}/cameras/${id}/zone`, {
      method: 'POST',
      headers: {
        ...authHeaders(request),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Pass the pipeline's validation message (e.g. intrusion not allowed on
      // this camera) through to the UI instead of a generic failure.
      return NextResponse.json(
        { error: result?.detail ?? `Pipeline returned ${res.status}` },
        { status: res.status },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[cameras] Failed to update zone for ${id}:`, error);
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}
