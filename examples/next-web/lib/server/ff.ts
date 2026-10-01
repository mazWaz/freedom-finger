// Jembatan ke server Freedom Finger: halaman memanggil /api/ff/<endpoint> seperti di docs/api.md, dan
// server ini menambahkan token. Token tidak pernah sampai ke browser.
import 'server-only';
import { config } from './config.ts';
import { fail } from './http.ts';

/** Balasan Freedom Finger diteruskan apa adanya (termasuk aliran event), tanpa header yang tidak berlaku lagi. */
function pass(r: Response) {
  const headers = { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' };
  return new Response(r.body, { status: r.status, headers });
}

export function upstream(path: string, init: { method?: string; body?: string; signal?: AbortSignal } = {}) {
  const { ffUrl, ffToken } = config();
  const headers = { authorization: `Bearer ${ffToken}`, 'content-type': 'application/json' };
  return fetch(`${ffUrl}${path}`, { ...init, headers }).then(pass, (e: Error) =>
    fail(502, `Server Freedom Finger (${ffUrl}) tidak bisa dihubungi: ${e.message}`),
  );
}
