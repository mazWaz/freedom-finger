// Tab Riwayat: semua scan dalam rentang tanggal, cari karyawan, pilih mesin, export dan cetak.
// Koreksi absen (izin.js) ikut tampil bertanda "manual" beserta alasannya, kecuali saat satu mesin dipilih.
import { $, data, devices, dmy, esc, exportCsv, exportXlsx, logs, nameOf, print, range, reportTitle } from './app.js';
import { correctionScans, minutes } from './hitung-rekap.js';
import { STATUS, VERIFY } from './hari-ini.js';

let rows = []; // hasil get_attlog untuk rentang terpilih, terbaru dulu
let loaded = ''; // rentang + mesin yang sudah diambil
let seq = 0; // hanya jawaban permintaan terakhir yang dipakai (ganti rentang cepat-cepat)

export function init() {
  const setRange = () => ([$('r-dari').value, $('r-sampai').value] = range($('r-rentang').value));
  $('r-rentang').onchange = () => {
    if ($('r-rentang').value === 'custom') return;
    setRange();
    show('open');
  };
  $('r-dari').onchange = $('r-sampai').onchange = () => {
    $('r-rentang').value = 'custom';
    show('open');
  };
  $('r-mesin').onchange = () => show('open');
  $('r-cari').oninput = render;
  $('r-xlsx').onclick = () => exportXlsx(`${file()}.xlsx`, [table()]);
  $('r-csv').onclick = () => exportCsv(`${file()}.csv`, table());
  $('r-cetak').onclick = () => print($('r-judul'), table().title);
  setRange();
}

const file = () => `riwayat-absen-${$('r-dari').value}_${$('r-sampai').value}`;

export async function show(reason) {
  const opts = devices.map((d) => `<option value="${esc(d.cloud_id)}">${esc(d.cloud_id)}</option>`).join('');
  if ($('r-mesin').dataset.opts !== opts) {
    const keep = $('r-mesin').value;
    $('r-mesin').innerHTML = `<option value="">Semua mesin</option>${opts}`;
    $('r-mesin').value = devices.some((d) => d.cloud_id === keep) ? keep : '';
    $('r-mesin').dataset.opts = opts;
  }
  $('r-mesin').hidden = devices.length < 2;
  const [from, to] = [$('r-dari').value, $('r-sampai').value];
  const want = `${from} ${to} ${$('r-mesin').value}`;
  if (from && to && (reason === 'open' || reason === 'logs' || loaded !== want)) {
    const my = ++seq;
    const list = from <= to ? await logs(from, to, $('r-mesin').value) : [];
    if (my !== seq) return;
    rows = list.sort((a, b) => b.scan_date.localeCompare(a.scan_date));
    loaded = want;
  }
  render();
}

/** Scan mesin ditambah koreksi manual, terbaru dulu. */
function all() {
  if ($('r-mesin').value) return rows;
  return [...rows, ...correctionScans(data.corrections, $('r-dari').value, $('r-sampai').value)].sort((a, b) => b.scan_date.localeCompare(a.scan_date));
}

/** Baris yang cocok dengan pencarian nama atau PIN. */
function visible(list = all()) {
  const q = $('r-cari').value.trim().toLowerCase();
  return q ? list.filter((l) => l.pin.includes(q) || nameOf(l.pin).toLowerCase().includes(q)) : list;
}

const button = (l) => (l.manual ? '' : (STATUS[l.status_scan] ?? String(l.status_scan)));
const verify = (l) => (l.manual ? 'Manual' : (VERIFY[l.verify] ?? String(l.verify)));

function render() {
  const every = all();
  const list = visible(every);
  const manual = list.filter((l) => l.manual).length;
  $('r-info').textContent = `${list.length} scan${list.length === every.length ? '' : ` dari ${every.length}`}${manual ? `, ${manual} di antaranya koreksi manual` : ''}`;
  $('r-daftar').innerHTML = list
    .map((l) => `<tr${l.manual ? ' class="manual"' : ''}><td>${dmy(l.scan_date.slice(0, 10))}</td><td>${l.scan_date.slice(11, 16)}</td>` +
      `<td>${esc(nameOf(l.pin))}</td><td>${esc(l.pin)}</td><td>${esc(button(l))}</td><td>${esc(verify(l))}</td>` +
      `<td>${esc(l.cloud_id)}</td><td>${esc(l.reason)}</td></tr>`)
    .join('');
}

function table() {
  return {
    name: 'Riwayat',
    title: reportTitle('Riwayat absen', $('r-dari').value, $('r-sampai').value),
    columns: [
      { title: 'Tanggal', kind: 'date', width: 12 },
      { title: 'Jam', kind: 'time', width: 8 },
      { title: 'Nama', kind: 'text', width: 28 },
      { title: 'PIN', kind: 'text', width: 8 },
      { title: 'Tombol mesin', kind: 'text', width: 13 },
      { title: 'Verifikasi', kind: 'text', width: 11 },
      { title: 'Mesin', kind: 'text', width: 20 },
      { title: 'Keterangan', kind: 'text', width: 30 },
    ],
    rows: visible().map((l) => [l.scan_date.slice(0, 10), minutes(l.scan_date, 11), nameOf(l.pin), l.pin, button(l), verify(l), l.cloud_id, l.reason]),
  };
}
