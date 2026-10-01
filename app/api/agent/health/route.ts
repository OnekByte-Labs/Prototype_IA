import { forwardJson } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

/** Argus Agent readiness: local Ollama reachable, model installed / loaded. */
export async function GET(request: Request) {
  return forwardJson(request, '/api/agent/health');
}
