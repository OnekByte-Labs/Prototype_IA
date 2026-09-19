import { NextResponse } from 'next/server';
import { getSentinelCookie, refreshSentinelCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    let cookie = await getSentinelCookie();
    const hlsBase = process.env.CAMERA_HLS_BASE_URL || 'https://cctv.corp8.cloud';

    // The correct CDN path is /<cam_id>/<file> — NOT /live/stream/<cam_id>/<file>
    const remotePath = (await params).path.join('/');
    const targetUrl = `${hlsBase}/${remotePath}`;

    let response = await fetch(targetUrl, {
      headers: {
        'Cookie': cookie,
        'User-Agent': BROWSER_UA,
        'Referer': `${hlsBase}/`,
        'Accept': '*/*',
      },
      redirect: 'manual',
    });

    // Handle "one session per IP" or expired cookie — re-login and retry once
    if (response.status === 403 || response.status === 302) {
      console.log(`[stream-proxy] Got ${response.status} for ${remotePath}, refreshing cookie...`);
      cookie = await refreshSentinelCookie();
      response = await fetch(targetUrl, {
        headers: {
          'Cookie': cookie,
          'User-Agent': BROWSER_UA,
          'Referer': `${hlsBase}/`,
          'Accept': '*/*',
        },
        redirect: 'manual',
      });
    }

    if (!response.ok) {
      console.error(`[stream-proxy] Failed: ${response.status} ${response.statusText} for ${targetUrl}`);
      return new NextResponse(response.statusText, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'application/vnd.apple.mpegurl';
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
    console.error('[stream-proxy] Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
