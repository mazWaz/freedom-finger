// Bentuk balasan dan error yang sama untuk semua route: `{success: false, message}` seperti API
// Freedom Finger, supaya halaman cukup punya satu cara membaca kegagalan.

/** Kegagalan yang pesannya boleh dibaca pengguna (input salah, belum login, dst.). */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const fail = (status: number, message: string) => Response.json({ success: false, message }, { status });

/** Body JSON berupa objek; selain itu 400. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body harus objek JSON.');
  return body as Record<string, unknown>;
}

