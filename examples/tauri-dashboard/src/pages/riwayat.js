// Tab Riwayat, dua tampilan untuk rentang tanggal terpilih, keduanya bisa dicari, di-export, dan dicetak:
// - Per hari (bawaan): daftar hadir, karyawan ke bawah dan tanggal ke samping. Tiap sel jam masuk dan pulang,
//   berwarna menurut hitungan yang sama dengan Rekap (recapAll): terlambat, izin/sakit/cuti/dinas, tidak
//   masuk, libur. Hari ini ikut tampil; yang belum scan hari ini belum dianggap tidak masuk.
// - Semua scan: tiap scan dikelompokkan per hari, bisa dipilih per mesin.
// Koreksi absen (izin.js) ikut dihitung dan bertanda "manual", kecuali saat satu mesin dipilih. Klik sel daftar
// hadir = form koreksi untuk orang dan tanggal itu (lupa absen masuk atau pulang).
import { devices, logs } from '../lib/api.js';
import { data, inRecap, knownPins, nameOf, shiftOn } from '../lib/data.js';
import { exportCsv, exportXlsx, print, reportTitle } from '../lib/export.js';
import { dayName, hhmm, longDate, monthName, ranges, today } from '../lib/format.js';
import { LEAVE_KINDS, LOOKBACK_DAYS, addDays, correctionScans, minutes, scanRoles } from '../lib/hitung-rekap.js';
import { $, esc, paginate } from '../lib/ui.js';
import { VERIFY } from './hari-ini.js';
import { openForm } from './izin.js';
import { LABEL, recapAll } from './rekap.js';

let rows = []; // hasil get_attlog untuk rentang terpilih ditambah tepinya (wide), terbaru dulu
let loaded = ''; // rentang + mesin yang sudah diambil
let seq = 0; // hanya jawaban permintaan terakhir yang dipakai (ganti rentang cepat-cepat)
let view = 'hari'; // 'hari' = daftar hadir per hari, 'scan' = semua scan
const PER_PAGE = 50; // Semua scan
let page = 1;
/** Mesin terpilih; hanya di tampilan Semua scan (daftar hadir selalu dari semua mesin). */
const machine = () => (view === 'scan' ? $('r-mesin').value : '');

export function init() {
  [$('r-dari').value, $('r-sampai').value] = ranges()['Bulan ini'];
  $('r-dari').onchange = () => show('open'); // rentang (tanggal.js): sekali, di input dari
  $('r-mesin').onchange = () => show('open');
  $('r-baris').onclick = (e) => {
    const td = e.target.closest('td[data-date]');
    if (td) openForm('corrections', { pin: td.parentElement.dataset.pin, date: td.dataset.date });
  };
  $('r-cari').oninput = () => {
    page = 1;
    render();
  };
  $('r-tampilan').onclick = (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === view) return;
    view = b.dataset.v;
    show('view');
  };
  const current = () => (view === 'hari' ? sheetTable() : table());
  $('r-xlsx').onclick = () => exportXlsx(`${file()}.xlsx`, [current()]);
  $('r-csv').onclick = () => exportCsv(`${file()}.csv`, current());
  $('r-cetak').onclick = () => print($('r-judul'), current().title);
}

const file = () => `riwayat-absen-${$('r-dari').value}_${$('r-sampai').value}`;

export async function show(reason) {
  if (reason === 'open') page = 1; // tab dibuka, atau rentang/mesin diganti
  const opts = devices.map((d) => `<option value="${esc(d.cloud_id)}">${esc(d.cloud_id)}</option>`).join('');
  if ($('r-mesin').dataset.opts !== opts) {
    const keep = $('r-mesin').value;
    $('r-mesin').innerHTML = `<option value="">Semua mesin</option>${opts}`;
    $('r-mesin').value = devices.some((d) => d.cloud_id === keep) ? keep : '';
    $('r-mesin').dataset.opts = opts;
  }
  $('r-mesin').hidden = devices.length < 2 || view !== 'scan';
  $('riwayat').classList.toggle('satu-mesin', devices.length < 2); // kolom Mesin selalu sama: sembunyikan
  for (const b of $('r-tampilan').children) b.setAttribute('aria-pressed', b.dataset.v === view);
  $('r-hari').hidden = view !== 'hari';
  $('r-scan').hidden = view !== 'scan';
  const [from, to] = [$('r-dari').value, $('r-sampai').value];
  const want = `${from} ${to} ${machine()}`;
  if (from && to && (reason === 'open' || reason === 'logs' || loaded !== want)) {
    const my = ++seq;
    const list = from <= to ? await logs(...wide(from, to), machine()) : [];
    if (my !== seq) return;
    rows = list.sort((a, b) => b.scan_date.localeCompare(a.scan_date));
    loaded = want;
  }
  render();
}

/** Rentang yang diambil: beberapa hari sebelum (masuk jam bebas yang pulangnya di rentang) sampai sehari sesudah. */
const wide = (from, to) => [addDays(from, -LOOKBACK_DAYS), addDays(to, 1)];

/** Scan mesin ditambah koreksi manual, terbaru dulu, termasuk tepi rentang (untuk hitungan). */
function all() {
  if (machine()) return rows;
  return [...rows, ...correctionScans(data.corrections, ...wide($('r-dari').value, $('r-sampai').value))].sort((a, b) => b.scan_date.localeCompare(a.scan_date));
}
/** Hanya scan di rentang terpilih (untuk tampilan). */
const inRange = (list) => list.filter((l) => $('r-dari').value <= l.scan_date && l.scan_date.slice(0, 10) <= $('r-sampai').value);

/** Baris yang cocok dengan pencarian nama atau PIN. */
function visible(list) {
  const q = $('r-cari').value.trim().toLowerCase();
  return q ? list.filter((l) => l.pin.includes(q) || nameOf(l.pin).toLowerCase().includes(q)) : list;
}

/**
 * Arti scan menurut aturan rekap (masuk = scan pertama, pulang = terakhir), bukan tombol mesin yang diganti
 * mesin sendiri menurut jam. Satu mesin dipilih: dihitung dari scan mesin itu saja.
 */
const rolesOf = (list) => {
  const roles = scanRoles(list, data.schedule.minGap, shiftOn);
  return (l) => roles.get(`${l.pin} ${l.scan_date}`) ?? '';
};
const verify = (l) => (l.manual ? 'Manual' : (VERIFY[l.verify] ?? String(l.verify)));

const render = () => (view === 'hari' ? renderSheet() : renderLog());

function renderLog() {
  const every = inRange(all());
  const list = visible(every);
  const role = rolesOf(all());
  const manual = list.filter((l) => l.manual).length;
  $('r-info').innerHTML = `<span><b>${list.length}</b> scan${list.length === every.length ? '' : ` dari ${every.length}`}</span>` +
    (manual ? `<span><b>${manual}</b> koreksi manual</span>` : '');
  // halaman di layar; baris halaman lain hanya disembunyikan (.luar), supaya Cetak tetap berisi semua scan
  const [, n] = paginate($('r-hal'), list, page, PER_PAGE, (p) => {
    page = p;
    renderLog();
  });
  page = n;
  const [first, end] = [(n - 1) * PER_PAGE, n * PER_PAGE];
  // satu judul per hari; baris hanya jam, nama (PIN di bawahnya), tombol, dan verifikasi
  const perDay = new Map();
  for (const l of list) perDay.set(l.scan_date.slice(0, 10), (perDay.get(l.scan_date.slice(0, 10)) ?? 0) + 1);
  const title = (d, cls) => `<tr class="${cls}"><th colspan="5">${dayName(d)}, ${Number(d.slice(8))} ${monthName(d.slice(0, 7))}<span>${perDay.get(d)} scan</span></th></tr>`;
  let day = '';
  $('r-daftar').innerHTML = list
    .map((l, i) => {
      const d = l.scan_date.slice(0, 10);
      const out = i < first || i >= end ? ' luar' : '';
      // hari yang berlanjut dari halaman sebelumnya: judulnya diulang di atas halaman ini (hanya di layar)
      const head = d !== day ? title(d, `hari${out}`) : i === first ? title(d, 'hari no-print') : '';
      day = d;
      return `${head}<tr class="${l.manual ? 'manual' : ''}${out}"><td class="jam">${l.scan_date.slice(11, 16)}</td>` +
        `<td><span class="dua">${esc(nameOf(l.pin))}<small>PIN ${esc(l.pin)}</small></span></td><td>${role(l) || '<span class="redup">–</span>'}</td>` +
        `<td>${l.manual ? `<span class="lencana">Manual</span><span>${esc(l.reason)}</span>` : esc(verify(l))}</td>` +
        `<td class="mesin">${esc(l.cloud_id)}</td></tr>`;
    })
    .join('') || `<tr><td colspan="5" class="muted">${every.length ? 'Tidak ada scan yang cocok dengan pencarian.' : 'Belum ada scan di rentang ini.'}</td></tr>`;
}

function table() {
  const role = rolesOf(all());
  return {
    name: 'Riwayat',
    title: reportTitle('Riwayat absen', $('r-dari').value, $('r-sampai').value),
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
    rows: visible(inRange(all())).map((l) => [l.scan_date.slice(0, 10), minutes(l.scan_date, 11), nameOf(l.pin), l.pin, role(l), verify(l), l.cloud_id, l.reason]),
  };
}

// --- per hari: daftar hadir -------------------------------------------------------------------

/** Karyawan yang cocok dengan pencarian (urut nama), tanggal urut sampai hari ini, dan hasil recap per sel. */
function sheet() {
  const [from, to] = [$('r-dari').value, $('r-sampai').value];
  const now = today();
  const last = to < now ? to : now;
  const scans = all();
  const q = $('r-cari').value.trim().toLowerCase();
  const pins = [...new Set([...knownPins(), ...inRange(scans).map((s) => s.pin)])].filter(inRecap)
    .filter((pin) => !q || pin.includes(q) || nameOf(pin).toLowerCase().includes(q))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'id'));
  const days = new Map(); // "PIN tanggal" -> hari dari recap(); hari ini ikut dihitung (until = besok)
  const dates = [];
  if (from && from <= last) {
    for (const r of recapAll(scans, pins, from, last, addDays(now, 1))) for (const d of r.days) days.set(`${r.pin} ${d.date}`, d);
    for (let d = from; d <= last; d = addDays(d, 1)) dates.push(d);
  }
  const manual = new Set(data.corrections.map((c) => `${c.pin} ${c.date} ${c.time}`));
  // menit ke atas 1440 = pulang besoknya (jam bebas lewat tengah malam): koreksinya bertanggal besok
  const isManual = (pin, date) => (m) => manual.has(m >= 1440 ? `${pin} ${addDays(date, 1)} ${hhmm(m - 1440)}` : `${pin} ${date} ${hhmm(m)}`);
  return { pins, dates, now, cell: (pin, date) => cell(days.get(`${pin} ${date}`), date === now, isManual(pin, date)) };
}

/**
 * Isi satu sel: `kind` untuk warna, `in`/`out` jam, `text` untuk yang tanpa jam, dan `about` (kalimat
 * lengkapnya). Pulang "?" = hari sudah lewat tanpa absen pulang.
 */
function cell(d, isToday, isManual) {
  if (!d) return { kind: '', text: '', about: '' };
  if (LEAVE_KINDS.includes(d.status)) return { kind: 'izin', text: LABEL[d.status], about: LABEL[d.status] };
  if (d.status === 'alpa') return isToday ? { kind: '', text: '', about: 'belum scan' } : { kind: 'alpa', text: 'Alpa', about: 'tidak masuk' };
  if (d.in == null && d.out != null && d.status === 'hadir') return { kind: '', text: `pulang ${hhmm(d.out)}`, about: `pulang ${hhmm(d.out)} dari masuk kemarin (jam bebas)` };
  if (d.in == null) return { kind: 'libur', text: '', about: `libur${d.note ? `: ${d.note}` : ''}` };
  const out = d.out != null ? hhmm(d.out) : d.noOut && !isToday ? '?' : '';
  const lateLong = d.late < 60 ? `${d.late} menit` : `${Math.floor(d.late / 60)} jam${d.late % 60 ? ` ${d.late % 60} menit` : ''}`;
  const about = [`masuk ${hhmm(d.in)}`, d.late && `terlambat ${lateLong}`, out === '?' ? 'tanpa absen pulang' : out && `pulang ${out}`,
    d.early && `${d.early} menit sebelum jam pulang`, d.status === 'libur' && 'di hari libur'].filter(Boolean).join(', ');
  return { kind: d.status === 'libur' ? 'libur' : d.late ? 'telat' : '', in: hhmm(d.in), out, late: d.late, early: d.early,
    manualIn: isManual(d.in), manualOut: d.out != null && isManual(d.out), about };
}

const shortDate = (date) => `${Number(date.slice(8))} ${monthName(date).slice(0, 3)}`;
/** Lama terlambat singkat untuk sel: 45 -> "+45", 67 -> "+1j07", 120 -> "+2j" (menit besar sulit dibaca). */
const lateText = (m) => (m < 60 ? `+${m}` : `+${Math.floor(m / 60)}j${m % 60 ? String(m % 60).padStart(2, '0') : ''}`);
let scrolledFor = ''; // rentang yang tabelnya sudah digulir ke tanggal terakhir

function renderSheet() {
  const { pins, dates, now, cell: at } = sheet();
  if (!pins.length) {
    const q = $('r-cari').value.trim();
    $('r-kepala').innerHTML = '<tr><th>Karyawan</th></tr>';
    $('r-baris').innerHTML = `<tr><th scope="row" class="kosong-sel">${q ? `Tidak ada karyawan yang cocok dengan "${esc(q)}".` : 'Belum ada data karyawan. Ambil dari mesin di menu Karyawan.'}</th></tr>`;
    return;
  }
  const holidays = new Map(data.holidays.map((h) => [h.date, h.note]));
  // kolom tanggal: abu-abu bila libur untuk semua orang, hijau untuk hari ini; keterangan libur di title
  $('r-kepala').innerHTML = `<tr><th>Karyawan</th>${dates.map((date) => {
    const cls = [date === now && 'sekarang', pins.every((pin) => at(pin, date).kind === 'libur') && 'libur-semua'].filter(Boolean).join(' ');
    const note = holidays.get(date) ?? (date === now ? 'hari ini' : '');
    return `<th scope="col"${cls ? ` class="${cls}"` : ''} title="${dayName(date)} ${longDate(date)}${note ? `, ${esc(note)}` : ''}">` +
      `<b>${dayName(date).slice(0, 3)}</b>${shortDate(date)}</th>`;
  }).join('')}</tr>`;
  $('r-baris').innerHTML = pins.map((pin) => `<tr data-pin="${esc(pin)}"><th scope="row" title="${esc(nameOf(pin))}, PIN ${esc(pin)}">${esc(nameOf(pin))}</th>` +
    dates.map((date) => {
      const c = at(pin, date);
      return `<td class="${c.kind}" data-date="${date}" title="${esc(nameOf(pin))}, ${dayName(date)} ${longDate(date)}: ${esc(c.about)}. Klik untuk koreksi absen">` +
        (c.in
          ? `<b${c.manualIn ? ' class="manual"' : ''}>${c.in}${c.late ? `<small>${lateText(c.late)}</small><span class="sr-only"> terlambat</span>` : ''}</b>` +
            `<span class="${[c.out === '?' && 'tanpa', c.early && 'cepat', c.manualOut && 'manual'].filter(Boolean).join(' ')}">${c.out}` +
            `${c.out === '?' ? '<span class="sr-only"> tanpa absen pulang</span>' : ''}</span>`
          : c.text) +
        '</td>';
    }).join('') + '</tr>').join('');
  // rentang baru: tampilkan tanggal terakhir (biasanya hari ini) di ujung kanan; setelah itu posisi gulir pengguna dibiarkan
  const range = `${$('r-dari').value} ${$('r-sampai').value}`;
  if (scrolledFor !== range && !$('r-hari').hidden) {
    const box = document.querySelector('.matriks-bungkus');
    box.scrollLeft = box.scrollWidth;
    scrolledFor = range;
  }
}

/** Daftar hadir untuk export: satu baris per karyawan, satu kolom per tanggal, isinya teks pendek. */
function sheetTable() {
  const { pins, dates, cell: at } = sheet();
  const text = (c) => {
    if (!c.in) return c.text || (c.kind === 'libur' ? 'Libur' : '');
    const notes = [c.late && `terlambat ${c.late} mnt`, c.out === '?' && 'tanpa pulang'].filter(Boolean);
    return `${c.in}${c.out && c.out !== '?' ? `–${c.out}` : ''}${notes.length ? ` (${notes.join(', ')})` : ''}`;
  };
  return {
    name: 'Riwayat',
    title: reportTitle('Riwayat absen', $('r-dari').value, $('r-sampai').value),
    columns: [{ title: 'Nama', kind: 'text', width: 24 }, { title: 'PIN', kind: 'text', width: 7 },
      ...dates.map((date) => ({ title: `${dayName(date).slice(0, 3)} ${shortDate(date)}`, kind: 'text', width: 13 }))],
    rows: pins.map((pin) => [nameOf(pin), pin, ...dates.map((date) => text(at(pin, date)))]),
  };
}
