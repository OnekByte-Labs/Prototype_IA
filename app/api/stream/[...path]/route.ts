import { NextResponse } from 'next/server';
import { getSentinelCookie } from '@/lib/auth';

export const revalidate = 0; // Don't cache the stream proxy

export async function GET(
  request: Request,
  { params }: { params: { path: string[] } }
) {
  try {
    const cookie = await getSentinelCookie();
    
    // Construct the remote URL
    const hlsBase = process.env.CAMERA_HLS_BASE_URL || 'https://cctv.corp8.cloud';
    const remotePath = params.path.join('/');
    const targetUrl = `${hlsBase}/live/stream/${remotePath}`;

    const headers: HeadersInit = {
      'Cookie': cookie,
    };
    
    // Forward the request to the CDN
    const response = await fetch(targetUrl, {
      headers,
      redirect: 'manual'
    });

    if (!response.ok) {
      if (response.status === 302) {
        return new NextResponse("Unauthorized", { status: 401 });
      }
      return new NextResponse(response.statusText, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'application/vnd.apple.mpegurl';
    
    // Stream the body directly to avoid buffering large .ts video segments in memory
    const body = response.body;

    const proxyHeaders = new Headers();
    proxyHeaders.set('Content-Type', contentType);
    proxyHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    proxyHeaders.set('Access-Control-Allow-Origin', '*');

    return new NextResponse(body, {
      status: 200,
      headers: proxyHeaders,
    });
  } catch (error) {
    console.error('Error in stream proxy:', error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
