// /api/data: aplikasi.json (lib/server/data.ts). PUT membawa `rev` terakhir; bentrok = 409.
import { readBody } from '@/lib/server/http.ts';
import { appData, guarded } from '@/lib/server/session.ts';

export const GET = guarded(async () => Response.json({ success: true, ...(await appData()).get() }));

export const PUT = guarded(async (req) => {
  const body = await readBody(req);
  return Response.json({ success: true, rev: await (await appData()).put(body.rev, body.data) });
});
