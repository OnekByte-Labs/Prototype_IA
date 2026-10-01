import { NextResponse } from 'next/server';
import { SESSION_COOKIE, authHeaders, pipelineHost } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** POST /api/auth/login — signs in against the backend and keeps the session in an httpOnly cookie. */
export async function POST(request: Request) {
  const body = await request.text();
  try {
    const res = await fetch(`${pipelineHost()}/api/v1/auth/login`, {
      method: 'POST',
      headers: { ...authHeaders(request), 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: data?.detail ?? 'Sign-in failed' }, { status: res.status });
    const out = NextResponse.json({ principal: data.principal, expires_at: data.expires_at });
    out.cookies.set(SESSION_COOKIE, data.token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: new URL(request.url).protocol === 'https:',
      expires: new Date(data.expires_at * 1000),
    });
    return out;
  } catch {
    return NextResponse.json({ error: 'Authentication service unreachable' }, { status: 503 });
  }
}
