import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** Stored alert search (?active=1 for alerts of active incidents; period, class, camera_id, …). */
export async function GET(request: Request) {
  return forwardJson(request, `/api/v1/alerts${new URL(request.url).search}`);
}
