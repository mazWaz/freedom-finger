// Rakit server: halaman (web/index.html, dibundel Bun), login, dan route yang butuh login.
// Setiap route di `routes` milik satu modul: auth.ts (user), data.ts (aplikasi.json), proxy.ts (API
// Freedom Finger), xlsx.ts (export). Semuanya dijaga `guard`: tanpa sesi = 401.
import type { BunRequest, Server } from 'bun';
import page from '../web/index.html';
import { createAuth } from './auth.ts';
import type { Config } from './config.ts';
import { createData } from './data.ts';
import { HttpError, fail, type Handler, type Routes } from './http.ts';
import { createProxy } from './proxy.ts';
import { routes as xlsxRoutes } from './xlsx.ts';

/** Bungkus handler supaya hanya jalan untuk user yang login. */
function guard(current: (req: BunRequest) => string | null, routes: Routes) {
  const wrap = (h: Handler) => (req: BunRequest, server: Server<undefined>) => {
    const user = current(req);
    return user ? h(req, user, server) : fail(401, 'Sesi berakhir. Silakan login lagi.');
  };
  return Object.fromEntries(
    Object.entries(routes).map(([path, r]) => [
      path,
      typeof r === 'function' ? wrap(r) : Object.fromEntries(Object.entries(r).map(([method, h]) => [method, wrap(h)])),
    ]),
  );
}

export async function start(cfg: Config, development = process.env.NODE_ENV !== 'production') {
  const auth = await createAuth(cfg.dataDir);
  const data = await createData(cfg.dataDir);
  const proxy = createProxy(cfg);
  return Bun.serve({
    port: cfg.port,
    development,
    idleTimeout: 60, // scan_devices dan export besar bisa lebih lama dari bawaan 10 detik
    routes: {
      '/': page,
      ...auth.publicRoutes,
      ...guard(auth.current, { ...auth.routes, ...data.routes, ...proxy.routes, ...xlsxRoutes }),
    },
    fetch: () => fail(404, 'Tidak ada.'),
    error(e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      console.error(e);
      return fail(500, 'Kesalahan di server. Lihat log server.');
    },
  });
}
