import { NextResponse } from 'next/server';
import { getSentinelCookie } from '@/lib/auth';

export const revalidate = 10; // Cache for 10 seconds

interface IngestCamera {
  id: string;
  name: string;
}

export async function GET() {
  try {
    const catalogueUrl = process.env.CAMERA_CATALOGUE_URL || 'https://cctv.corp8.cloud/cameras.json';
    const email = (process.env.CAMERA_USER_EMAIL || '').trim();
    const password = (process.env.CAMERA_USER_PASSWORD || '').trim();
    const token = (process.env.CAMERA_ACCESS_TOKEN || '').trim();
    const actualPassword = token || password;

    const cookie = await getSentinelCookie();

    let headers: HeadersInit = {
      'Cookie': cookie,
    };
    
    // Fetch from the government portal
    let response = await fetch(catalogueUrl, { headers, next: { revalidate: 10 } });
    let text = await response.text();

    if (!response.ok || text.trim().toLowerCase().startsWith('<!doctype')) {
      throw new Error(`Failed to fetch catalogue: Invalid response or unauthorized.`);
    }

    const data: IngestCamera[] = JSON.parse(text);

    // Normalize to our frontend format
    const normalizedCameras = data.map((cam) => {
      // Build a label from id and name
      const label = cam.name ? `${cam.id} · ${cam.name.toUpperCase()}` : cam.id;
      
      // Since liveStatus is not in the JSON, assume true if it was returned in the catalogue
      const isOnline = true;

      // URL encode the email for HTTP/RTSP basic auth inside the URL
      const encodedEmail = encodeURIComponent(email);
      const authPrefix = (encodedEmail && actualPassword) ? `${encodedEmail}:${actualPassword}@` : '';

      // Point HLS to our Next.js proxy route so it attaches the cookie
      const hlsUrl = `/api/stream/${cam.id}/index.m3u8`;

      const webrtcBase = process.env.CAMERA_WEBRTC_BASE_URL || 'http://103.250.160.189:8889/stream';
      // WHEP requires auth in the URL per the docs
      const webrtcUrl = webrtcBase.replace('http://', `http://${authPrefix}`) + `/${cam.id}/whep`;

      const rtspBase = process.env.CAMERA_RTSP_BASE_URL || 'rtsp://103.250.160.189:8554/stream';
      const rtspUrl = rtspBase.replace('rtsp://', `rtsp://${authPrefix}`) + `/${cam.id}`;

      return {
        id: cam.id.toUpperCase().replace('CAM', 'CAM-'), // Match frontend mock IDs if possible, or leave as is
        name: cam.name,
        label,
        online: isOnline,
        hlsUrl,
        webrtcUrl,
        rtspUrl,
      };
    });

    return NextResponse.json(normalizedCameras);

  } catch (error) {
    console.error('Error in /api/cameras route:', error);
    
    // Fallback to mock data for demonstration if the host is unavailable
    const fallbackCameras = [
      { id: "CAM-01", label: "CAM-01 · MAIN GATE", online: true, hlsUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
      { id: "CAM-02", label: "CAM-02 · PERIMETER N", online: true, hlsUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
      { id: "CAM-15", label: "CAM-15 · PERIMETER W", online: false },
    ];
    
    return NextResponse.json(fallbackCameras, { status: 200 });
  }
}
