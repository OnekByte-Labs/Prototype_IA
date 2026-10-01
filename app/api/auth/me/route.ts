import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** GET /api/auth/me — the signed-in user (role, permissions, scope). */
export async function GET(request: Request) {
  return forwardJson(request, '/api/v1/auth/me');
}
