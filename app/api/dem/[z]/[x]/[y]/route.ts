export const dynamic = 'force-dynamic';

/** Same-origin proxy for the backend's local (offline) Terrarium elevation tiles. */
export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const pipelineHost = process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';
  if (![z, x, y].every((v) => /^\d+$/.test(v))) return new Response(null, { status: 400 });
  try {
    const res = await fetch(`${pipelineHost}/dem/${z}/${x}/${y}`, { cache: 'no-store' });
    if (!res.ok) return new Response(null, { status: res.status });
    return new Response(res.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
  } catch {
    return new Response(null, { status: 503 });
  }
}
