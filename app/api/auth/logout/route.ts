import { NextResponse } from 'next/server';
import { SESSION_COOKIE, authHeaders, pipelineHost } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — ends the backend session and clears the cookie. */
export async function POST(request: Request) {
  try {
    await fetch(`${pipelineHost()}/api/v1/auth/logout`, { method: 'POST', headers: authHeaders(request), cache: 'no-store' });
  } catch {
    /* backend unreachable: the cookie is still cleared */
  }
  const out = NextResponse.json({ ok: true });
  out.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return out;
}
