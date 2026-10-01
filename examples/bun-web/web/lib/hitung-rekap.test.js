// Uji aturan rekap (PRD Feature 7, Recap rules): bun test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SCHEDULE, addMonths, correctionScans, enrolled, recap, scanRoles, userPhoto } from './hitung-rekap.js';

// 2026-09-01 = Selasa
const run = (scans, o = {}) =>
  recap({ scans: scans.map(([pin, scan_date]) => ({ pin, scan_date })), pins: ['1'], schedule: DEFAULT_SCHEDULE,
    from: '2026-09-01', to: '2026-09-01', today: '2026-09-30', ...o });
const day = (times, o) => run(times.map((t) => ['1', `${o?.from ?? '2026-09-01'} ${t}`]), o)[0].days[0];
const hm = (h, m) => h * 60 + m;
/** Body FkWeb: u32 LE panjang | JSON+NUL | [u32 LE panjang | biner]... */
const body = (json, ...bins) => {
  const text = new TextEncoder().encode(`${JSON.stringify(json)}\0`);
  const parts = [text, ...bins].flatMap((b) => [new Uint8Array(new Uint32Array([b.length]).buffer), b]);
  return new Uint8Array(parts.flatMap((b) => [...b]));
};

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
  const schedule = { ...DEFAULT_SCHEDULE, overtime: Array(7).fill(false) };
  const kerja = day(['08:00', '19:30'], { schedule });
  assert.deepEqual([kerja.overtime, kerja.hours], [0, 690]);
  const minggu = day(['08:00', '12:00'], { schedule, from: '2026-09-06', to: '2026-09-06' });
  assert.deepEqual([minggu.overtime, minggu.hours], [0, 240]);
});

test('lembur per hari: hanya hari yang sakelarnya aktif; hari libur dan tanggal libur ikut sakelar harinya', () => {
  const overtime = Array(7).fill(true);
  overtime[2] = false; // Selasa
  overtime[6] = false; // Sabtu
  const schedule = { ...DEFAULT_SCHEDULE, overtime };
  assert.equal(day(['08:00', '19:30'], { schedule }).overtime, 0); // Selasa 1 September
  assert.equal(day(['08:00', '19:30'], { schedule, from: '2026-09-02', to: '2026-09-02' }).overtime, 150); // Rabu
  assert.equal(day(['08:00', '12:00'], { schedule, from: '2026-09-05', to: '2026-09-05' }).overtime, 0); // Sabtu, libur
  assert.equal(day(['08:00', '12:00'], { schedule, from: '2026-09-06', to: '2026-09-06' }).overtime, 240); // Minggu, libur
  const kantor = [{ date: '2026-09-02', note: 'Libur kantor' }]; // Rabu: lembur aktif, seluruh jam jadi lembur
  assert.deepEqual(['status', 'overtime'].map((k) => day(['08:00', '12:00'], { schedule, holidays: kantor, from: '2026-09-02', to: '2026-09-02' })[k]), ['libur', 240]);
});

test('lembur maksimal per hari: lembur dipotong, jam kerja tidak; 0 = tanpa batas', () => {
  const overtimeMax = Array(7).fill(0);
  overtimeMax[2] = 120; // Selasa
  overtimeMax[0] = 120; // Minggu
  const schedule = { ...DEFAULT_SCHEDULE, overtimeMax };
  const kerja = day(['08:00', '20:30'], { schedule }); // Selasa 1 September
  assert.deepEqual([kerja.overtime, kerja.hours], [120, 750]);
  assert.equal(day(['08:00', '18:30'], { schedule }).overtime, 90); // di bawah batas: utuh
  assert.equal(day(['08:00', '20:30'], { schedule, from: '2026-09-02', to: '2026-09-02' }).overtime, 210); // Rabu: tanpa batas
  assert.equal(day(['08:00', '15:00'], { schedule, from: '2026-09-06', to: '2026-09-06' }).overtime, 120); // Minggu, libur
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

test('koreksi manual dihitung sebagai scan: lupa absen pulang menjadi pulang; di luar rentang diabaikan', () => {
  const corrections = [
    { pin: '1', date: '2026-09-01', time: '17:30', reason: 'lupa absen pulang' },
    { pin: '1', date: '2026-09-02', time: '08:00', reason: 'di luar rentang' },
  ];
  assert.equal(day(['08:05:00']).noOut, true);
  const extra = correctionScans(corrections, '2026-09-01', '2026-09-01');
  assert.equal(extra.length, 1);
  const [r] = run([['1', '2026-09-01 08:05:00']].concat(extra.map((s) => [s.pin, s.scan_date])));
  assert.deepEqual([r.days[0].out, r.days[0].noOut, r.days[0].hours], [hm(17, 30), false, hm(9, 25)]);
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

test('geser bulan: tanggal akhir bulan menyesuaikan, lintas tahun', () => {
  assert.equal(addMonths('2026-09-30', -1), '2026-08-30');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2024-03-31', -1), '2024-02-29');
  assert.equal(addMonths('2026-01-15', -2), '2025-11-15');
  assert.equal(addMonths('2026-12-01', 1), '2027-01-01');
});

test('arti scan menurut aturan rekap, bukan tombol mesin: datang 07:59 = Masuk', () => {
  const r = scanRoles([
    { pin: '8', scan_date: '2026-09-30 07:59:23' }, // mesin mencatat "Pulang" karena sebelum 09:00
    { pin: '6', scan_date: '2026-09-30 18:31:00' },
    { pin: '6', scan_date: '2026-09-30 10:04:00' },
    { pin: '6', scan_date: '2026-09-30 10:05:00' }, // scan ganda: tidak dihitung
    { pin: '5', scan_date: '2026-09-30 10:00:00' },
    { pin: '5', scan_date: '2026-09-30 10:30:00' }, // kurang dari jarak minimal: bukan pulang
  ], 60, () => ({ start: '08:00', end: '17:00' }));
  assert.equal(r.get('8 2026-09-30 07:59:23'), 'Masuk');
  assert.equal(r.get('6 2026-09-30 10:04:00'), 'Masuk');
  assert.equal(r.get('6 2026-09-30 10:05:00'), undefined);
  assert.equal(r.get('6 2026-09-30 18:31:00'), 'Pulang');
  assert.equal(r.get('5 2026-09-30 10:30:00'), undefined);
});

test('foto karyawan dari body FkWeb: biner yang dirujuk user_photo, null bila tidak ada', () => {
  const jari = new Uint8Array(800).fill(7);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
  const withPhoto = body({ user_id: '12', user_photo: 'BIN_2', enroll_data_array: [{ backup_number: 0, enroll_data: 'BIN_1' }] }, jari, jpg);
  assert.deepEqual([...userPhoto(withPhoto)], [...jpg]);
  assert.equal(userPhoto(body({ user_id: '8', enroll_data_array: [{ backup_number: 0, enroll_data: 'BIN_1' }] }, jari)), null);
  assert.equal(userPhoto(new Uint8Array([1, 2])), null);
  assert.equal(userPhoto(new Uint8Array([255, 255, 0, 0, 1])), null); // panjang JSON melebihi isi
  // jari dan wajah yang terdaftar
  const wajah = new Uint8Array(20).fill(9);
  assert.deepEqual(enrolled(body({ enroll_data_array: [{ backup_number: 12, enroll_data: 'BIN_2' }, { backup_number: 3, enroll_data: 'BIN_1' },
    { backup_number: 0, enroll_data: 'BIN_3' }] }, jari, wajah, jari)), { fingers: [0, 3], password: false, card: false, face: true });
  const none = { fingers: [], password: false, card: false, face: false };
  assert.deepEqual(enrolled(body({ enroll_data_array: null })), none);
  assert.deepEqual(enrolled(new Uint8Array(0)), none);
});

test('password dan kartu yang terdaftar: biner ASCII tanpa NUL, seperti PIN 5 di mesin asli', () => {
  const [jari, wajah, none] = [new Uint8Array(800), new Uint8Array(20), { fingers: [], password: false, card: false, face: false }];
  const ascii = (t) => new TextEncoder().encode(t);
  assert.deepEqual(enrolled(body({ enroll_data_array: [{ backup_number: 0, enroll_data: 'BIN_1' }, { backup_number: 10, enroll_data: 'BIN_2' },
    { backup_number: 12, enroll_data: 'BIN_3' }] }, jari, ascii('123'), wajah)), { fingers: [0], password: true, card: false, face: true });
  assert.deepEqual(enrolled(body({ enroll_data_array: [{ backup_number: 11, enroll_data: 'BIN_1' }] }, ascii('0012345678'))),
    { ...none, card: true });
});

test('karyawan baru: hari sebelum mulai tidak dihitung (bukan alpa)', () => {
  const r = run([['1', '2026-09-03 08:00'], ['1', '2026-09-03 17:00']], { from: '2026-09-01', to: '2026-09-04', starts: { 1: '2026-09-03' } })[0];
  assert.deepEqual(r.days.map((d) => d.date), ['2026-09-03', '2026-09-04']);
  assert.equal(r.total.absent, 1); // 4 September: sudah mulai, tidak scan
  assert.equal(r.total.workDays, 2);
});

test('karyawan yang dihapus dari mesin: hari sesudah tanggal hapus tidak dihitung (bukan alpa)', () => {
  const r = run([['1', '2026-09-01 08:00'], ['1', '2026-09-01 17:00']], { from: '2026-09-01', to: '2026-09-04', ends: { 1: '2026-09-02' } })[0];
  assert.deepEqual(r.days.map((d) => d.date), ['2026-09-01', '2026-09-02']);
  assert.equal(r.total.absent, 1); // 2 September: masih karyawan, tidak scan
});

test('jam bebas: hadir bila scan, tanpa scan = alpa; tidak ada terlambat, pulang cepat, atau lembur', () => {
  const schedule = { ...DEFAULT_SCHEDULE, days: Array(7).fill({ free: true }) };
  const d = day(['11:40', '23:00'], { schedule });
  assert.deepEqual([d.status, d.late, d.early, d.overtime, d.hours, d.noOut], ['hadir', 0, 0, 0, hm(11, 20), false]);
  assert.equal(day(['13:00'], { schedule }).noOut, true);
  assert.equal(day([], { schedule }).status, 'alpa');
});

test('jam bebas: scan kedua sudah pulang walau dekat; satu scan tetap tanpa pulang', () => {
  const schedule = { ...DEFAULT_SCHEDULE, days: Array(7).fill({ free: true }) };
  const d = day(['13:15', '13:19', '14:21'], { schedule });
  assert.deepEqual([d.in, d.out, d.hours, d.noOut], [hm(13, 15), hm(14, 21), 66, false]);
  assert.equal(day(['16:50', '17:10'], { schedule }).out, hm(17, 10)); // 20 menit: hari biasa = scan ganda
  assert.equal(day(['16:50', '17:10']).out, null);
  assert.equal(day(['16:50'], { schedule }).noOut, true);
  const r = scanRoles([{ pin: '2', scan_date: '2026-09-30 16:50:14' }, { pin: '2', scan_date: '2026-09-30 17:10:00' },
    { pin: '3', scan_date: '2026-09-30 16:50:00' }], 60, () => ({ free: true }));
  assert.equal(r.get('2 2026-09-30 17:10:00'), 'Pulang');
  assert.equal(r.get('3 2026-09-30 16:50:00'), 'Masuk'); // satu scan: tetap Masuk walau jarak minimal 0
});

test('jam bebas lewat tengah malam: scan berikutnya dalam 24 jam = pulang hari masuk', () => {
  const schedule = { ...DEFAULT_SCHEDULE, days: Array(7).fill({ free: true }) };
  const o = { schedule, from: '2026-09-30', to: '2026-10-02', today: '2026-10-03' };
  const [a, b, c] = run([['1', '2026-09-30 16:50'], ['1', '2026-10-01 11:40'], ['1', '2026-10-02 01:55']], o)[0].days;
  assert.deepEqual([a.in, a.out, a.hours, a.noOut], [hm(16, 50), 1440 + hm(11, 40), hm(18, 50), false]);
  assert.deepEqual([b.status, b.in, b.out, b.hours, b.noOut], ['hadir', null, hm(11, 40), 0, false]); // hanya pulang dari kemarin
  assert.deepEqual([c.in, c.out, c.noOut], [hm(1, 55), null, true]);
  // lebih dari 24 jam: tetap lupa pulang, scan berikutnya masuk hari itu
  const far = run([['1', '2026-09-30 10:00'], ['1', '2026-10-01 10:01']], o)[0].days;
  assert.deepEqual([far[0].noOut, far[1].in], [true, hm(10, 1)]);
  // dua scan di hari masuk: sudah pulang, scan besoknya masuk baru
  const closed = run([['1', '2026-09-30 10:00'], ['1', '2026-09-30 12:00'], ['1', '2026-10-01 08:00']], o)[0].days;
  assert.deepEqual([closed[0].out, closed[1].in], [hm(12, 0), hm(8, 0)]);
  // besoknya hari kerja berjam (Kamis 08:00-17:00): scannya tetap masuk hari itu
  const mixed = { ...DEFAULT_SCHEDULE, days: DEFAULT_SCHEDULE.days.map((d, i) => (i === 3 ? { free: true } : d)) };
  const [rabu, kamis] = run([['1', '2026-09-30 16:50'], ['1', '2026-10-01 07:55']], { ...o, schedule: mixed })[0].days;
  assert.deepEqual([rabu.noOut, kamis.in, kamis.status], [true, hm(7, 55), 'hadir']);
  const r = scanRoles([{ pin: '1', scan_date: '2026-09-30 16:50:00' }, { pin: '1', scan_date: '2026-10-01 11:40:00' },
    { pin: '1', scan_date: '2026-10-02 01:55:00' }], 60, () => ({ free: true }));
  assert.deepEqual(['2026-09-30 16:50:00', '2026-10-01 11:40:00', '2026-10-02 01:55:00'].map((t) => r.get(`1 ${t}`)), ['Masuk', 'Pulang', 'Masuk']);
});
