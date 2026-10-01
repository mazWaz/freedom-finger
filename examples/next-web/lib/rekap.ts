// Rekap absensi: fungsi murni tanpa DOM atau API, supaya bisa diuji (rekap.test.ts) dan dipakai
// aplikasi lain. Aturannya sama dengan PRD Feature 7, bagian Recap rules:
// - tombol Masuk/Pulang di mesin diabaikan; scan pertama hari itu = masuk
// - scan terakhir = pulang, bila berjarak minimal `minGap` menit dari masuk (lebih dekat = scan ganda);
//   hari jam bebas: scan terakhir selalu pulang, berapa pun jaraknya; masuk tanpa pulang = scan berikutnya
//   dalam 24 jam (hari lain) jadi pulangnya, dicatat sebagai menit sesudah 24:00 (overnight)
// - menit terlambat dihitung dari jam masuk, bukan dari akhir toleransi
// - hari ini dan sesudahnya belum dihitung
// Semua jam dalam menit sejak 00:00; detik diabaikan.
import type { Correction, Holiday, Leave, LeaveKind, Scan, Schedule, Shift } from './types.ts';

/** Nilai awal sampai aturan kantor diisi: Senin–Jumat 08:00–17:00. `days[0]` = Minggu; `null` = libur;
 * `{free: true}` = jam bebas (hari kerja tanpa jam masuk/pulang). */
export const DEFAULT_SCHEDULE: Schedule = {
  days: [null, ...Array.from({ length: 5 }, () => ({ start: '08:00', end: '17:00' })), null],
  tolerance: 15, // menit terlambat yang masih tepat waktu
  // lembur per hari (indeks sama dengan `days`): hari kerja = sesudah jam pulang, hari libur = seluruh jam kerja
  overtime: Array(7).fill(true),
  overtimeMin: 60, // lembur di bawah ini dihitung 0
  overtimeMax: Array(7).fill(0), // lembur paling lama (menit) per hari, indeks sama dengan `days`; 0 = tanpa batas
  minGap: 60, // jarak minimal masuk–pulang
};

export const LEAVE_KINDS: LeaveKind[] = ['izin', 'sakit', 'cuti', 'dinas'];

export type Status = 'hadir' | 'alpa' | 'libur' | LeaveKind;
export type RecapDay = {
  date: string;
  work: boolean;
  in: number | null;
  out: number | null;
  status: Status;
  late: number;
  early: number;
  noOut: boolean;
  hours: number;
  overtime: number;
  note: string;
};
export type RecapTotal = Record<LeaveKind, number> & {
  workDays: number;
  present: number;
  late: number;
  lateMin: number;
  early: number;
  earlyMin: number;
  noOut: number;
  absent: number;
  hours: number;
  overtime: number;
};
export type RecapResult = { pin: string; days: RecapDay[]; total: RecapTotal };

/** Koreksi absen `{pin, date, time: "hh:mm", reason}` di rentang -> scan untuk recap(), bertanda `manual`. */
export const correctionScans = (corrections: Correction[], from: string, to: string): Scan[] =>
  corrections
    .filter((c) => from <= c.date && c.date <= to)
    .map((c) => ({ pin: c.pin, scan_date: `${c.date} ${c.time}:00`, manual: true, reason: c.reason }));

/**
 * Ambil scan sejak sekian hari sebelum rentang (dan sehari sesudahnya) supaya overnight() benar di tepi rentang.
 * ponytail: rantai masuk-pulang lewat malam yang lebih panjang dari ini salah di awal rentang; perpanjang bila perlu.
 */
export const LOOKBACK_DAYS = 7;

/** "YYYY-MM-DD hh:mm:ss" -> menit sejak 1970 (jam dinding; detik diabaikan) */
const stamp = (s: string) => Date.parse(`${s.slice(0, 10)}T${s.slice(11, 16)}:00Z`) / 60_000;

/** Jadwal satu karyawan di satu tanggal; `null` = libur. */
export type ShiftOn = (pin: string, date: string) => Shift | null | undefined;

/**
 * Jam bebas lewat tengah malam: hari jam bebas yang hanya punya masuk (satu scan), lalu scan berikutnya dalam
 * 24 jam di hari lain = pulang hari itu, kecuali hari scan itu hari kerja berjam (scannya tetap masuk hari itu).
 * Hasil: "PIN scan_date" -> tanggal masuknya.
 */
export function overnight(scans: Scan[], shiftOn: ShiftOn) {
  const perPin = new Map<string, string[]>();
  for (const s of scans) perPin.set(s.pin, [...(perPin.get(s.pin) ?? []), s.scan_date]);
  const carried = new Map<string, string>();
  for (const [pin, list] of perPin) {
    list.sort();
    let open: string | null = null; // masuk hari jam bebas yang belum punya pulang
    for (let i = 0; i < list.length; ) {
      const date = list[i].slice(0, 10);
      const day: string[] = [];
      while (i < list.length && list[i].startsWith(date)) day.push(list[i++]);
      if (open && stamp(day[0]) - stamp(open) <= 1440 && !shiftOn(pin, date)?.start) carried.set(`${pin} ${day.shift()}`, open.slice(0, 10));
      open = day.length === 1 && shiftOn(pin, date)?.free ? day[0] : null;
    }
  }
  return carried;
}

/**
 * Arti tiap scan menurut aturan rekap, bukan tombol Masuk/Pulang di mesin (mesin mengganti tombol sendiri
 * menurut jam, mis. semua scan sebelum 09:00 tercatat "Pulang"): scan pertama per orang per hari = Masuk,
 * scan terakhir = Pulang bila minimal `minGap` menit sesudahnya (hari jam bebas: berapa pun), dan pulang
 * jam bebas lewat tengah malam (overnight); sisanya tidak dihitung.
 * Hasil: "PIN YYYY-MM-DD hh:mm:ss" -> 'Masuk' | 'Pulang'.
 */
export function scanRoles(scans: Scan[], minGap: number, shiftOn: ShiftOn) {
  const carried = overnight(scans, shiftOn);
  const roles = new Map<string, 'Masuk' | 'Pulang'>();
  const perDay = new Map<string, string[]>();
  for (const s of scans) {
    const k = `${s.pin} ${s.scan_date.slice(0, 10)}`;
    if (carried.has(`${s.pin} ${s.scan_date}`)) roles.set(`${s.pin} ${s.scan_date}`, 'Pulang');
    else perDay.set(k, [...(perDay.get(k) ?? []), s.scan_date]);
  }
  for (const [k, list] of perDay) {
    const pin = k.slice(0, k.indexOf(' '));
    list.sort();
    roles.set(`${pin} ${list[0]}`, 'Masuk');
    const gap = shiftOn(pin, list[0].slice(0, 10))?.free ? 0 : minGap;
    if (list.length > 1 && minutes(list.at(-1)!, 11) - minutes(list[0], 11) >= gap) roles.set(`${pin} ${list.at(-1)}`, 'Pulang');
  }
  return roles;
}

/**
 * Data user yang disimpan server (`get_backup` -> `template`): body FkWeb
 * u32 LE panjang JSON+NUL | JSON | [u32 LE panjang | biner]... (docs/protokol.md bagian 3).
 * Hasil `{info, bins}` (JSON dan blok biner, dirujuk JSON sebagai "BIN_n"), atau null.
 */
export function fkBody(body: Uint8Array): { info: Record<string, any>; bins: Uint8Array[] } | null {
  if (body.length < 4) return null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const n = view.getUint32(0, true);
  if (n > body.length - 4) return null;
  let info;
  try {
    info = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + n)).replace(/\0$/, ''));
  } catch {
    return null;
  }
  const bins = [];
  for (let p = 4 + n; p + 4 <= body.length; ) {
    const len = view.getUint32(p, true);
    bins.push(body.subarray(p + 4, Math.min(p + 4 + len, body.length)));
    p += 4 + len;
  }
  return { info, bins };
}

/** Foto karyawan (JPEG) yang dikirim mesin bersama data user, bukan saat absen; null bila tidak ada. */
export function userPhoto(body: Uint8Array) {
  const b = fkBody(body);
  const n = Number(/^BIN_(\d+)$/.exec(b?.info.user_photo ?? '')?.[1]);
  return (n && b?.bins[n - 1]) || null;
}

export type Enrolled = { fingers: number[]; password: boolean; card: boolean; face: boolean };

/** Yang terdaftar di mesin untuk user ini: nomor jari (0-9, urut), password (10), kartu (11), dan wajah (12). */
export function enrolled(body: Uint8Array): Enrolled {
  const list: number[] = (fkBody(body)?.info.enroll_data_array ?? []).map((e: { backup_number: number }) => e.backup_number);
  return { fingers: list.filter((n) => n <= 9).sort((a, b) => a - b), password: list.includes(10), card: list.includes(11), face: list.includes(12) };
}

/** "hh:mm" (atau "YYYY-MM-DD hh:mm:ss" mulai indeks `at`) -> menit */
export const minutes = (s: string, at = 0) => Number(s.slice(at, at + 2)) * 60 + Number(s.slice(at + 3, at + 5));
const DAY_MS = 86_400_000;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** Geser `n` bulan; tanggal yang tidak ada di bulan tujuan (31 Maret - 1 bulan) menjadi tanggal terakhirnya. */
export function addMonths(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
/** 0 = Minggu */
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export type RecapInput = {
  /** scan semua mesin ("YYYY-MM-DD hh:mm:ss"), plus correctionScans() */
  scans: Scan[];
  /** karyawan yang ikut rekap (juga yang tanpa scan: mereka alpa) */
  pins: string[];
  schedule: Schedule;
  holidays?: Holiday[];
  /** izin/sakit/cuti/dinas */
  leaves?: Leave[];
  /** YYYY-MM-DD, inklusif */
  from: string;
  to: string;
  /** YYYY-MM-DD; tanggal ini dan sesudahnya tidak dihitung */
  today: string;
  /** PIN -> tanggal pertama (mulai ada); hari sebelumnya tidak dihitung */
  starts?: Record<string, string>;
  /** PIN -> tanggal terakhir (dihapus dari mesin); hari sesudahnya tidak dihitung */
  ends?: Record<string, string>;
};

export function recap({ scans, pins, schedule, holidays = [], leaves = [], from, to, today, starts = {}, ends = {} }: RecapInput): RecapResult[] {
  const off = new Map(holidays.map((h) => [h.date, h.note ?? '']));
  const shiftOn = (_pin: string, date: string) => (off.has(date) ? null : schedule.days[weekday(date)]);
  const mine = new Set(pins);
  const carried = overnight(scans.filter((s) => mine.has(s.pin)), shiftOn);
  const times = new Map<string, number[]>(); // "pin tanggal" -> menit scan; pulang lewat tengah malam: menit + 1440 di hari masuknya
  const back = new Map<string, number>(); // "pin tanggal" -> menit pulang dari masuk kemarin (jam bebas lewat tengah malam)
  for (const s of scans) {
    const date = s.scan_date.slice(0, 10);
    const from = carried.get(`${s.pin} ${s.scan_date}`);
    const k = `${s.pin} ${from ?? date}`;
    if (!times.has(k)) times.set(k, []);
    times.get(k)!.push(minutes(s.scan_date, 11) + (from ? 1440 : 0));
    if (from) back.set(`${s.pin} ${date}`, minutes(s.scan_date, 11));
  }
  const dates: string[] = [];
  for (let d = from; d <= to && d < today; d = addDays(d, 1)) dates.push(d);
  return pins.map((pin) => {
    const days = dates
      .filter((date) => (!starts[pin] || date >= starts[pin]) && (!ends[pin] || date <= ends[pin]))
      .map((date) => {
        const leave = leaves.find((l) => l.pin === pin && l.from <= date && date <= l.to)?.kind;
        return day(date, times.get(`${pin} ${date}`) ?? [], shiftOn(pin, date), schedule, leave, off.get(date), back.get(`${pin} ${date}`));
      });
    return { pin, days, total: total(days) };
  });
}

/** `back` = menit pulang hari ini dari masuk kemarin (jam bebas lewat tengah malam), bila ada. */
function day(date: string, scans: number[], shift: Shift | null, s: Schedule, leave?: LeaveKind, holiday?: string, back?: number): RecapDay {
  const t = [...scans].sort((a, b) => a - b);
  const first = t[0];
  const gap = shift?.free ? 0 : s.minGap; // jam bebas: scan kedua sudah pulang
  const out = t.length > 1 && t.at(-1)! - first >= gap ? t.at(-1)! : null;
  const ot = s.overtime?.[weekday(date)] !== false; // tanggal libur kantor ikut sakelar hari itu
  const d: RecapDay = { date, work: !!shift, in: first ?? null, out, status: 'hadir', late: 0, early: 0, noOut: false, hours: 0, overtime: 0, note: holiday ?? '' };
  if (first !== undefined && out !== null) d.hours = out - first;
  if (first === undefined && back != null) d.out = back; // hanya pulang dari masuk kemarin; jamnya dihitung di hari masuk
  if (!shift) {
    // libur: tanpa scan = libur; masuk dan pulang = seluruh jam kerja jadi lembur hari libur
    d.status = 'libur';
    d.overtime = ot ? d.hours : 0;
  } else if (leave) {
    d.status = leave; // bukan alpa walau ada scan
    d.hours = 0;
  } else if (first === undefined) {
    if (back == null) d.status = 'alpa'; // ada pulang dari masuk kemarin: hadir
  } else if (shift.free) {
    d.noOut = out === null; // jam bebas: tidak ada terlambat, pulang cepat, atau lembur
  } else {
    const start = minutes(shift.start);
    const end = minutes(shift.end);
    if (first > start + s.tolerance) d.late = first - start;
    if (out === null) d.noOut = true;
    else {
      if (out < end) d.early = end - out;
      if (ot && out - end >= s.overtimeMin) d.overtime = out - end;
    }
  }
  const max = s.overtimeMax?.[weekday(date)];
  if (max) d.overtime = Math.min(d.overtime, max);
  return d;
}

function total(days: RecapDay[]): RecapTotal {
  const t: RecapTotal = { workDays: 0, present: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, noOut: 0, absent: 0, hours: 0, overtime: 0, izin: 0, sakit: 0, cuti: 0, dinas: 0 };
  for (const d of days) {
    t.workDays += Number(d.work);
    t.present += Number(d.work && d.status === 'hadir');
    t.absent += Number(d.status === 'alpa');
    if (LEAVE_KINDS.includes(d.status as LeaveKind)) t[d.status as LeaveKind]++;
    t.late += Number(d.late > 0);
    t.lateMin += d.late;
    t.early += Number(d.early > 0);
    t.earlyMin += d.early;
    t.noOut += Number(d.noOut);
    t.hours += d.hours;
    t.overtime += d.overtime;
  }
  return t;
}
