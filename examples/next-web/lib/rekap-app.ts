// recap() (rekap.ts) untuk data aplikasi ini: jadwal per karyawan, karyawan baru dan yang dihapus.
// Dipakai menu Rekap dan Riwayat.
import { today } from './format';
import { recap } from './rekap';
import type { AppData, Schedule, Scan, OtherSchedule } from './types';
import type { People } from './data';

/**
 * Satu hitungan per jadwal (utama dan jadwal lain), aturan toleransi/lembur sama. `until` = tanggal
 * pertama yang belum dihitung (bawaan hari ini). `firstScans` = scan pertama tiap PIN sepanjang data.
 */
export function recapAll(
  app: People & { data: AppData; firstScans: Map<string, string> | null },
  scans: Scan[],
  pins: string[],
  from: string,
  to: string,
  until = today(),
) {
  const { data, firstScans } = app;
  const groups = new Map<Schedule | OtherSchedule, string[]>();
  for (const pin of pins) {
    const s = app.scheduleOf(pin) ?? data.schedule;
    groups.set(s, [...(groups.get(s) ?? []), pin]);
  }
  // karyawan yang dihapus dari mesin: dihitung sampai tanggal hapus
  const ends = Object.fromEntries(pins.filter(app.isRemoved).map((pin) => [pin, data.employees[pin].removed!.slice(0, 10)]));
  // karyawan baru: dihitung mulai hari pertama ada (scan pertama, ditambahkan lewat aplikasi, izin, atau koreksi);
  // tanpa satu pun = belum mulai. Scan di rentang ini ikut dihitung, supaya scan pertama yang baru masuk tidak terlewat
  const firstInRange = new Map<string, string>();
  for (const s of scans) if (!(firstInRange.get(s.pin)! <= s.scan_date)) firstInRange.set(s.pin, s.scan_date.slice(0, 10));
  const starts: Record<string, string> = !firstScans ? {} : Object.fromEntries(pins.map((pin) => [pin, [
    firstScans.get(pin), firstInRange.get(pin), data.employees[pin]?.added,
    ...data.corrections.filter((c) => c.pin === pin).map((c) => c.date), ...data.leaves.filter((l) => l.pin === pin).map((l) => l.from),
  ].filter((d): d is string => !!d).sort()[0] ?? '9999-12-31']));
  return [...groups].flatMap(([s, ps]) =>
    recap({
      scans,
      pins: ps,
      schedule: { ...data.schedule, days: s.days, overtime: s.overtime, overtimeMax: s.overtimeMax },
      holidays: data.holidays,
      leaves: data.leaves,
      from,
      to,
      today: until,
      starts,
      ends,
    }),
  );
}
