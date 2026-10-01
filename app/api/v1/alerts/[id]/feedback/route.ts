import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Operator feedback on an alert (confirmed / false alarm) → model improvement queue. */
export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  return forwardJson(request, `/api/v1/alerts/${encodeURIComponent(id)}/feedback`);
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return forwardJson(request, `/api/v1/alerts/${encodeURIComponent(id)}/feedback`);
}
