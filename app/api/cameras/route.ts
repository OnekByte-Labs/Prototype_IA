import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pipelineHost = process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

  try {
    const res = await fetch(`${pipelineHost}/cameras`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Pipeline returned ${res.status}`);
    const cameras = await res.json();

    // Shard across distinct loopback addresses (127.0.0.1 - 127.0.0.20)
    // to bypass the browser's 6-connection-per-host limit in HTTP/1.1!
    const rewritten = cameras.map((cam: any, index: number) => {
      let mjpeg = cam.mjpegUrl;
      let meta = cam.metadataUrl;
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
