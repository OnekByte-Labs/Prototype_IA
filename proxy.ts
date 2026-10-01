import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Pages require a signed-in session. This only checks that the session cookie
 * exists — the backend validates it (expiry, idle timeout, revocation, RBAC)
 * on every API call, and the shell sends the user back here on a 401.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.get('iscc_session')?.value) return NextResponse.next();
  const url = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== '/') url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, API routes, Next internals and static assets
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico|feeds|alerts/|.*\\.(?:png|jpg|jpeg|svg|webp|mp4|ico)$).*)'],
};
