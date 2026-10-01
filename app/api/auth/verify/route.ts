import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** POST /api/auth/verify — re-authenticate the signed-in user (terminal unlock). */
export async function POST(request: Request) {
  return forwardJson(request, '/api/v1/auth/verify');
}
