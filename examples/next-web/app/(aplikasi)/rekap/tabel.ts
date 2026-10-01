// Hitungan menu Rekap tanpa tampilan: keterangan hari, dan tabel ringkasan dan rincian untuk export.
import type { App } from '@/components/aplikasi';
import { reportTitle, type Table } from '@/lib/export';
import { LABEL, dayName } from '@/lib/format';
import { LEAVE_KINDS, type RecapDay, type RecapResult } from '@/lib/rekap';
import type { LeaveKind } from '@/lib/types';

/** Ada hari dengan lembur aktif di salah satu jadwal. */
export const anyOvertime = (app: App) => [app.data.schedule, ...app.data.schedules].some((s) => s.overtime.some(Boolean));

/** Keterangan hari: libur, catatan izin, koreksi manual beserta alasannya, dan temuan rekap. */
export function note(app: App, d: RecapDay, pin: string) {
  const { leaves, corrections } = app.data;
  const leave = LEAVE_KINDS.includes(d.status as LeaveKind) && leaves.find((l) => l.pin === pin && l.from <= d.date && d.date <= l.to)?.note;
  return [
    d.note,
    leave,
    ...corrections.filter((c) => c.pin === pin && c.date === d.date).sort((a, b) => a.time.localeCompare(b.time)).map((c) => `Manual ${c.time}: ${c.reason}`),
    d.noOut && 'Lupa absen pulang',
    d.status === 'libur' && d.in != null && d.out == null && 'Scan di hari libur tanpa pulang',
    d.status === 'libur' && d.overtime && 'Lembur hari libur',
  ].filter(Boolean).join('; ');
}

/** Judul laporan: ringkasan, atau rincian satu karyawan. */
export const titleOf = (app: App, from: string, to: string, pin?: string | null) =>
  reportTitle(app.data.office, pin ? `Rincian absensi ${app.nameOf(pin)} (PIN ${pin})` : 'Rekap absensi', from, to);

/** Tanpa kolom Lembur bila lembur tidak dihitung di hari mana pun. */
function withoutOvertime(app: App, t: Table): Table {
  if (anyOvertime(app)) return t;
  const keep = t.columns.map((c) => !c.title.startsWith('Lembur'));
  return { ...t, columns: t.columns.filter((_, i) => keep[i]), rows: t.rows.map((r) => r.filter((_, i) => keep[i])) };
}

/** Ringkasan per karyawan untuk export. */
export function summaryTable(app: App, result: RecapResult[], from: string, to: string): Table {
  const int = (title: string, width = 10) => ({ title, kind: 'int', width });
  return withoutOvertime(app, {
    name: 'Ringkasan',
    title: titleOf(app, from, to),
    columns: [
      { title: 'PIN', kind: 'text', width: 8 }, { title: 'Nama', kind: 'text', width: 28 }, { title: 'Departemen', kind: 'text', width: 16 },
      { title: 'Jadwal', kind: 'text', width: 14 }, int('Hari kerja'), int('Hadir'), int('Terlambat (kali)'), int('Terlambat (menit)'), int('Pulang cepat (kali)'),
      int('Pulang cepat (menit)'), int('Lupa absen pulang'), int('Alpa'), int('Izin'), int('Sakit'), int('Cuti'), int('Dinas luar'),
      { title: 'Jam kerja (jam)', kind: 'hours', width: 11 }, { title: 'Lembur (jam)', kind: 'hours', width: 11 },
    ],
    rows: result.map(({ pin, total: t }) => [pin, app.nameOf(pin), app.deptOf(pin), app.scheduleName(pin), t.workDays, t.present, t.late, t.lateMin, t.early,
      t.earlyMin, t.noOut, t.absent, t.izin, t.sakit, t.cuti, t.dinas, t.hours, t.overtime]),
  });
}

/** Rincian per hari: semua karyawan, atau satu PIN. */
export function daysTable(app: App, result: RecapResult[], from: string, to: string, pin?: string | null): Table {
  const list = pin ? result.filter((r) => r.pin === pin) : result;
  return withoutOvertime(app, {
    name: 'Rincian',
    title: titleOf(app, from, to, pin),
    columns: [
      { title: 'PIN', kind: 'text', width: 8 }, { title: 'Nama', kind: 'text', width: 28 }, { title: 'Tanggal', kind: 'date', width: 12 },
      { title: 'Hari', kind: 'text', width: 9 }, { title: 'Masuk', kind: 'time', width: 8 }, { title: 'Pulang', kind: 'time', width: 8 },
      { title: 'Status', kind: 'text', width: 10 }, { title: 'Terlambat (menit)', kind: 'int', width: 10 },
      { title: 'Pulang cepat (menit)', kind: 'int', width: 10 }, { title: 'Jam kerja (jam)', kind: 'hours', width: 10 },
      { title: 'Lembur (jam)', kind: 'hours', width: 10 }, { title: 'Keterangan', kind: 'text', width: 30 },
    ],
    rows: list.flatMap((r) => r.days.map((d) => [r.pin, app.nameOf(r.pin), d.date, dayName(d.date), d.in, d.out, LABEL[d.status], d.late,
      d.early, d.hours, d.overtime, note(app, d, r.pin)])),
  });
}
