import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path?: string[] }> };

/** Argus Agent conversation history: GET list / one conversation, DELETE one. */
async function proxy(request: Request, { params }: Ctx) {
  const { path = [] } = await params;
  const res = await forwardJson(request, `/api/agent/conversations${path.map((p) => `/${encodeURIComponent(p)}`).join('')}`);
  return res.status === 204 ? new NextResponse(null, { status: 204 }) : res;
}

export { proxy as GET, proxy as DELETE };
