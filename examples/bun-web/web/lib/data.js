// Data milik aplikasi (aplikasi.json di server web, server/data.ts) dan karyawan: nama, bagian, jadwal,
// ikut rekap. Isian aplikasi menang atas nama di mesin. Beberapa user bisa membuka aplikasi bersamaan:
// simpan membawa `rev`, dan ditolak bila orang lain sudah menyimpan lebih dulu (lihat saveData).
import { emit, machineName, request, users } from './api.js';
import { DEFAULT_SCHEDULE, weekday } from './hitung-rekap.js';
import { esc, notify } from './ui.js';

const defaults = () => ({
  version: 1,
  office: '', // nama kantor untuk judul laporan
  employees: {}, // PIN -> {name, dept, recap}: isian aplikasi menang atas nama di mesin
  schedule: structuredClone(DEFAULT_SCHEDULE), // jadwal utama, dan aturan (toleransi, batas lembur) untuk semua jadwal
  schedules: [], // jadwal lain {id, name, color, days, overtime, overtimeMax}, dipilih per karyawan (mis. paruh waktu)
  holidays: [], // {date, note}
  leaves: [], // {id, pin, from, to, kind, note}: izin/sakit/cuti/dinas (izin.js)
  corrections: [], // {id, pin, date, time, reason}: koreksi absen, dihitung sebagai scan; tidak pernah ditulis ke mesin
  pull: {}, // cloud_id -> ambil data karyawan yang sedang berjalan (karyawan.js)
  commands: [], // {trans, cloud_id, type, at}: perintah perawatan yang menunggu mesin (mesin.js)
});
export const data = defaults();

/** Versi data yang terakhir dibaca dari server. */
let rev;

/** Pakai data dari server (`{rev, data}`), termasuk mengubah bentuk lama ke yang sekarang. */
function apply(r) {
  rev = r.rev;
  const saved = r.data ?? {};
  const d = defaults();
  for (const k of Object.keys(data)) delete data[k]; // isian lama yang sudah dihapus orang lain
  Object.assign(data, d, saved, { schedule: { ...d.schedule, ...saved.schedule } });
  // dulu lembur satu sakelar untuk semua jadwal (`overtimeOn`); sekarang per hari di tiap jadwal
  const on = saved.schedule?.overtimeOn !== false;
  if (!saved.schedule?.overtime) data.schedule.overtime = Array(7).fill(on);
  for (const s of data.schedules) s.overtime ??= Array(7).fill(on);
  // lembur maksimal per hari (menit); sempat satu angka per jadwal
  for (const s of [data.schedule, ...data.schedules]) if (!Array.isArray(s.overtimeMax)) s.overtimeMax = Array(7).fill(s.overtimeMax || 0);
  data.schedules.forEach((s, i) => (s.color ??= SCHEDULE_COLORS[i % SCHEDULE_COLORS.length]));
}

export const loadData = async () => apply(await request('/app/data'));

/** Ambil lagi bila orang lain menyimpan sejak dibaca, lalu gambar ulang tab yang terbuka. */
export async function refreshData() {
  const r = await request('/app/data');
  if (r.rev === rev) return;
  apply(r);
  emit('data');
}

/**
 * Simpan aplikasi.json (atomik di server), lalu beri tahu tab yang terbuka. Bila orang lain sudah
 * menyimpan lebih dulu, perubahan ini tidak disimpan: data terbaru dimuat dan pengguna diminta mengulang.
 * Kegagalan sudah ditampilkan di sini; pemanggil yang menunggu (`await`) tetap menerima errornya untuk
 * berhenti, dan pemanggil yang tidak menunggu tidak memicu "unhandled rejection".
 */
export function saveData(change = 'data') {
  const saving = save(change);
  saving.catch(() => {});
  return saving;
}

async function save(change) {
  try {
    rev = (await request('/app/data', 'PUT', { rev, data })).rev;
  } catch (e) {
    if (e.status === 409) {
      await loadData();
      emit('data');
      notify('Data baru saja diubah pengguna lain, jadi perubahan Anda tidak tersimpan. Tampilan sudah diperbarui; ulangi perubahannya.', true);
    } else notify(`Gagal menyimpan: ${e.message}`, true);
    throw e;
  }
  if (change) emit(change);
}

// --- karyawan ---------------------------------------------------------------------------------

export const byPin = (a, b) => a.length - b.length || a.localeCompare(b);
export const nameOf = (pin) => data.employees[pin]?.name || machineName(pin) || `PIN ${pin}`;
export const deptOf = (pin) => data.employees[pin]?.dept ?? '';
export const inRecap = (pin) => data.employees[pin]?.recap !== false;
/** Jadwal lain yang dipilih untuk karyawan ini; `undefined` = jadwal utama. */
export const scheduleOf = (pin) => data.schedules.find((s) => s.id === data.employees[pin]?.schedule);
export const scheduleName = (pin) => scheduleOf(pin)?.name ?? 'Utama';
/** Jarak minimal masuk–pulang (menit) untuk PIN ini di tanggal ini; hari jam bebas 0: scan kedua sudah pulang. */
export const minGapOf = (pin, date) =>
  !data.holidays.some((h) => h.date === date) && (scheduleOf(pin) ?? data.schedule).days[weekday(date)]?.free ? 0 : data.schedule.minGap;
/** Warna bawaan jadwal lain, jauh dari warna status (hijau tepat waktu, merah terlambat, biru izin). */
export const SCHEDULE_COLORS = ['#7c3aed', '#d97706', '#db2777', '#0d9488', '#4f46e5', '#92400e'];
/** Warna satu jadwal ("#rrggbb"); jadwal utama bawaan abu-abu biru. Dicek karena masuk ke atribut style. */
export const colorOf = (s) => (/^#[0-9a-f]{6}$/i.test(s?.color ?? '') ? s.color : '#64748b');
/** Tanda jadwal karyawan (titik warna dan nama) untuk Hari ini; kosong bila hanya ada jadwal utama. */
export const scheduleTag = (pin) => (data.schedules.length
  ? `<span class="jadwal-tag" style="--warna: ${colorOf(scheduleOf(pin) ?? data.schedule)}">${esc(scheduleName(pin))}</span>` : '');
/**
 * Dihapus dari mesin lewat aplikasi (`employees[pin].removed` = "YYYY-MM-DD hh:mm:ss") dan belum terdaftar
 * lagi sesudahnya. Riwayat absennya tetap ada; hari sesudah tanggal hapus tidak dihitung di rekap.
 */
export const isRemoved = (pin) => {
  const at = data.employees[pin]?.removed;
  return !!at && !users.some((u) => u.pin === pin && u.updated > at);
};
/** PIN yang pernah dipakai (termasuk yang dihapus): dipakai lagi berarti riwayat absennya tercampur. */
export const usedPins = () => [...new Set([...users.map((u) => u.pin), ...Object.keys(data.employees)])].sort(byPin);
/** Semua karyawan: dari mesin dan dari isian aplikasi, kecuali yang dihapus dari mesin. */
export const knownPins = () => usedPins().filter((pin) => !isRemoved(pin));
