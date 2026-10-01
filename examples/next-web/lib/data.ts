// Data milik aplikasi (aplikasi.json di server web) dan karyawan: nama, bagian, jadwal, ikut rekap.
// Isian aplikasi menang atas nama di mesin. Fungsi murni; state-nya di components/aplikasi.tsx.
import { DEFAULT_SCHEDULE, weekday } from './rekap';
import type { AppData, MachineUser, OtherSchedule, Schedule } from './types';

export const defaults = (): AppData => ({
  version: 1,
  office: '', // nama kantor untuk judul laporan
  employees: {}, // PIN -> {name, dept, recap}: isian aplikasi menang atas nama di mesin
  schedule: structuredClone(DEFAULT_SCHEDULE), // jadwal utama, dan aturan (toleransi, batas lembur) untuk semua jadwal
  schedules: [], // jadwal lain, dipilih per karyawan (mis. paruh waktu)
  holidays: [],
  leaves: [], // izin/sakit/cuti/dinas (menu Izin & koreksi)
  corrections: [], // koreksi absen, dihitung sebagai scan; tidak pernah ditulis ke mesin
  pull: {}, // cloud_id -> ambil data karyawan yang sedang berjalan (components/tugas.tsx)
  commands: [], // perintah perawatan yang menunggu mesin (menu Mesin)
});

/** Warna bawaan jadwal lain, jauh dari warna status (hijau tepat waktu, merah terlambat, biru izin). */
export const SCHEDULE_COLORS = ['#7c3aed', '#d97706', '#db2777', '#0d9488', '#4f46e5', '#92400e'];
/** Warna satu jadwal ("#rrggbb"); jadwal utama bawaan abu-abu biru. Dicek karena masuk ke style. */
export const colorOf = (s?: { color?: string }) => (/^#[0-9a-f]{6}$/i.test(s?.color ?? '') ? s!.color! : '#64748b');

/** aplikasi.json dari server -> bentuk sekarang (juga isian dari versi lama aplikasi desktop). */
export function normalize(saved: Partial<AppData> | null): AppData {
  const raw = (saved ?? {}) as Partial<AppData> & { schedule?: Partial<Schedule> & { overtimeOn?: boolean } };
  const d = defaults();
  const data: AppData = { ...d, ...raw, schedule: { ...d.schedule, ...raw.schedule } };
  // dulu lembur satu sakelar untuk semua jadwal (`overtimeOn`); sekarang per hari di tiap jadwal
  const on = raw.schedule?.overtimeOn !== false;
  if (!raw.schedule?.overtime) data.schedule.overtime = Array(7).fill(on);
  for (const s of data.schedules) s.overtime ??= Array(7).fill(on);
  // lembur maksimal per hari (menit); sempat satu angka per jadwal
  for (const s of [data.schedule, ...data.schedules] as (Schedule | OtherSchedule)[]) {
    if (!Array.isArray(s.overtimeMax)) s.overtimeMax = Array(7).fill(Number(s.overtimeMax) || 0);
  }
  data.schedules.forEach((s, i) => (s.color ??= SCHEDULE_COLORS[i % SCHEDULE_COLORS.length]));
  return data;
}

/** PIN urut angka: "2" sebelum "10". */
export const byPin = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

/** Karyawan dari aplikasi.json dan user di mesin (`get_users`). */
export function people(data: AppData, users: MachineUser[]) {
  const machineNames = new Map<string, string>();
  // PIN yang sama di beberapa mesin = satu karyawan; nama yang terbaru dipakai
  for (const u of [...users].sort((a, b) => a.updated.localeCompare(b.updated))) if (u.name) machineNames.set(u.pin, u.name);
  const machineName = (pin: string) => machineNames.get(pin) ?? '';
  const scheduleOf = (pin: string) => data.schedules.find((s) => s.id === data.employees[pin]?.schedule);
  /**
   * Dihapus dari mesin lewat aplikasi (`employees[pin].removed` = "YYYY-MM-DD hh:mm:ss") dan belum terdaftar
   * lagi sesudahnya. Riwayat absennya tetap ada; hari sesudah tanggal hapus tidak dihitung di rekap.
   */
  const isRemoved = (pin: string) => {
    const at = data.employees[pin]?.removed;
    return !!at && !users.some((u) => u.pin === pin && u.updated > at);
  };
  /** PIN yang pernah dipakai (termasuk yang dihapus): dipakai lagi berarti riwayat absennya tercampur. */
  const usedPins = () => [...new Set([...users.map((u) => u.pin), ...Object.keys(data.employees)])].sort(byPin);
  return {
    machineName,
    nameOf: (pin: string) => data.employees[pin]?.name || machineName(pin) || `PIN ${pin}`,
    deptOf: (pin: string) => data.employees[pin]?.dept ?? '',
    inRecap: (pin: string) => data.employees[pin]?.recap !== false,
    /** Jadwal lain yang dipilih untuk karyawan ini; `undefined` = jadwal utama. */
    scheduleOf,
    scheduleName: (pin: string) => scheduleOf(pin)?.name ?? 'Utama',
    /** Jadwal PIN ini di tanggal ini: `{start, end}`, `{free: true}` (jam bebas), atau `null` (libur, juga tanggal libur kantor). */
    shiftOn: (pin: string, date: string) => (data.holidays.some((h) => h.date === date) ? null : (scheduleOf(pin) ?? data.schedule).days[weekday(date)]),
    isRemoved,
    usedPins,
    /** Semua karyawan: dari mesin dan dari isian aplikasi, kecuali yang dihapus dari mesin. */
    knownPins: () => usedPins().filter((pin) => !isRemoved(pin)),
  };
}

export type People = ReturnType<typeof people>;
