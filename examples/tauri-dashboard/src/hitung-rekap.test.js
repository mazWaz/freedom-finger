// Uji aturan rekap (PRD Feature 7, Recap rules): npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SCHEDULE, recap } from './hitung-rekap.js';

// 2026-09-01 = Selasa
const run = (scans, o = {}) =>
  recap({ scans: scans.map(([pin, scan_date]) => ({ pin, scan_date })), pins: ['1'], schedule: DEFAULT_SCHEDULE,
    from: '2026-09-01', to: '2026-09-01', today: '2026-09-30', ...o });
const day = (times, o) => run(times.map((t) => ['1', `${o?.from ?? '2026-09-01'} ${t}`]), o)[0].days[0];
const hm = (h, m) => h * 60 + m;

test('masuk = scan pertama, pulang = scan terakhir, urutan kiriman tidak berpengaruh', () => {
  const d = day(['12:00:00', '07:55:10', '17:05:00']);
  assert.deepEqual([d.in, d.out, d.status, d.hours, d.late, d.early], [hm(7, 55), hm(17, 5), 'hadir', hm(9, 10), 0, 0]);
});

test('scan berdekatan = scan ganda: lupa absen pulang, jam kerja tidak dihitung', () => {
  const d = day(['08:00:00', '08:40:00']);
  assert.deepEqual([d.out, d.noOut, d.hours, d.status], [null, true, 0, 'hadir']);
});

test('terlambat lewat toleransi, menitnya dari jam masuk; detik diabaikan', () => {
  assert.equal(day(['08:10:00', '17:00:00']).late, 0);
  assert.equal(day(['08:15:59', '17:00:00']).late, 0);
  assert.equal(day(['08:16:00', '17:00:00']).late, 16);
  assert.equal(day(['08:20:00', '17:00:00']).late, 20);
});

test('pulang cepat dari jam pulang; lembur di bawah batas = 0', () => {
  assert.deepEqual([day(['08:00', '16:30']).early, day(['08:00', '16:30']).overtime], [30, 0]);
  assert.deepEqual([day(['08:00', '17:59']).early, day(['08:00', '17:59']).overtime], [0, 0]);
  assert.equal(day(['08:00', '18:00']).overtime, 60);
  assert.equal(day(['08:00', '19:30']).overtime, 150);
});

test('lembur bisa dimatikan: hari kerja dan hari libur tanpa lembur, jam kerja tetap', () => {
  const schedule = { ...DEFAULT_SCHEDULE, overtimeOn: false };
  const kerja = day(['08:00', '19:30'], { schedule });
  assert.deepEqual([kerja.overtime, kerja.hours], [0, 690]);
  const minggu = day(['08:00', '12:00'], { schedule, from: '2026-09-06', to: '2026-09-06' });
  assert.deepEqual([minggu.overtime, minggu.hours], [0, 240]);
});

test('hari libur: tanpa scan = libur; masuk dan pulang = seluruh jam jadi lembur', () => {
  const sabtu = day([], { from: '2026-09-05', to: '2026-09-05' });
  assert.deepEqual([sabtu.status, sabtu.work, sabtu.hours], ['libur', false, 0]);
  const minggu = day(['08:00', '12:00'], { from: '2026-09-06', to: '2026-09-06' });
  assert.deepEqual([minggu.status, minggu.hours, minggu.overtime, minggu.late], ['libur', 240, 240, 0]);
  const libur = day(['09:00'], { holidays: [{ date: '2026-09-01', note: 'Libur kantor' }] });
  assert.deepEqual([libur.status, libur.note, libur.noOut, libur.work], ['libur', 'Libur kantor', false, false]);
});

test('pulang tepat pada jarak minimal dihitung pulang', () => {
  assert.deepEqual([day(['08:00', '09:00']).out, day(['08:00', '08:59']).out], [hm(9, 0), null]);
});

test('izin/sakit/cuti/dinas bukan alpa, walau ada scan; hari libur di dalam cuti tetap libur', () => {
  const leaves = [{ pin: '1', from: '2026-09-01', to: '2026-09-02', kind: 'sakit' }];
  const [r] = run([['1', '2026-09-01 08:30:00']], { leaves, to: '2026-09-03' });
  assert.deepEqual(r.days.map((d) => d.status), ['sakit', 'sakit', 'alpa']);
  assert.deepEqual([r.total.sakit, r.total.absent, r.total.late], [2, 1, 0]);
  const cuti = [{ pin: '1', from: '2026-09-04', to: '2026-09-07', kind: 'cuti' }]; // Jumat–Senin
  const [c] = run([], { leaves: cuti, from: '2026-09-04', to: '2026-09-07' });
  assert.deepEqual(c.days.map((d) => d.status), ['cuti', 'libur', 'libur', 'cuti']);
  assert.equal(c.total.cuti, 2);
});

test('hari ini dan sesudahnya belum dihitung', () => {
  const [r] = run([], { to: '2026-09-30', today: '2026-09-03' });
  assert.deepEqual(r.days.map((d) => d.date), ['2026-09-01', '2026-09-02']);
  assert.equal(r.total.absent, 2);
});

test('ringkasan satu minggu, karyawan tanpa scan tetap muncul', () => {
  const scans = [
    ['1', '2026-09-01 08:00:00'], ['1', '2026-09-01 17:00:00'], // tepat
    ['1', '2026-09-02 08:20:00'], ['1', '2026-09-02 17:00:00'], // terlambat 20
    ['1', '2026-09-03 08:00:00'], // lupa pulang; 09-04 alpa; 09-05 dan 09-06 libur
    ['1', '2026-09-07 08:00:00'], ['1', '2026-09-07 18:30:00'], // lembur 90
  ];
  const [a, b] = run(scans, { pins: ['1', '2'], to: '2026-09-07', today: '2026-09-08' });
  assert.deepEqual(a.total, {
    workDays: 5, present: 4, late: 1, lateMin: 20, early: 0, earlyMin: 0, noOut: 1, absent: 1,
    hours: 540 + 520 + 630, overtime: 90, izin: 0, sakit: 0, cuti: 0, dinas: 0,
  });
  assert.deepEqual([b.pin, b.total.absent, b.total.present, b.days.length], ['2', 5, 0, 7]);
});
