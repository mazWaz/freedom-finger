// Jembatan ke server Freedom Finger: halaman memanggil /api/<endpoint> seperti di docs/api.md, dan
// server ini menambahkan token. Token tidak pernah sampai ke browser; tanpa login tidak ada yang lewat.
import type { Config } from './config.ts';
import { fail, type Routes } from './http.ts';

const ENDPOINT = /^[a-z_]+$/;

/** Balasan Freedom Finger diteruskan apa adanya (termasuk aliran event), tanpa header yang tidak berlaku lagi. */
function pass(r: Response) {
  const headers = { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' };
  return new Response(r.body, { status: r.status, headers });
}

export function createProxy({ ffUrl, ffToken }: Config) {
  const headers = { authorization: `Bearer ${ffToken}`, 'content-type': 'application/json' };
  const upstream = (path: string, init?: RequestInit) =>
    fetch(`${ffUrl}${path}`, init).then(pass, (e) => fail(502, `Server Freedom Finger (${ffUrl}) tidak bisa dihubungi: ${e.message}`));

  const routes: Routes = {
    // event realtime (SSE): koneksi panjang, jadi batas diam server dimatikan untuk request ini
    '/api/events': {
      GET: (req, _user, server) => {
        server.timeout(req, 0);
        return upstream('/api/events', { headers, signal: req.signal });
      },
    },
    '/api/:endpoint': {
      POST: async (req) => {
        if (!ENDPOINT.test(req.params.endpoint)) return fail(404, 'Endpoint tidak ada.');
        return upstream(`/api/${req.params.endpoint}`, { method: 'POST', headers, body: await req.text() });
      },
    },
    // IP dan port server Freedom Finger: isian menu jaringan di mesin
    '/app/status': { GET: () => upstream('/status.json') },
  };
  return { routes };
}
