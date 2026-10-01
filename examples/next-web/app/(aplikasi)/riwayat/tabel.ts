// Hitungan menu Riwayat tanpa tampilan: daftar hadir per hari (sel berwarna menurut recapAll, sama dengan
// Rekap), arti scan, dan tabel untuk export.
import type { App } from '@/components/aplikasi';
import type { Table } from '@/lib/export';
import { reportTitle } from '@/lib/export';
import { LABEL, VERIFY, dayName, hhmm, monthName, today } from '@/lib/format';
import { LEAVE_KINDS, addDays, minutes, scanRoles, type RecapDay } from '@/lib/rekap';
import { recapAll } from '@/lib/rekap-app';
import type { LeaveKind, Scan } from '@/lib/types';

/**
 * Isi satu sel: `kind` untuk warna, `in`/`out` jam, `text` untuk yang tanpa jam, dan `about` (kalimat
 * lengkapnya). Pulang "?" = hari sudah lewat tanpa absen pulang.
 */
export type Cell = {
  kind: string;
  text?: string;
  about: string;
  in?: string;
  out?: string;
  late?: number;
  early?: number;
  manualIn?: boolean;
  manualOut?: boolean;
};

/** Cocok dengan kotak cari (nama atau PIN); `q` sudah huruf kecil. */
export const matches = (app: App, q: string) => (pin: string) => !q || pin.includes(q) || app.nameOf(pin).toLowerCase().includes(q);

/**
 * Arti scan menurut aturan rekap (masuk = scan pertama, pulang = terakhir), bukan tombol mesin yang diganti
 * mesin sendiri menurut jam. Satu mesin dipilih: dihitung dari scan mesin itu saja.
 */
export function rolesOf(app: App, list: Scan[]) {
  const roles = scanRoles(list, app.minGapOf);
  return (l: Scan) => roles.get(`${l.pin} ${l.scan_date}`) ?? '';
}
export const verify = (l: Scan) => (l.manual ? 'Manual' : (VERIFY[String(l.verify)] ?? String(l.verify)));

export const shortDate = (date: string) => `${Number(date.slice(8))} ${monthName(date).slice(0, 3)}`;
/** Lama terlambat singkat untuk sel: 45 -> "+45", 67 -> "+1j07", 120 -> "+2j" (menit besar sulit dibaca). */
export const lateText = (m: number) => (m < 60 ? `+${m}` : `+${Math.floor(m / 60)}j${m % 60 ? String(m % 60).padStart(2, '0') : ''}`);

function cell(d: RecapDay | undefined, isToday: boolean, isManual: (t: string) => boolean): Cell {
  if (!d) return { kind: '', text: '', about: '' };
  if (LEAVE_KINDS.includes(d.status as LeaveKind)) return { kind: 'izin', text: LABEL[d.status], about: LABEL[d.status] };
  if (d.status === 'alpa') return isToday ? { kind: '', text: '', about: 'belum scan' } : { kind: 'alpa', text: 'Alpa', about: 'tidak masuk' };
  if (d.in == null) return { kind: 'libur', text: '', about: `libur${d.note ? `: ${d.note}` : ''}` };
  const out = d.out != null ? hhmm(d.out) : d.noOut && !isToday ? '?' : '';
  const lateLong = d.late < 60 ? `${d.late} menit` : `${Math.floor(d.late / 60)} jam${d.late % 60 ? ` ${d.late % 60} menit` : ''}`;
  const about = [`masuk ${hhmm(d.in)}`, d.late && `terlambat ${lateLong}`, out === '?' ? 'tanpa absen pulang' : out && `pulang ${out}`,
    d.early && `${d.early} menit sebelum jam pulang`, d.status === 'libur' && 'di hari libur'].filter(Boolean).join(', ');
  return { kind: d.status === 'libur' ? 'libur' : d.late ? 'telat' : '', in: hhmm(d.in), out, late: d.late, early: d.early,
    manualIn: isManual(hhmm(d.in)), manualOut: d.out != null && isManual(out), about };
}

/** Karyawan yang cocok dengan pencarian (urut nama), tanggal urut sampai hari ini, dan isi tiap sel. */
export function sheet(app: App, scans: Scan[], from: string, to: string, q: string) {
  const now = today();
  const last = to < now ? to : now;
  const pins = [...new Set([...app.knownPins(), ...scans.map((s) => s.pin)])].filter((pin) => app.inRecap(pin)).filter(matches(app, q))
    .sort((a, b) => app.nameOf(a).localeCompare(app.nameOf(b), 'id'));
  const days = new Map<string, RecapDay>(); // "PIN tanggal" -> hari dari recap(); hari ini ikut dihitung (until = besok)
  const dates: string[] = [];
  if (from && from <= last) {
    for (const r of recapAll(app, scans, pins, from, last, addDays(now, 1))) for (const d of r.days) days.set(`${r.pin} ${d.date}`, d);
    for (let d = from; d <= last; d = addDays(d, 1)) dates.push(d);
  }
  const manual = new Set(app.data.corrections.map((c) => `${c.pin} ${c.date} ${c.time}`));
  return {
    pins,
    dates,
    now,
    cell: (pin: string, date: string) => cell(days.get(`${pin} ${date}`), date === now, (t) => manual.has(`${pin} ${date} ${t}`)),
  };
}
export type Sheet = ReturnType<typeof sheet>;

/** Daftar hadir untuk export: satu baris per karyawan, satu kolom per tanggal, isinya teks pendek. */
export function sheetTable(app: App, { pins, dates, cell: at }: Sheet, from: string, to: string): Table {
  const text = (c: Cell) => {
    if (!c.in) return c.text || (c.kind === 'libur' ? 'Libur' : '');
    const notes = [c.late && `terlambat ${c.late} mnt`, c.out === '?' && 'tanpa pulang'].filter(Boolean);
    return `${c.in}${c.out && c.out !== '?' ? `–${c.out}` : ''}${notes.length ? ` (${notes.join(', ')})` : ''}`;
  };
  return {
    name: 'Riwayat',
    title: reportTitle(app.data.office, 'Riwayat absen', from, to),
    columns: [{ title: 'Nama', kind: 'text', width: 24 }, { title: 'PIN', kind: 'text', width: 7 },
      ...dates.map((date) => ({ title: `${dayName(date).slice(0, 3)} ${shortDate(date)}`, kind: 'text', width: 13 }))],
    rows: pins.map((pin) => [app.nameOf(pin), pin, ...dates.map((date) => text(at(pin, date)))]),
  };
}

/** Semua scan untuk export: `every` = semua scan rentang ini (untuk arti scan), `list` = yang cocok pencarian. */
export function logTable(app: App, every: Scan[], list: Scan[], from: string, to: string): Table {
  const role = rolesOf(app, every);
  return {
    name: 'Riwayat',
    title: reportTitle(app.data.office, 'Riwayat absen', from, to),
    columns: [
      { title: 'Tanggal', kind: 'date', width: 12 },
      { title: 'Jam', kind: 'time', width: 8 },
      { title: 'Nama', kind: 'text', width: 28 },
      { title: 'PIN', kind: 'text', width: 8 },
      { title: 'Dihitung sebagai', kind: 'text', width: 15 },
      { title: 'Verifikasi', kind: 'text', width: 11 },
      { title: 'Mesin', kind: 'text', width: 20 },
      { title: 'Keterangan', kind: 'text', width: 30 },
    ],
    rows: list.map((l) => [l.scan_date.slice(0, 10), minutes(l.scan_date, 11), app.nameOf(l.pin), l.pin, role(l), verify(l), l.cloud_id, l.reason]),
  };
}
