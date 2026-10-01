import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

/** Device health: /api/v1/health/cameras[/{id}], /api/v1/health/nvrs[/{id}]. */
export async function GET(request: Request, { params }: Ctx) {
  const { path } = await params;
  const search = new URL(request.url).search;
  return forwardJson(request, `/api/v1/health${path.map((p) => `/${encodeURIComponent(p)}`).join('')}${search}`);
}
