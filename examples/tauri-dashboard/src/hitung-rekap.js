// Rekap absensi: fungsi murni tanpa DOM atau API, supaya bisa diuji (`node --test`) dan dipakai
// aplikasi lain. Aturannya sama dengan PRD Feature 7, bagian Recap rules:
// - tombol Masuk/Pulang di mesin diabaikan; scan pertama hari itu = masuk
// - scan terakhir = pulang, bila berjarak minimal `minGap` menit dari masuk (lebih dekat = scan ganda)
// - menit terlambat dihitung dari jam masuk, bukan dari akhir toleransi
// - hari ini dan sesudahnya belum dihitung
// Semua jam dalam menit sejak 00:00; detik diabaikan.

/** Nilai awal sampai aturan kantor diisi: Senin–Jumat 08:00–17:00. `days[0]` = Minggu; `null` = libur. */
export const DEFAULT_SCHEDULE = {
  days: [null, ...Array.from({ length: 5 }, () => ({ start: '08:00', end: '17:00' })), null],
  tolerance: 15, // menit terlambat yang masih tepat waktu
  overtimeOn: true, // false = lembur tidak dihitung sama sekali
  overtimeMin: 60, // lembur di bawah ini dihitung 0
  minGap: 60, // jarak minimal masuk–pulang
};

export const LEAVE_KINDS = ['izin', 'sakit', 'cuti', 'dinas'];

/** Koreksi absen `{pin, date, time: "hh:mm", reason}` di rentang -> scan untuk recap(), bertanda `manual`. */
export const correctionScans = (corrections, from, to) => corrections
  .filter((c) => from <= c.date && c.date <= to)
  .map((c) => ({ pin: c.pin, scan_date: `${c.date} ${c.time}:00`, manual: true, reason: c.reason }));

/** "hh:mm" (atau "YYYY-MM-DD hh:mm:ss" mulai indeks `at`) -> menit */
export const minutes = (s, at = 0) => Number(s.slice(at, at + 2)) * 60 + Number(s.slice(at + 3, at + 5));
const DAY_MS = 86_400_000;
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** Geser `n` bulan; tanggal yang tidak ada di bulan tujuan (31 Maret - 1 bulan) menjadi tanggal terakhirnya. */
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
/** 0 = Minggu */
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * @param {object} o
 * @param {{pin: string, scan_date: string}[]} o.scans  scan semua mesin ("YYYY-MM-DD hh:mm:ss"), plus correctionScans()
 * @param {string[]} o.pins  karyawan yang ikut rekap (juga yang tanpa scan: mereka alpa)
 * @param {typeof DEFAULT_SCHEDULE} o.schedule
 * @param {{date: string, note?: string}[]} [o.holidays]
 * @param {{pin: string, from: string, to: string, kind: string}[]} [o.leaves]  izin/sakit/cuti/dinas
 * @param {string} o.from  YYYY-MM-DD, inklusif
 * @param {string} o.to  YYYY-MM-DD, inklusif
 * @param {string} o.today  YYYY-MM-DD; tanggal ini dan sesudahnya tidak dihitung
 */
export function recap({ scans, pins, schedule, holidays = [], leaves = [], from, to, today }) {
  const times = new Map(); // "pin tanggal" -> menit scan
  for (const s of scans) {
    const k = `${s.pin} ${s.scan_date.slice(0, 10)}`;
    if (!times.has(k)) times.set(k, []);
    times.get(k).push(minutes(s.scan_date, 11));
  }
  const off = new Map(holidays.map((h) => [h.date, h.note ?? '']));
  const dates = [];
  for (let d = from; d <= to && d < today; d = addDays(d, 1)) dates.push(d);
  return pins.map((pin) => {
    const days = dates.map((date) => {
      const leave = leaves.find((l) => l.pin === pin && l.from <= date && date <= l.to)?.kind;
      return day(date, times.get(`${pin} ${date}`) ?? [], off.has(date) ? null : schedule.days[weekday(date)], schedule, leave, off.get(date));
    });
    return { pin, days, total: total(days) };
  });
}

function day(date, scans, shift, s, leave, holiday) {
  const t = [...scans].sort((a, b) => a - b);
  const first = t[0];
  const out = t.length > 1 && t.at(-1) - first >= s.minGap ? t.at(-1) : null;
  const d = { date, work: !!shift, in: first ?? null, out, status: 'hadir', late: 0, early: 0, noOut: false, hours: 0, overtime: 0, note: holiday ?? '' };
  if (first !== undefined && out !== null) d.hours = out - first;
  if (!shift) {
    // libur: tanpa scan = libur; masuk dan pulang = seluruh jam kerja jadi lembur hari libur
    d.status = 'libur';
    d.overtime = s.overtimeOn === false ? 0 : d.hours;
  } else if (leave) {
    d.status = leave; // bukan alpa walau ada scan
    d.hours = 0;
  } else if (first === undefined) {
    d.status = 'alpa';
  } else {
    const start = minutes(shift.start);
    const end = minutes(shift.end);
    if (first > start + s.tolerance) d.late = first - start;
    if (out === null) d.noOut = true;
    else {
      if (out < end) d.early = end - out;
      if (s.overtimeOn !== false && out - end >= s.overtimeMin) d.overtime = out - end;
    }
  }
  return d;
}

function total(days) {
  const t = { workDays: 0, present: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, noOut: 0, absent: 0, hours: 0, overtime: 0 };
  for (const k of LEAVE_KINDS) t[k] = 0;
  for (const d of days) {
    t.workDays += d.work;
    t.present += d.work && d.status === 'hadir';
    t.absent += d.status === 'alpa';
    if (LEAVE_KINDS.includes(d.status)) t[d.status]++;
    t.late += d.late > 0;
    t.lateMin += d.late;
    t.early += d.early > 0;
    t.earlyMin += d.early;
    t.noOut += d.noOut;
    t.hours += d.hours;
    t.overtime += d.overtime;
  }
  return t;
}
