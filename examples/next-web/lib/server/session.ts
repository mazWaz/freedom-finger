// Sesi lewat cookie: HttpOnly (skrip halaman tidak bisa membacanya) dan SameSite=Strict (situs lain
// tidak bisa memakainya). Juga satu-satunya tempat auth.ts dan data.ts dibuat: sekali per proses server.
import 'server-only';
import { cookies } from 'next/headers';
import { createAuth, type Auth } from './auth.ts';
import { config } from './config.ts';
import { createData } from './data.ts';
import { HttpError, fail } from './http.ts';

const COOKIE = 'ff_sesi';

// di globalThis, bukan variabel modul: Next.js bisa memuat modul ini lebih dari sekali (hot reload saat
// dev, lapisan route handler dan server action), sedangkan sesi dan aplikasi.json harus satu
const g = globalThis as { ffAuth?: Promise<Auth>; ffData?: ReturnType<typeof createData> };
export const auth = () => (g.ffAuth ??= createAuth(config().dataDir));
export const appData = () => (g.ffData ??= createData(config().dataDir));

/** User yang login di request ini, atau `null`. */
export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value; // cookie dulu: halaman ini dinamis, tidak dibuat saat build
  return token ? (await auth()).current(token) : null;
}

export const sessionToken = async () => (await cookies()).get(COOKIE)?.value ?? '';

export async function setSession(token: string) {
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/' });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) (await auth()).logout(token);
  jar.delete(COOKIE);
}

/**
 * Route handler yang hanya jalan untuk user yang login (tanpa sesi = 401). HttpError menjadi balasan
 * dengan pesannya; error lain dicatat di log server dan pengguna menerima pesan umum.
 */
export function guarded<C>(handler: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      if (!(await currentUser())) return fail(401, 'Sesi berakhir. Silakan login lagi.');
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      console.error(e);
      return fail(500, 'Kesalahan di server. Lihat log server.');
    }
  };
}
