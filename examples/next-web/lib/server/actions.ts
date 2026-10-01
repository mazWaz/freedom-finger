'use server';
// Server action untuk login dan kelola user: dipanggil langsung dari komponen (form login, menu
// Pengaturan). Setiap action selain login dan user pertama memeriksa sesi sendiri, karena server action
// adalah endpoint yang bisa dipanggil siapa pun di jaringan.
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { HttpError } from './http.ts';
import { auth, currentUser, endSession, sessionToken, setSession } from './session.ts';

export type Result = { success: boolean; message?: string; /** isian user, supaya tidak perlu diketik ulang */ name?: string };

/** Jalankan `fn`; HttpError menjadi pesan untuk pengguna, error lain dicatat di log server. */
async function attempt(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    return { success: true };
  } catch (e) {
    if (e instanceof HttpError) return { success: false, message: e.message };
    console.error(e);
    return { success: false, message: 'Kesalahan di server. Lihat log server.' };
  }
}

async function me() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

const field = (form: FormData, key: string) => String(form.get(key) ?? '');
const userName = (form: FormData) => field(form, 'name').trim().toLowerCase();

/** Form login, juga untuk membuat user pertama selama belum ada user (`ulang` = ulangi kata sandi). */
export async function signIn(_prev: Result | null, form: FormData): Promise<Result> {
  const a = await auth();
  const r = await attempt(async () => {
    const token = a.hasUsers()
      ? await a.login(userName(form), field(form, 'password'))
      : await a.setup(userName(form), field(form, 'password'), field(form, 'ulang'));
    await setSession(token);
  });
  if (r.success) redirect('/hari-ini');
  return { ...r, name: userName(form) };
}

export async function signOut() {
  await endSession();
  redirect('/login');
}

export async function addUser(name: string, password: string, repeat: string): Promise<Result> {
  await me();
  const r = await attempt(async () => (await auth()).addUser(name.trim().toLowerCase(), password, repeat));
  refresh(); // daftar user di Pengaturan digambar ulang dari server
  return r;
}

export async function removeUser(name: string): Promise<Result> {
  const user = await me();
  const r = await attempt(async () => (await auth()).removeUser(name, user));
  refresh(); // daftar user di Pengaturan digambar ulang dari server
  return r;
}

/** Kata sandi sendiri; perangkat lain yang login dengan user ini harus masuk lagi. */
export async function changePassword(old: string, password: string, repeat: string): Promise<Result> {
  const user = await me();
  return attempt(async () => (await auth()).changePassword(user, old, password, repeat, await sessionToken()));
}
