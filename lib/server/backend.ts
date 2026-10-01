import { NextResponse } from 'next/server';

/** Server-side helpers for proxying to the AI pipeline backend with the operator's session. */

export const SESSION_COOKIE = 'iscc_session';
export const pipelineHost = () => process.env.PIPELINE_HOST || 'http://127.0.0.1:5556';

function cookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** Headers that carry the signed-in user's session (and client address) to the backend. */
export function authHeaders(request: Request): Record<string, string> {
  const h: Record<string, string> = {};
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) h['X-Session-Token'] = token;
  const fwd = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
  if (fwd) h['X-Forwarded-For'] = fwd;
  const ua = request.headers.get('user-agent');
  if (ua) h['User-Agent'] = ua;
  return h;
}

/** Forward a request to the backend and relay its JSON (errors become {error}). */
export async function forwardJson(request: Request, path: string, init: { method?: string; body?: string } = {}) {
  const method = init.method ?? request.method;
  const hasBody = method !== 'GET' && method !== 'DELETE' && method !== 'HEAD';
  const body = init.body ?? (hasBody ? await request.text() : undefined);
  try {
    const res = await fetch(`${pipelineHost()}${path}`, {
      method,
      headers: { ...authHeaders(request), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body || undefined,
      cache: 'no-store',
    });
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('json')) {
      return new NextResponse(res.body, {
        status: res.status,
        headers: {
          'Content-Type': ctype || 'application/octet-stream',
          ...(res.headers.get('content-disposition') ? { 'Content-Disposition': res.headers.get('content-disposition')! } : {}),
        },
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data?.detail ?? data?.error ?? `Pipeline returned ${res.status}` }, { status: res.status });
    }
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'AI pipeline unreachable' }, { status: 503 });
  }
}
