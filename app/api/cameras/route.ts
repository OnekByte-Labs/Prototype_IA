import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pipelineHost = process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

  try {
    const res = await fetch(`${pipelineHost}/cameras`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Pipeline returned ${res.status}`);
    const cameras = await res.json();

    // Shard across distinct loopback addresses (127.0.0.1 - 127.0.0.20)
    // to bypass the browser's 6-connection-per-host limit in HTTP/1.1!
    const rewritten = cameras.map((cam: Record<string, unknown>, index: number) => {
      let mjpeg = typeof cam.mjpegUrl === 'string' ? cam.mjpegUrl : undefined;
      let meta = typeof cam.metadataUrl === 'string' ? cam.metadataUrl : undefined;
      const hostIp = `127.0.0.${(index % 20) + 1}`;
      
      if (mjpeg) {
        mjpeg = mjpeg.replace(/127\.0\.0\.1|localhost/, hostIp);
      }
      if (meta) {
        meta = meta.replace(/127\.0\.0\.1|localhost/, hostIp);
      }

      return {
        ...cam,
        mjpegUrl: mjpeg,
        metadataUrl: meta,
      };
    });

    return NextResponse.json(rewritten);
  } catch (error) {
    console.error('[cameras] Pipeline unavailable:', error);
    return NextResponse.json([], { status: 503 });
  }
}
