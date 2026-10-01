// User, kata sandi, dan sesi. Semua user setara. Kata sandi disimpan sebagai hash scrypt (node:crypto)
// di users.json, yang tidak pernah dikirim ke browser. Modul ini tidak tahu soal cookie atau Next.js
// (lihat session.ts), jadi bisa diuji langsung: auth.test.ts.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { HttpError } from './http.ts';
import { readJson, writer } from './store.ts';

type User = { name: string; hash: string; created: string };

const IDLE_MS = 12 * 3600_000; // sesi berakhir setelah 12 jam tidak dipakai
const MIN_PASSWORD = 8;
const MAX_FAILS = 5; // salah berturut-turut, lalu user itu dikunci sebentar
const LOCK_MS = 5 * 60_000;
const NAME = /^[a-z0-9._-]{3,32}$/;
// salah satu setelan scrypt yang disarankan OWASP (N=2^15, r=8, p=3: ±32 MB per hash); disimpan di
// dalam hash, jadi setelan baru tidak membuat hash lama tidak terbaca
const COST = { N: 2 ** 15, r: 8, p: 3 };

const derive = (password: string, salt: Buffer, o: typeof COST) =>
  new Promise<Buffer>((ok, fail) => scrypt(password, salt, 32, { ...o, maxmem: 128 * o.N * o.r * 2 }, (e, key) => (e ? fail(e) : ok(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [kind, N, r, p, salt, key] = hash.split('$');
  if (kind !== 'scrypt' || !key) return false;
  const want = Buffer.from(key, 'base64url');
  const got = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

export function checkName(name: string) {
  if (!NAME.test(name)) throw new HttpError(400, 'Nama user 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip.');
}

/** Kata sandi baru: cukup panjang dan sama dengan ulangannya. */
export function checkPassword(password: string, repeat = password) {
  // batas atas: hash untuk teks raksasa hanya membuang waktu server
  if (password.length < MIN_PASSWORD || password.length > 200) throw new HttpError(400, `Kata sandi minimal ${MIN_PASSWORD} karakter.`);
  if (password !== repeat) throw new HttpError(400, 'Kedua kata sandi tidak sama.');
}

export async function createAuth(dataDir: string) {
  const users: User[] = await readJson(join(dataDir, 'users.json'), []);
  const save = writer(join(dataDir, 'users.json'));
  // ponytail: sesi di memori, restart server = semua user login lagi; simpan ke file bila itu mengganggu
  const sessions = new Map<string, { user: string; expires: number }>();
  const fails = new Map<string, { count: number; until: number }>();
  // user tidak ada tetap diverifikasi ke hash ini, supaya lama jawabannya tidak membocorkan nama user
  const dummy = await hashPassword('bukan-kata-sandi-siapa-pun');

  /** Token sesi baru untuk `user` (isi cookie). */
  function startSession(user: string) {
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { user, expires: Date.now() + IDLE_MS });
    return token;
  }

  /** User pemilik token ini, atau `null`. Setiap dipakai, sesinya diperpanjang. */
  function current(token: string | undefined): string | null {
    const s = token ? sessions.get(token) : undefined;
    if (!token || !s) return null;
    if (s.expires < Date.now()) {
      sessions.delete(token);
      return null;
    }
    s.expires = Date.now() + IDLE_MS;
    return s.user;
  }

  /** Akhiri semua sesi `user` kecuali `keep` (setelah ganti kata sandi atau user dihapus). */
  function endSessions(user: string, keep?: string) {
    for (const [token, s] of sessions) if (s.user === user && token !== keep) sessions.delete(token);
  }

  async function addUser(name: string, password: string, repeat = password) {
    checkName(name);
    checkPassword(password, repeat);
    if (users.some((u) => u.name === name)) throw new HttpError(409, `User ${name} sudah ada.`);
    users.push({ name, hash: await hashPassword(password), created: new Date().toISOString() });
    await save(() => users);
  }

  return {
    current,
    hasUsers: () => users.length > 0,
    list: () => users.map((u) => ({ name: u.name, created: u.created })),
    logout: (token: string) => void sessions.delete(token),

    /** User pertama, dibuat dari halaman login selama belum ada user sama sekali. Hasil: token sesi. */
    async setup(name: string, password: string, repeat: string) {
      if (users.length) throw new HttpError(403, 'User pertama sudah dibuat. Login dengan user yang ada.');
      await addUser(name, password, repeat);
      return startSession(name);
    },

    /** Hasil: token sesi. Lima kali salah berturut-turut mengunci user itu 5 menit. */
    async login(name: string, password: string) {
      const f = fails.get(name);
      if (f && f.count >= MAX_FAILS && f.until > Date.now()) {
        throw new HttpError(429, `Terlalu banyak percobaan salah. Coba lagi ${Math.ceil((f.until - Date.now()) / 60_000)} menit lagi.`);
      }
      const user = users.find((u) => u.name === name);
      if (!(await verifyPassword(password, user?.hash ?? dummy)) || !user) {
        if (fails.size > 1000) fails.clear(); // ponytail: nama acak tanpa batas tidak memenuhi memori
        const count = (f && f.until > Date.now() ? f.count : 0) + 1;
        fails.set(name, { count, until: Date.now() + LOCK_MS });
        throw new HttpError(401, 'User atau kata sandi salah.');
      }
      fails.delete(name);
      return startSession(user.name);
    },

    addUser,

    /** Ganti kata sandi sendiri; perangkat lain yang memakai user ini harus login lagi. */
    async changePassword(user: string, old: string, password: string, repeat: string, keep: string) {
      const me = users.find((u) => u.name === user);
      if (!me || !(await verifyPassword(old, me.hash))) throw new HttpError(400, 'Kata sandi sekarang salah.');
      checkPassword(password, repeat);
      me.hash = await hashPassword(password);
      await save(() => users);
      endSessions(user, keep);
    },

    /** Hapus user lain; sesinya yang sedang terbuka langsung berakhir. */
    async removeUser(name: string, by: string) {
      if (name === by) throw new HttpError(400, 'Tidak bisa menghapus user yang sedang dipakai.');
      const i = users.findIndex((u) => u.name === name);
      if (i < 0) throw new HttpError(404, `User ${name} tidak ada.`);
      users.splice(i, 1);
      await save(() => users);
      endSessions(name);
    },
  };
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;
