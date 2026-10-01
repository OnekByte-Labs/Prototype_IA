import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** Detection events of the last N minutes, summarised (?minutes=&camera_id=&event_type=&limit=). */
export async function GET(request: Request) {
  return forwardJson(request, `/api/v1/events/recent${new URL(request.url).search}`);
}
