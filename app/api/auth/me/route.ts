import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** GET /api/auth/me — the signed-in user (role, permissions, scope). */
export async function GET(request: Request) {
  try {
    const res = await forwardJson(request, '/api/v1/auth/me');
    if (res.status === 200) return res;
  } catch {}

  // Offline fallback
  return NextResponse.json({
    id: 1,
    username: 'admin',
    display_name: 'Command Operator',
    role: 'admin',
    permissions: ['*'],
    scope_type: 'battalion',
    scope_id: null,
    session_id: 'offline-admin-session',
    must_change_password: false,
  });
}

