import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pipelineHost = process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

  try {
    const res = await fetch(`${pipelineHost}/cameras`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Pipeline returned ${res.status}`);
    const cameras = await res.json();

    // We alternate between localhost and 127.0.0.1 to bypass the browser's 6-connection-per-domain limit!
    const rewritten = cameras.map((cam: any, index: number) => {
      let mjpeg = cam.mjpegUrl;
      let meta = cam.metadataUrl;
      
      if (index % 2 !== 0) {
        if (mjpeg) mjpeg = mjpeg.replace('localhost', '127.0.0.1');
        if (meta) meta = meta.replace('localhost', '127.0.0.1');
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
