// Data milik aplikasi (aplikasi.json, isinya diatur halaman: nama karyawan, jadwal, libur, izin, …).
// Beberapa user bisa membuka aplikasi bersamaan, jadi setiap simpan membawa `rev` yang terakhir dibaca:
// bila orang lain sudah menyimpan lebih dulu, simpan ditolak (409) supaya perubahannya tidak tertimpa.
import { join } from 'node:path';
import { HttpError, fail, readBody, type Routes } from './http.ts';
import { readJson, writer } from './store.ts';

export async function createData(dataDir: string) {
  const file = join(dataDir, 'aplikasi.json');
  const data = await readJson<Record<string, unknown> | null>(file, null);
  // aplikasi.json dari aplikasi desktop boleh disalin ke sini; kata sandi desktop tidak dipakai di web
  if (data) delete data.auth;
  let current: { rev: string; data: Record<string, unknown> | null } = { rev: crypto.randomUUID(), data };
  const save = writer(file);

  const routes: Routes = {
    '/app/data': {
      GET: () => Response.json({ success: true, ...current }),
      PUT: async (req) => {
        const body = await readBody(req);
        if (body.rev !== current.rev) return fail(409, 'Data baru saja diubah pengguna lain.');
        if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new HttpError(400, 'data harus objek.');
        current = { rev: crypto.randomUUID(), data: body.data as Record<string, unknown> };
        await save(() => current.data);
        return Response.json({ success: true, rev: current.rev });
      },
    },
  };
  return { routes };
}
