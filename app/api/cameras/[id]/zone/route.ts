import { NextResponse } from 'next/server';

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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (!res.ok) throw new Error(`Pipeline returned ${res.status}`);
    const result = await res.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[cameras] Failed to update zone for ${id}:`, error);
    return NextResponse.json({ error: 'Failed to update zone' }, { status: 503 });
  }
}
