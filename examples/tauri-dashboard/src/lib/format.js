// Tanggal dan jam untuk tampilan: format Indonesia, rentang cepat. Hitungan tanggal murni ada di hitung-rekap.js.
import { addDays, addMonths, weekday } from './hitung-rekap.js';

export const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, jam komputer ini
export const pad = (n) => String(n).padStart(2, '0');
/** menit -> "08:05"; 1440 ke atas = besoknya (pulang jam bebas lewat tengah malam): "01:55 (+1)" */
export const hhmm = (m) => (m == null ? '' : `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}${m >= 1440 ? ' (+1)' : ''}`);
/** lama dalam menit -> "8:05" (jam:menit), kosong bila 0 */
export const duration = (m) => (m ? `${Math.floor(m / 60)}:${pad(m % 60)}` : '');
export const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const dayName = (date) => DAY_NAMES[weekday(date)];
/** 2026-09-29 -> 29-09-2026 */
export const dmy = (date) => date.split('-').reverse().join('-');
export const period = (from, to) => (from === to ? dmy(from) : `${dmy(from)} s.d. ${dmy(to)}`);
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** 2026-01-01 -> "1 Januari 2026" */
export const longDate = (date) => `${Number(date.slice(8))} ${monthName(date)}`;
/** "2026-09" -> ["2026-09-01", "2026-09-30"] */
export const monthRange = (ym) => [`${ym}-01`, new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10)];
/** `n` bulan terakhir, terbaru dulu: ["2026-09", "2026-08", …] */
export function lastMonths(n) {
  const [y, m] = today().split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
}
/** Rentang cepat di pemilih rentang tanggal (tanggal.js): label -> [dari, sampai] */
export function ranges() {
  const t = today();
  const first = `${t.slice(0, 8)}01`;
  const last = addDays(first, -1);
  const back = (n) => [addDays(addMonths(t, -n), 1), t]; // n bulan terakhir, sampai hari ini
  return {
    'Hari ini': [t, t],
    Kemarin: [addDays(t, -1), addDays(t, -1)],
    'Minggu ini': [addDays(t, -((weekday(t) + 6) % 7)), t], // minggu mulai Senin
    '1 minggu terakhir': [addDays(t, -6), t],
    'Bulan ini': [first, t],
    'Bulan lalu': [`${last.slice(0, 8)}01`, last],
    '1 bulan terakhir': back(1),
    '2 bulan terakhir': back(2),
    '3 bulan terakhir': back(3),
    '6 bulan terakhir': back(6),
    '1 tahun terakhir': back(12),
  };
}
