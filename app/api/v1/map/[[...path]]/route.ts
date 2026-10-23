import { NextResponse } from 'next/server';
import { authHeaders } from '@/lib/server/backend';
import fallbackConfig from '@/lib/gis/fallback_map_config.json';
import fallbackHealth from '@/lib/gis/fallback_map_health.json';
import fallbackRelationships from '@/lib/gis/fallback_map_relationships.json';
import fallbackCoverage from '@/lib/gis/fallback_map_coverage.json';

export const dynamic = 'force-dynamic';

const pipelineHost = () => process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

type Ctx = { params: Promise<{ path?: string[] }> };

/**
 * Proxy for the tactical GIS API (/api/v1/map, /api/v1/map/coverage, …).
 * The edit-session token travels in X-Map-Edit-Token and is checked by the backend.
 */
async function proxy(request: Request, { params }: Ctx) {
  const { path = [] } = await params;
  const search = new URL(request.url).search;
  const target = `${pipelineHost()}/api/v1/map${path.map((p) => `/${encodeURIComponent(p)}`).join('')}${search}`;
  const headers: Record<string, string> = authHeaders(request);
  const token = request.headers.get('x-map-edit-token');
  if (token) headers['X-Map-Edit-Token'] = token;
  const hasBody = request.method !== 'GET' && request.method !== 'DELETE';
  if (hasBody) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: 'no-store',
    });
    if (res.status === 204) return new NextResponse(null, { status: 204 });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (request.method === 'GET') {
        const subpath = path.join('/');
        if (subpath === '' || subpath === 'config') return NextResponse.json(fallbackConfig);
        if (subpath === 'health') return NextResponse.json(fallbackHealth);
        if (subpath === 'relationships') return NextResponse.json(fallbackRelationships);
        if (subpath === 'coverage') return NextResponse.json(fallbackCoverage);
        if (subpath === 'cameras-at') return NextResponse.json({ cameras: [] });
      }
      return NextResponse.json({ error: body?.detail ?? `Pipeline returned ${res.status}` }, { status: res.status });
    }
    return NextResponse.json(body, { status: res.status });
  } catch {
    // Graceful offline fallback: if backend AI pipeline is not running, serve the complete database snapshot!
    if (request.method === 'GET') {
      const subpath = path.join('/');
      if (subpath === '' || subpath === 'config') return NextResponse.json(fallbackConfig);
      if (subpath === 'health') return NextResponse.json(fallbackHealth);
      if (subpath === 'relationships') return NextResponse.json(fallbackRelationships);
      if (subpath === 'coverage') return NextResponse.json(fallbackCoverage);
      if (subpath === 'cameras-at') return NextResponse.json({ cameras: [] });
    }
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}

export { proxy as GET, proxy as PUT, proxy as POST, proxy as DELETE };

