import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

/** Administration API proxy — authorization is enforced by the backend for every route. */
async function proxy(request: Request, { params }: Ctx) {
  const { path } = await params;
  const search = new URL(request.url).search;
  return forwardJson(request, `/api/v1/admin/${path.map(encodeURIComponent).join('/')}${search}`);
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
