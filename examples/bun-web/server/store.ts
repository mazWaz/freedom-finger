// File JSON di folder data, ditulis atomik: tulis ke file sementara, pastikan sampai disk, lalu ganti
// nama. Bila server mati di tengah jalan, file lama tetap utuh.
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error(`${file} rusak atau tidak bisa dibaca: ${(e as Error).message}`);
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const f = await open(tmp, 'w', 0o600); // users.json berisi hash kata sandi: hanya pemilik
  try {
    await f.writeFile(JSON.stringify(value, null, 2));
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(tmp, file);
}

/** Antrean tulis per file: tulisan berurutan, jadi isi terbaru tidak tertimpa tulisan yang lebih lama. */
export function writer(file: string) {
  let last: Promise<void> = Promise.resolve();
  return (value: () => unknown) => {
    // tulisan yang gagal tidak menghentikan antrean; pemanggilnya yang menerima errornya
    last = last.catch(() => {}).then(() => writeJson(file, value()));
    return last;
  };
}
