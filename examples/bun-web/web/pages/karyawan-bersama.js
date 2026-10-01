// Bagian bersama menu Karyawan (karyawan.js, karyawan-laci.js): nomor kredensial di mesin, cadangan
// kredensial per PIN (dari get_backup), dan cara menjalankan perintah ke mesin dengan pesan yang jelas.
import { backups, devices, users } from '../lib/api.js';
import { isRemoved } from '../lib/data.js';
import { enrolled } from '../lib/hitung-rekap.js';
import { REJECT } from './mesin.js';

export const PASSWORD = 10; // backup_number: jari 0-9, password 10, kartu 11, wajah 12
export const CARD = 11;
export const FACE = 12;
export const FINGERS = Array.from({ length: 10 }, (_, i) => `Jari ${i + 1}`);
export const what = (no) => ({ [PASSWORD]: 'Password', [CARD]: 'Kartu', [FACE]: 'Wajah' })[no] ?? FINGERS[no];
/** Sudah terdaftar menurut enrolled(): nomor jari, password, kartu, atau wajah. */
export const got = (c, no) => ({ [PASSWORD]: c.password, [CARD]: c.card, [FACE]: c.face })[no] ?? c.fingers.includes(no);
/** Nama di mesin: 15 huruf pertama (batas mesin), tanpa spasi di ujung. */
export const shortName = (name) => name.slice(0, 15).trim();
export const NONE = { fingers: [], password: false, card: false, face: false };
export const creds = new Map(); // PIN -> enrolled(): gabungan cadangan semua mesin
export const credText = (c) => [...c.fingers.map((n) => FINGERS[n]), c.face && 'wajah', c.card && 'kartu', c.password && 'password'].filter(Boolean).join(', ');
/** Ringkas untuk tabel: "2 jari, wajah, kartu". */
export const credShort = (c) => [c.fingers.length && `${c.fingers.length} jari`, c.face && 'wajah', c.card && 'kartu', c.password && 'password']
  .filter(Boolean).join(', ');
/** User terbaru di server untuk PIN ini (nama dan hak akses di mesin), dari semua mesin. */
export const latestUser = (pin) => users.filter((u) => u.pin === pin).sort((a, b) => a.updated.localeCompare(b.updated)).at(-1);
/** Mesin tempat PIN ini satu-satunya admin: tanpa admin, siapa pun bisa membuka menu mesin. */
export const soleAdmin = (pin) => users.filter((u) => u.pin === pin && u.privilege === '2' && !users.some((o) =>
  o.cloud_id === u.cloud_id && o.pin !== pin && o.privilege === '2' && !isRemoved(o.pin))).map((u) => u.cloud_id);
/**
 * Mesin terhubung yang punya PIN ini. Belum tercatat di mana pun (baru ditambah, belum mendaftar) = semua
 * mesin terhubung. Perintah untuk PIN yang tidak ada di mesin tidak dijawab (menunggu 5 menit).
 */
export function targets(pin) {
  const on = devices.filter((d) => d.connected);
  if (!on.length) throw new Error('Belum ada mesin yang terhubung. Lihat isian menu mesin di Hari ini.');
  const has = on.filter((d) => users.some((u) => u.cloud_id === d.cloud_id && u.pin === pin));
  return has.length ? has : on;
}
/** Pesan di paragraf status `p` (merah bila `error`). */
export function status(p, text, error = false) {
  p.textContent = text;
  p.className = error ? 'catatan' : 'catatan info';
  p.hidden = false;
}
/** Hasil perintah yang berhasil, atau Error dengan pesan untuk pengguna. */
export function ok(r) {
  if (r.status === 'done' && r.result_code === 'OK') return r;
  throw new Error(r.status === 'offline' ? 'Mesin terputus sebelum mengambil perintah ini. Perintahnya tetap menunggu dan dijalankan saat mesin tersambung lagi.'
    : r.status === 'timeout' ? 'Mesin tidak menjawab. Pastikan mesin terhubung, lalu coba lagi.'
      : `Mesin menolak: ${REJECT[r.result_code] ?? r.result_code}.`);
}
export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Kredensial terbaru PIN ini dari cadangan semua mesin, disimpan di `creds`. */
export async function refreshCreds(pin) {
  const all = (await backups(pin)).map((b) => enrolled(b.body));
  const any = (k) => all.some((c) => c[k]);
  creds.set(pin, { fingers: [...new Set(all.flatMap((c) => c.fingers))].sort((a, b) => a - b), password: any('password'), card: any('card'), face: any('face') });
}
