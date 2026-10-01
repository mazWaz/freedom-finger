// Login dengan user dan kata sandi. Semua user setara. Kata sandi disimpan sebagai hash argon2id
// (Bun.password) di users.json, yang tidak pernah dikirim ke browser. Sesi memakai cookie HttpOnly
// dan SameSite=Strict, jadi skrip halaman dan situs lain tidak bisa memakainya.
import type { BunRequest } from 'bun';
import { join } from 'node:path';
import { HttpError, fail, readBody, text, type Routes } from './http.ts';
import { readJson, writer } from './store.ts';

type User = { name: string; hash: string; created: string };

const COOKIE = 'ff_sesi';
const IDLE_MS = 12 * 3600_000; // sesi berakhir setelah 12 jam tidak dipakai
const MIN_PASSWORD = 8;
const MAX_FAILS = 5; // salah berturut-turut, lalu user itu dikunci sebentar
const LOCK_MS = 5 * 60_000;
const NAME = /^[a-z0-9._-]{3,32}$/;

function checkName(name: string) {
  if (!NAME.test(name)) throw new HttpError(400, 'Nama user 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip.');
}

function checkPassword(password: string) {
  // batas atas: hash argon2 untuk teks raksasa hanya membuang waktu server
  if (password.length < MIN_PASSWORD || password.length > 200) throw new HttpError(400, `Kata sandi minimal ${MIN_PASSWORD} karakter.`);
}

export async function createAuth(dataDir: string) {
  const users: User[] = await readJson(join(dataDir, 'users.json'), []);
  const save = writer(join(dataDir, 'users.json'));
  // ponytail: sesi di memori, restart server = semua user login lagi; simpan ke file bila itu mengganggu
  const sessions = new Map<string, { user: string; expires: number }>();
  const fails = new Map<string, { count: number; until: number }>();
  // user tidak ada tetap diverifikasi ke hash ini, supaya lama jawabannya tidak membocorkan nama user
  const dummy = await Bun.password.hash('bukan-kata-sandi-siapa-pun');

  function startSession(req: BunRequest, user: string) {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    sessions.set(token, { user, expires: Date.now() + IDLE_MS });
    req.cookies.set(COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/' });
    return Response.json({ success: true, user });
  }

  /** User yang login di request ini, atau `null`. Setiap dipakai, sesinya diperpanjang. */
  function current(req: BunRequest): string | null {
    const token = req.cookies.get(COOKIE);
    const s = token ? sessions.get(token) : undefined;
    if (!token || !s) return null;
    if (s.expires < Date.now()) {
      sessions.delete(token);
      return null;
    }
    s.expires = Date.now() + IDLE_MS;
    return s.user;
  }

  /** Akhiri semua sesi `user` kecuali sesi request ini (setelah ganti kata sandi atau user dihapus). */
  function endSessions(user: string, keep?: string | null) {
    for (const [token, s] of sessions) if (s.user === user && token !== keep) sessions.delete(token);
  }

  async function addUser(name: string, password: string) {
    checkName(name);
    checkPassword(password);
    if (users.some((u) => u.name === name)) throw new HttpError(409, `User ${name} sudah ada.`);
    users.push({ name, hash: await Bun.password.hash(password), created: new Date().toISOString() });
    await save(() => users);
  }

  async function login(req: BunRequest) {
    const body = await readBody(req);
    const name = text(body, 'name').trim().toLowerCase();
    const password = text(body, 'password');
    const f = fails.get(name);
    if (f && f.count >= MAX_FAILS && f.until > Date.now()) {
      return fail(429, `Terlalu banyak percobaan salah. Coba lagi ${Math.ceil((f.until - Date.now()) / 60_000)} menit lagi.`);
    }
    const user = users.find((u) => u.name === name);
    if (!(await Bun.password.verify(password, user?.hash ?? dummy)) || !user) {
      if (fails.size > 1000) fails.clear(); // ponytail: nama acak tanpa batas tidak memenuhi memori
      const count = (f && f.until > Date.now() ? f.count : 0) + 1;
      fails.set(name, { count, until: Date.now() + LOCK_MS });
      return fail(401, 'User atau kata sandi salah.');
    }
    fails.delete(name);
    return startSession(req, user.name);
  }

  /** Route tanpa login: status sesi, user pertama, login, logout. */
  const publicRoutes = {
    '/app/me': (req: BunRequest) => {
      const user = current(req);
      if (user) return Response.json({ success: true, user });
      return Response.json({ success: false, message: 'Belum login.', setup: users.length === 0 }, { status: 401 });
    },
    '/app/setup': {
      // user pertama dibuat dari halaman login; sesudah ada satu user, tambah user hanya lewat Pengaturan
      POST: async (req: BunRequest) => {
        if (users.length) return fail(403, 'User pertama sudah dibuat. Login dengan user yang ada.');
        const body = await readBody(req);
        const name = text(body, 'name').trim().toLowerCase();
        await addUser(name, text(body, 'password'));
        return startSession(req, name);
      },
    },
    '/app/login': { POST: login },
    '/app/logout': {
      POST: (req: BunRequest) => {
        const token = req.cookies.get(COOKIE);
        if (token) sessions.delete(token);
        req.cookies.delete(COOKIE);
        return Response.json({ success: true });
      },
    },
  };

  /** Route yang butuh login: ganti kata sandi sendiri dan kelola user. */
  const routes: Routes = {
    '/app/password': {
      POST: async (req, user) => {
        const body = await readBody(req);
        const me = users.find((u) => u.name === user);
        if (!me || !(await Bun.password.verify(text(body, 'old'), me.hash))) return fail(400, 'Kata sandi sekarang salah.');
        const password = text(body, 'password');
        checkPassword(password);
        me.hash = await Bun.password.hash(password);
        await save(() => users);
        endSessions(user, req.cookies.get(COOKIE)); // perangkat lain yang memakai kata sandi lama harus login lagi
        return Response.json({ success: true });
      },
    },
    '/app/users': {
      GET: () => Response.json({ success: true, data: users.map((u) => ({ name: u.name, created: u.created })) }),
      POST: async (req) => {
        const body = await readBody(req);
        await addUser(text(body, 'name').trim().toLowerCase(), text(body, 'password'));
        return Response.json({ success: true });
      },
    },
    '/app/users/:name': {
      DELETE: async (req, user) => {
        const name = req.params.name;
        if (name === user) return fail(400, 'Tidak bisa menghapus user yang sedang dipakai.');
        const i = users.findIndex((u) => u.name === name);
        if (i < 0) return fail(404, `User ${name} tidak ada.`);
        users.splice(i, 1);
        await save(() => users);
        endSessions(name);
        return Response.json({ success: true });
      },
    },
  };

  return { current, publicRoutes, routes };
}
