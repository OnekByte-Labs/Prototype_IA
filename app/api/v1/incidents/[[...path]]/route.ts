import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path?: string[] }> };

/** Incidents (alerts of one camera grouped while they keep coming): list or one by INCD id. */
export async function GET(request: Request, { params }: Ctx) {
  const { path = [] } = await params;
  const search = new URL(request.url).search;
  return forwardJson(request, `/api/v1/incidents${path.map((p) => `/${encodeURIComponent(p)}`).join('')}${search}`);
}
