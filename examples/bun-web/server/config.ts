// Pengaturan dari environment. Bun membaca file .env sendiri; contoh isinya di .env.example.
import { resolve } from 'node:path';

export type Config = {
  /** Server Freedom Finger, tempat mesin mengirim absen. */
  ffUrl: string;
  /** FKWEB_TOKEN di freedom-finger.env. Hanya dipakai server ini, tidak pernah dikirim ke browser. */
  ffToken: string;
  port: number;
  /** Folder aplikasi.json (data aplikasi) dan users.json (user dan hash kata sandi). */
  dataDir: string;
};

function env(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`${name} belum diisi. Salin .env.example menjadi .env, lalu isi.`);
  return value;
}

export function loadConfig(): Config {
  return {
    ffUrl: env('FREEDOM_FINGER_URL', 'http://localhost:8013').replace(/\/+$/, ''),
    ffToken: env('FREEDOM_FINGER_TOKEN'),
    port: Number(env('PORT', '3000')),
    dataDir: resolve(env('DATA_DIR', './data')),
  };
}
