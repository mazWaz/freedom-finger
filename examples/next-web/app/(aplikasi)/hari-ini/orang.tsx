// Status tiap karyawan hari ini (papan, pita, laci rincian). Terlambat = scan pertama lewat jam masuk +
// toleransi, sama dengan Rekap. Koreksi absen hari ini ikut dihitung seperti scan.
import type { CSSProperties } from 'react';
import type { App } from '@/components/aplikasi';
import { colorOf } from '@/lib/data';
import { minutes } from '@/lib/rekap';
import type { Leave, Scan, Shift } from '@/lib/types';

export type Kind = 'belum' | 'telat' | 'izin' | 'tepat' | 'luar';
export const KIND: Record<Kind, string> = { belum: 'Belum datang', telat: 'Terlambat', izin: 'Izin', tepat: 'Tepat waktu', luar: 'Di luar jadwal' };
export const ORDER: Kind[] = ['belum', 'telat', 'izin', 'tepat', 'luar'];

/** Satu scan hari ini, urut jam. */
export type ScanTime = { m: number; manual: boolean; verify?: number | string; reason?: string };
/** `back` = menit pulang hari ini dari masuk jam bebas kemarin (bukan masuk hari ini). */
export type Person = { pin: string; kind: Kind; shift: Shift | null; scans: ScanTime[]; leave?: Leave; back?: number };

export const scanKey = (l: Scan) => `${l.cloud_id} ${l.pin} ${l.scan_date}`;

/**
 * Karyawan di papan hari ini; `list` = scan hari ini, terbaru dulu. `carried` (overnight): scan hari ini yang
 * menjadi pulang dari masuk jam bebas kemarin, bukan masuk hari ini.
 */
export function buildPeople(app: App, list: Scan[], day: string, carried: Map<string, string>) {
  const { data } = app;
  const holiday = data.holidays.find((h) => h.date === day);
  const scans = new Map<string, ScanTime[]>();
  const back = new Map<string, number>();
  for (const l of [...list].reverse()) {
    if (carried.has(`${l.pin} ${l.scan_date}`)) back.set(l.pin, minutes(l.scan_date, 11));
    else scans.set(l.pin, [...(scans.get(l.pin) ?? []), { m: minutes(l.scan_date, 11), manual: !!l.manual, verify: l.verify, reason: l.reason }]);
  }
  const leave = new Map(data.leaves.filter((l) => l.from <= day && day <= l.to).map((l) => [l.pin, l]));
  const people = app.knownPins().filter(app.inRecap).flatMap((pin): Person[] => {
    const s = app.shiftOn(pin, day) ?? null;
    const sc = scans.get(pin) ?? [];
    let kind: Kind;
    if (sc.length) kind = !s ? 'luar' : !s.free && sc[0].m > minutes(s.start) + data.schedule.tolerance ? 'telat' : 'tepat';
    else if (s) kind = leave.has(pin) ? 'izin' : 'belum';
    else return []; // tidak dijadwalkan dan tidak scan
    return [{ pin, kind, shift: s, scans: sc, leave: leave.get(pin), back: back.get(pin) }];
  });
  return { people, holiday };
}

/** Jam pulang: scan terakhir, bila cukup jauh dari scan pertama (lebih dekat = scan ganda; jam bebas: berapa pun). */
export const out = (p: Person, minGap: number) =>
  p.scans.length > 1 && p.scans.at(-1)!.m - p.scans[0].m >= (p.shift?.free ? 0 : minGap) ? p.scans.at(-1)! : null;
export const lateBy = (p: Person) => p.scans[0].m - (p.shift && !p.shift.free ? minutes(p.shift.start) : 0);

/** Tanda jadwal karyawan (titik warna dan nama); tidak tampil bila hanya ada jadwal utama. */
export function JadwalTag({ app, pin }: { app: App; pin: string }) {
  if (!app.data.schedules.length) return null;
  const style = { '--warna': colorOf(app.scheduleOf(pin) ?? app.data.schedule) } as CSSProperties;
  return <span className="jadwal-tag" style={style}>{app.scheduleName(pin)}</span>;
}
