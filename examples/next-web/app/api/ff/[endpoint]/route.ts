// POST /api/ff/<endpoint>: API Freedom Finger (docs/api.md) dengan token dari server ini.
import { fail } from '@/lib/server/http.ts';
import { upstream } from '@/lib/server/ff.ts';
import { guarded } from '@/lib/server/session.ts';

const ENDPOINT = /^[a-z_]+$/;

export const POST = guarded(async (req, { params }: { params: Promise<{ endpoint: string }> }) => {
  const { endpoint } = await params;
  if (!ENDPOINT.test(endpoint)) return fail(404, 'Endpoint tidak ada.');
  return upstream(`/api/${endpoint}`, { method: 'POST', body: await req.text() });
});
