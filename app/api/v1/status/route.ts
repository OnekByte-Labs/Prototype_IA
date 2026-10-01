import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** Current system status: cameras, NVRs, AI pipelines, alert counts, active incidents. */
export async function GET(request: Request) {
  return forwardJson(request, '/api/v1/status');
}
