// Data milik aplikasi (aplikasi.json, isinya diatur halaman: nama karyawan, jadwal, libur, izin, …).
// Beberapa user bisa membuka aplikasi bersamaan, jadi setiap simpan membawa `rev` yang terakhir dibaca:
// bila orang lain sudah menyimpan lebih dulu, simpan ditolak (409) supaya perubahannya tidak tertimpa.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { HttpError } from './http.ts';
import { readJson, writer } from './store.ts';

type Saved = { rev: string; data: Record<string, unknown> | null };

export async function createData(dataDir: string) {
  const file = join(dataDir, 'aplikasi.json');
  const data = await readJson<Record<string, unknown> | null>(file, null);
  // aplikasi.json dari aplikasi desktop boleh disalin ke sini; kata sandi desktop tidak dipakai di web
  if (data) delete data.auth;
  let current: Saved = { rev: randomUUID(), data };
  const save = writer(file);

  return {
    get: () => current,
    /** Simpan bila `rev` masih yang terbaru; hasil: rev baru. */
    async put(rev: unknown, data: unknown): Promise<string> {
      if (rev !== current.rev) throw new HttpError(409, 'Data baru saja diubah pengguna lain.');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'data harus objek.');
      current = { rev: randomUUID(), data: data as Record<string, unknown> };
      await save(() => current.data);
      return current.rev;
    },
  };
}
