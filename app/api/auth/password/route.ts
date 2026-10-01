import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** POST /api/auth/password — change the signed-in user's password. */
export async function POST(request: Request) {
  return forwardJson(request, '/api/v1/auth/password');
}
