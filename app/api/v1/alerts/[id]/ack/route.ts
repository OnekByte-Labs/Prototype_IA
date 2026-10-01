import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Acknowledge an alert (persisted with the operator's name). */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return forwardJson(request, `/api/v1/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST', body: '{}' });
}
