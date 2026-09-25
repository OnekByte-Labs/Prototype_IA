import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pipelineHost = process.env.PIPELINE_HOST || 'http://localhost:5555';

  try {
    const res = await fetch(`${pipelineHost}/cameras`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Pipeline returned ${res.status}`);
    const cameras = await res.json();

    // Rewrite mjpegUrl to be absolute so the browser can reach the pipeline server.
    // We alternate between localhost and 127.0.0.1 to bypass the browser's 6-connection-per-domain limit!
    const rewritten = cameras.map((cam: Record<string, unknown>, index: number) => {
      const host = index % 2 === 0 ? pipelineHost : pipelineHost.replace('localhost', '127.0.0.1');
      return {
        ...cam,
        mjpegUrl: cam.mjpegUrl ? `${host}${cam.mjpegUrl}` : undefined,
      };
    });

    return NextResponse.json(rewritten);
  } catch (error) {
    console.error('[cameras] Pipeline unavailable:', error);
    return NextResponse.json([], { status: 503 });
  }
}
