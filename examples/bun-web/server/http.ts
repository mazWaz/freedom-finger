// Bentuk balasan dan error yang sama untuk semua route: `{success: false, message}` seperti API
// Freedom Finger, supaya halaman cukup punya satu cara membaca kegagalan.
import type { BunRequest, Server } from 'bun';

/** Kegagalan yang pesannya boleh dibaca pengguna (input salah, belum login, dst.). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (status: number, message: string) => Response.json({ success: false, message }, { status });

/** Body JSON berupa objek; selain itu 400. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body harus objek JSON.');
  return body as Record<string, unknown>;
}

/** Teks wajib dari body. */
export function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value) throw new HttpError(400, `${key} wajib diisi.`);
  return value;
}

/** Handler route yang hanya untuk user yang sudah login: `user` = nama user itu. */
export type Handler = (req: BunRequest, user: string, server: Server<undefined>) => Response | Promise<Response>;
export type Routes = Record<string, Handler | Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', Handler>>>;
