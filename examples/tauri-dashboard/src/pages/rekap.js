// Tab Rekap: satu baris per karyawan untuk satu bulan (atau rentang), klik untuk rincian per hari.
// Hitungannya di hitung-rekap.js; tab ini hanya mengambil scan, menampilkan, dan meng-export.
import { firstScans, logs } from '../lib/api.js';
import { byPin, data, deptOf, inRecap, isRemoved, knownPins, nameOf, scheduleName, scheduleOf } from '../lib/data.js';
import { exportCsv, exportXlsx, print, reportTitle } from '../lib/export.js';
import { dayName, dmy, duration, hhmm, lastMonths, longDate, monthName, monthRange, today } from '../lib/format.js';
import { LEAVE_KINDS, LOOKBACK_DAYS, addDays, correctionScans, recap } from '../lib/hitung-rekap.js';
import { $, esc } from '../lib/ui.js';
import { openForm } from './izin.js';
import { CalendarClock, Clock, createElement } from 'lucide';

// ikon keterangan: jam = sama dengan menu Jam kerja, tempat aturannya diubah
const ICON_COUNTED = createElement(CalendarClock).outerHTML;
const ICON_RULES = createElement(Clock).outerHTML;

export const LABEL = { hadir: 'Hadir', alpa: 'Alpa', libur: 'Libur', izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti', dinas: 'Dinas luar' };

let scans = [];
let loaded = ''; // rentang yang scan-nya sudah diambil
let seq = 0; // hanya jawaban permintaan terakhir yang dipakai
let result = []; // hasil recap()
let detail = null; // PIN yang rinciannya dibuka

export function init() {
  $('k-bulan').innerHTML = `${lastMonths(13).map((ym) => `<option value="${ym}">${monthName(ym)}</option>`).join('')}` +
    '<option value="custom">Pilih tanggal</option>';
  const setMonth = () => ([$('k-dari').value, $('k-sampai').value] = monthRange($('k-bulan').value));
  $('k-bulan').onchange = () => {
    if ($('k-bulan').value === 'custom') return;
    setMonth();
    show('open');
  };
  $('k-dari').onchange = () => { // rentang (tanggal.js): sekali, di input dari
    $('k-bulan').value = 'custom';
    show('open');
  };
  const open = (e) => {
    const tr = e.target.closest('tr[data-pin]');
    if (tr && (e.type === 'click' || e.key === 'Enter')) {
      detail = tr.dataset.pin;
      render();
      $('k-kembali').focus();
    }
  };
  $('k-daftar').onclick = $('k-daftar').onkeydown = open;
  $('k-kembali').onclick = () => {
    detail = null;
    render();
  };
  // hari alpa atau lupa pulang: koreksi/izin langsung dari rincian, nama dan tanggal sudah terisi
  $('k-hari').onclick = (e) => {
    const b = e.target.closest('button[data-aksi]');
    if (!b) return;
    if (b.dataset.aksi === 'koreksi') openForm('corrections', { pin: detail, date: b.dataset.date });
    else openForm('leaves', { pin: detail, from: b.dataset.date });
  };
  $('k-info').onclick = (e) => e.target.closest('button[data-ke]') && $(`tab-${e.target.closest('button').dataset.ke}`).click();
  $('k-xlsx').onclick = () => exportXlsx(`${file()}.xlsx`, [summary(), days()]);
  $('k-csv').onclick = () => exportCsv(`${file()}${detail ? `-pin-${detail}` : ''}.csv`, detail ? days(detail) : summary());
  $('k-cetak').onclick = () => print($('k-judul'), (detail ? days(detail) : summary()).title);
  setMonth();
}

const file = () => `rekap-absen-${$('k-dari').value}_${$('k-sampai').value}`;

export async function show(reason) {
  const [from, to] = [$('k-dari').value, $('k-sampai').value];
  if (reason === 'open' || reason === 'logs' || loaded !== `${from} ${to}`) {
    const my = ++seq;
    // ditambah tepinya: masuk jam bebas sebelum rentang yang pulangnya di rentang, dan pulang sehari sesudahnya
    const list = from && to && from <= to ? await logs(addDays(from, -LOOKBACK_DAYS), addDays(to, 1)) : [];
    if (my !== seq) return;
    scans = list;
    loaded = `${from} ${to}`;
  }
  const all = [...scans, ...correctionScans(data.corrections, addDays(from, -LOOKBACK_DAYS), addDays(to, 1))]; // koreksi manual dihitung sebagai scan
  // karyawan yang dikenal ditambah PIN yang punya scan, kecuali yang tidak ikut rekap
  const pins = [...new Set([...knownPins(), ...all.filter((s) => from <= s.scan_date && s.scan_date.slice(0, 10) <= to).map((s) => s.pin)])]
    .filter(inRecap).sort(byPin);
  result = !(from && to) ? [] : recapAll(all, pins, from, to).sort((a, b) => byPin(a.pin, b.pin));
  render();
}

/**
 * recap() untuk banyak karyawan: satu hitungan per jadwal (utama dan jadwal lain), aturan toleransi/lembur
 * sama. `until` = tanggal pertama yang belum dihitung (bawaan hari ini). Dipakai juga oleh Riwayat.
 */
export function recapAll(scans, pins, from, to, until = today()) {
  const groups = new Map();
  for (const pin of pins) {
    const s = scheduleOf(pin) ?? data.schedule;
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(pin);
  }
  // karyawan yang dihapus dari mesin: dihitung sampai tanggal hapus
  const ends = Object.fromEntries(pins.filter(isRemoved).map((pin) => [pin, data.employees[pin].removed.slice(0, 10)]));
  // karyawan baru: dihitung mulai hari pertama ada (scan pertama, ditambahkan lewat aplikasi, izin, atau koreksi);
  // tanpa satu pun = belum mulai. Scan di rentang ini ikut dihitung, supaya scan pertama yang baru masuk tidak terlewat
  const firstInRange = new Map();
  for (const s of scans) if (!(firstInRange.get(s.pin) <= s.scan_date)) firstInRange.set(s.pin, s.scan_date.slice(0, 10));
  const starts = !firstScans ? {} : Object.fromEntries(pins.map((pin) => [pin, [firstScans.get(pin), firstInRange.get(pin), data.employees[pin]?.added,
    ...data.corrections.filter((c) => c.pin === pin).map((c) => c.date), ...data.leaves.filter((l) => l.pin === pin).map((l) => l.from)]
    .filter(Boolean).sort()[0] ?? '9999-12-31']));
  return [...groups].flatMap(([s, ps]) => recap({ scans, pins: ps, schedule: { ...data.schedule, days: s.days, overtime: s.overtime, overtimeMax: s.overtimeMax }, holidays: data.holidays,
    leaves: data.leaves, from, to, today: until, starts, ends }));
}

/** Berapa kali, dengan total jam:menit di bawahnya. */
const times = (n, min) => (n ? `<span class="dua">${n}×<small>${duration(min)}</small></span>` : '');
const leaveDays = (t) => t.izin + t.sakit + t.cuti + t.dinas;

/** Strip bulan: satu batang per hari seperti lubang kartu absen; hari yang belum dihitung berupa garis. */
const STRIP_MAX_DAYS = 62;
function strip(r, from, to) {
  if (addDays(from, STRIP_MAX_DAYS) <= to) return '';
  const byDate = new Map(r.days.map((d) => [d.date, d]));
  const bars = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const d = byDate.get(date);
    const kind = !d ? 'nanti' : d.status === 'hadir' ? (d.late ? 'telat' : 'hadir') : LEAVE_KINDS.includes(d.status) ? 'izin' : d.status;
    const what = !d ? 'belum dihitung' : `${LABEL[d.status]}${d.late ? `, terlambat ${d.late} menit` : ''}`;
    bars.push(`<i class="${kind}" title="${dayName(date).slice(0, 3)} ${dmy(date)}: ${what}"></i>`);
  }
  return `<span class="strip">${bars.join('')}</span>`;
}
/** Keterangan hari: libur, catatan izin, koreksi manual beserta alasannya, dan temuan rekap. */
function note(d, pin) {
  const leave = LEAVE_KINDS.includes(d.status) && data.leaves.find((l) => l.pin === pin && l.from <= d.date && d.date <= l.to)?.note;
  return [
    d.note,
    leave,
    ...data.corrections.filter((c) => c.pin === pin && c.date === d.date).sort((a, b) => a.time.localeCompare(b.time))
      .map((c) => `Manual ${c.time}: ${c.reason}`),
    d.noOut && 'Lupa absen pulang',
    d.out >= 1440 && 'Pulang besoknya (jam bebas)',
    d.in == null && d.out != null && 'Pulang dari masuk kemarin (jam bebas)',
    d.status === 'libur' && d.in != null && d.out == null && 'Scan di hari libur tanpa pulang',
    d.status === 'libur' && d.overtime && 'Lembur hari libur',
  ].filter(Boolean).join('; ');
}

function render() {
  const [from, to] = [$('k-dari').value, $('k-sampai').value];
  const s = data.schedule;
  const now = today();
  const last = [to, addDays(now, -1)].sort()[0];
  // dua kalimat: sampai kapan dihitung (hanya bila periode belum lewat semua), lalu aturan yang dipakai
  const pending = to === now ? 'Hari ini baru dihitung besok.' : 'Hari ini dan seterusnya belum dihitung.';
  const counted = from > last ? (from === now ? pending : 'Periode ini belum dimulai.')
    : last < to ? `Dihitung sampai kemarin, <b>${longDate(last)}</b>. ${pending}` : '';
  const late = s.tolerance ? `Terlambat bila masuk lebih dari <b>${s.tolerance} menit</b> setelah jam masuk.` : 'Terlambat bila masuk setelah jam masuk.';
  const overtime = !anyOvertime() ? 'Lembur <b>tidak dihitung</b>.'
    : `Lembur dihitung mulai <b>${s.overtimeMin} menit</b> setelah jam pulang, di hari yang lemburnya aktif.`;
  $('k-info').innerHTML = `${counted && `<p>${ICON_COUNTED}<span>${counted}</span></p>`}` +
    `<p>${ICON_RULES}<span>${late} ${overtime}</span><button data-ke="jam-kerja">Ubah aturan rekap</button></p>`;
  $('rekap').classList.toggle('tanpa-lembur', !anyOvertime());
  const r = detail && result.find((x) => x.pin === detail);
  if (detail && !r) detail = null;
  $('k-ringkasan').hidden = !!r;
  $('k-rincian').hidden = !r;
  if (!r) {
    $('k-daftar').innerHTML = result
      .map((r) => [r, r.pin, r.total])
      .map(([r, pin, t]) => `<tr data-pin="${esc(pin)}" tabindex="0" class="klik" title="Lihat rincian per hari">` +
        `<td><span class="nama-rekap">${esc(nameOf(pin))}${deptOf(pin) ? `<small>${esc(deptOf(pin))}</small>` : ''}</span>${strip(r, from, to)}</td>` +
        `<td class="num">${t.present}<small class="dari">/${t.workDays}</small></td>` +
        `<td class="num${t.late ? ' merah' : ''}">${times(t.late, t.lateMin)}</td><td class="num">${times(t.early, t.earlyMin)}</td>` +
        `<td class="num${t.noOut ? ' merah' : ''}">${t.noOut || ''}</td><td class="num${t.absent ? ' merah' : ''}">${t.absent || ''}</td><td class="num" title="${LEAVE_KINDS.filter((k) => t[k]).map((k) => `${LABEL[k]} ${t[k]}`).join(' · ')}">${leaveDays(t) || ''}</td>` +
        `<td class="num">${duration(t.hours)}</td><td class="num lembur">${duration(t.overtime)}</td></tr>`)
      .join('') || '<tr><td colspan="9" class="muted">Belum ada karyawan. Ambil data karyawan di menu Karyawan.</td></tr>';
    return;
  }
  const t = r.total;
  $('k-nama').textContent = nameOf(r.pin);
  $('k-hari-info').innerHTML = [`PIN <b>${esc(r.pin)}</b>`, data.schedules.length && `Jadwal <b>${esc(scheduleName(r.pin))}</b>`,
    `Hadir <b>${t.present}</b> dari ${t.workDays} hari kerja`, t.late && `Terlambat <b>${t.late}×</b>`, t.absent && `Alpa <b>${t.absent}</b>`,
    t.noOut && `Lupa pulang <b>${t.noOut}</b>`].filter(Boolean).map((x) => `<span>${x}</span>`).join('');
  // alpa: bisa izin (sakit/cuti) atau lupa scan; lupa pulang: koreksi jam pulang
  const aksi = (d) => (d.status === 'alpa'
    ? `<button class="mini" data-aksi="izin" data-date="${d.date}">Catat izin</button><button class="mini" data-aksi="koreksi" data-date="${d.date}">Koreksi</button>`
    : d.noOut ? `<button class="mini" data-aksi="koreksi" data-date="${d.date}">Koreksi pulang</button>` : '');
  $('k-hari').innerHTML = r.days
    .map((d) => `<tr class="${d.status}"><td>${dayName(d.date).slice(0, 3)}, ${dmy(d.date)}</td><td>${hhmm(d.in)}</td><td>${hhmm(d.out)}</td>` +
      `<td><span class="lencana ${d.status}">${LABEL[d.status]}</span></td><td class="num${d.late ? ' merah' : ''}">${d.late || ''}</td><td class="num">${d.early || ''}</td>` +
      `<td class="num">${duration(d.hours)}</td><td class="num lembur">${duration(d.overtime)}</td><td>${esc(note(d, r.pin))}</td>` +
      `<td class="aksi no-print">${aksi(d)}</td></tr>`)
    .join('');
}

/** Ada hari dengan lembur aktif di salah satu jadwal. */
const anyOvertime = () => [data.schedule, ...data.schedules].some((s) => s.overtime.some(Boolean));

/** Tanpa kolom Lembur bila lembur tidak dihitung di hari mana pun. */
function withoutOvertime(t) {
  if (anyOvertime()) return t;
  const keep = t.columns.map((c) => !c.title.startsWith('Lembur'));
  return { ...t, columns: t.columns.filter((_, i) => keep[i]), rows: t.rows.map((r) => r.filter((_, i) => keep[i])) };
}

/** Ringkasan per karyawan untuk export. */
function summary() {
  const [from, to] = [$('k-dari').value, $('k-sampai').value];
  const int = (title, width = 10) => ({ title, kind: 'int', width });
  return withoutOvertime({
    name: 'Ringkasan',
    title: reportTitle('Rekap absensi', from, to),
    columns: [
      { title: 'PIN', kind: 'text', width: 8 }, { title: 'Nama', kind: 'text', width: 28 }, { title: 'Departemen', kind: 'text', width: 16 },
      { title: 'Jadwal', kind: 'text', width: 14 }, int('Hari kerja'), int('Hadir'), int('Terlambat (kali)'), int('Terlambat (menit)'), int('Pulang cepat (kali)'),
      int('Pulang cepat (menit)'), int('Lupa absen pulang'), int('Alpa'), int('Izin'), int('Sakit'), int('Cuti'), int('Dinas luar'),
      { title: 'Jam kerja (jam)', kind: 'hours', width: 11 }, { title: 'Lembur (jam)', kind: 'hours', width: 11 },
    ],
    rows: result.map(({ pin, total: t }) => [pin, nameOf(pin), deptOf(pin), scheduleName(pin), t.workDays, t.present, t.late, t.lateMin, t.early, t.earlyMin,
      t.noOut, t.absent, t.izin, t.sakit, t.cuti, t.dinas, t.hours, t.overtime]),
  });
}

/** Rincian per hari: semua karyawan, atau satu PIN. */
function days(pin) {
  const [from, to] = [$('k-dari').value, $('k-sampai').value];
  const list = pin ? result.filter((r) => r.pin === pin) : result;
  return withoutOvertime({
    name: 'Rincian',
    title: reportTitle(pin ? `Rincian absensi ${nameOf(pin)} (PIN ${pin})` : 'Rincian absensi', from, to),
    columns: [
      { title: 'PIN', kind: 'text', width: 8 }, { title: 'Nama', kind: 'text', width: 28 }, { title: 'Tanggal', kind: 'date', width: 12 },
      { title: 'Hari', kind: 'text', width: 9 }, { title: 'Masuk', kind: 'time', width: 8 }, { title: 'Pulang', kind: 'time', width: 8 },
      { title: 'Status', kind: 'text', width: 10 }, { title: 'Terlambat (menit)', kind: 'int', width: 10 },
      { title: 'Pulang cepat (menit)', kind: 'int', width: 10 }, { title: 'Jam kerja (jam)', kind: 'hours', width: 10 },
      { title: 'Lembur (jam)', kind: 'hours', width: 10 }, { title: 'Keterangan', kind: 'text', width: 30 },
    ],
    rows: list.flatMap((r) => r.days.map((d) => [r.pin, nameOf(r.pin), d.date, dayName(d.date), d.in, d.out, LABEL[d.status], d.late,
      d.early, d.hours, d.overtime, note(d, r.pin)])),
  });
}
