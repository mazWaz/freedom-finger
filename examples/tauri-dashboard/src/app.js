// Bagian bersama semua tab: koneksi ke server di dalam aplikasi (API HTTP, docs/api.md), data milik
// aplikasi (aplikasi.json lewat perintah Rust), nama karyawan, tanggal, dan export.
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, ChevronRight, createElement } from 'lucide';
import { DEFAULT_SCHEDULE, addDays, addMonths, weekday } from './hitung-rekap.js';

export const $ = (id) => document.getElementById(id);
// PIN dan nama datang dari mesin (atau siapa pun di LAN yang meniru mesin): jangan masuk HTML mentah
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --- tanggal dan jam --------------------------------------------------------------------------

export const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, jam komputer ini
const pad = (n) => String(n).padStart(2, '0');
/** menit -> "08:05" */
export const hhmm = (m) => (m == null ? '' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
/** lama dalam menit -> "8:05" (jam:menit), kosong bila 0 */
export const duration = (m) => (m ? `${Math.floor(m / 60)}:${pad(m % 60)}` : '');
export const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const dayName = (date) => DAY_NAMES[weekday(date)];
/** 2026-09-29 -> 29-09-2026 */
export const dmy = (date) => date.split('-').reverse().join('-');
export const period = (from, to) => (from === to ? dmy(from) : `${dmy(from)} s.d. ${dmy(to)}`);
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** 2026-01-01 -> "1 Januari 2026" */
export const longDate = (date) => `${Number(date.slice(8))} ${monthName(date)}`;
/** "2026-09" -> ["2026-09-01", "2026-09-30"] */
export const monthRange = (ym) => [`${ym}-01`, new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10)];
/** `n` bulan terakhir, terbaru dulu: ["2026-09", "2026-08", …] */
export function lastMonths(n) {
  const [y, m] = today().split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
}
/** Rentang cepat di pemilih rentang tanggal (tanggal.js): label -> [dari, sampai] */
export function ranges() {
  const t = today();
  const first = `${t.slice(0, 8)}01`;
  const last = addDays(first, -1);
  const back = (n) => [addDays(addMonths(t, -n), 1), t]; // n bulan terakhir, sampai hari ini
  return {
    'Hari ini': [t, t],
    Kemarin: [addDays(t, -1), addDays(t, -1)],
    'Minggu ini': [addDays(t, -((weekday(t) + 6) % 7)), t], // minggu mulai Senin
    '1 minggu terakhir': [addDays(t, -6), t],
    'Bulan ini': [first, t],
    'Bulan lalu': [`${last.slice(0, 8)}01`, last],
    '1 bulan terakhir': back(1),
    '2 bulan terakhir': back(2),
    '3 bulan terakhir': back(3),
    '6 bulan terakhir': back(6),
    '1 tahun terakhir': back(12),
  };
}

// --- halaman ----------------------------------------------------------------------------------

const PREV = createElement(ChevronLeft).outerHTML;
const NEXT = createElement(ChevronRight).outerHTML;

/**
 * Satu halaman dari `list` (`page` mulai 1, dijaga di dalam batas) dan tombol halamannya di `nav`:
 * "1–24 dari 57  ‹ 1 … 4 5 6 … 9 ›". Klik tombol memanggil `go(halaman)`; satu halaman saja = `nav`
 * disembunyikan. Hasil: [isi halaman, halaman yang dipakai].
 */
export function paginate(nav, list, page, size, go) {
  const last = Math.max(1, Math.ceil(list.length / size));
  page = Math.min(Math.max(page, 1), last);
  const near = [...new Set([1, page - 1, page, page + 1, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const btn = (n, text, label) => `<button type="button" data-hal="${n}" aria-label="${label ?? `Halaman ${n}`}"` +
    `${!label && n === page ? ' aria-current="page"' : ''}${n < 1 || n > last ? ' disabled' : ''}>${text}</button>`;
  nav.hidden = last < 2;
  nav.innerHTML = `<span>${(page - 1) * size + 1}–${Math.min(page * size, list.length)} dari ${list.length}</span>` +
    btn(page - 1, PREV, 'Halaman sebelumnya') +
    near.map((n, i) => `${n - (near[i - 1] ?? n) > 1 ? '<span aria-hidden="true">…</span>' : ''}${btn(n, n)}`).join('') +
    btn(page + 1, NEXT, 'Halaman berikutnya');
  nav.onclick = (e) => {
    const b = e.target.closest('button[data-hal]');
    if (!b) return;
    go(Number(b.dataset.hal));
    nav.querySelector('[aria-current="page"]')?.focus(); // tombolnya baru digambar ulang: fokus jangan hilang
  };
  return [list.slice((page - 1) * size, page * size), page];
}

// --- pesan untuk pengguna ---------------------------------------------------------------------

let hideTimer;
export function notify(text, error = false) {
  const p = $('pesan');
  p.textContent = text;
  p.className = error ? 'off' : 'ok';
  p.hidden = false;
  p.title = 'Klik untuk menutup';
  p.onclick = () => (p.hidden = true);
  clearTimeout(hideTimer);
  // pesan gagal tampil lebih lama agar sempat dibaca, tapi tetap hilang sendiri
  hideTimer = setTimeout(() => (p.hidden = true), error ? 20_000 : 8000);
}

/**
 * Laci (modal di tengah layar, `<dialog>`: fokus terkunci di dalam, Esc menutup): tampilkan satu isi
 * (`laci-orang`, `i-izin`, `y-laci-daftar`, …) dengan judul. Dipakai semua tab.
 */
export function openDrawer(pane, title, sub = '') {
  const d = $('laci');
  for (const el of d.querySelectorAll('.laci-isi')) el.hidden = el.id !== pane;
  $('laci-judul').textContent = title;
  $('laci-sub').textContent = sub;
  $('laci-sub').hidden = !sub;
  if (!d.open) d.showModal();
}
export const closeDrawer = () => $('laci').close();

/** Gambar mesin absensi bergaya Lucide (badan, layar, sensor jari); Lucide tidak punya ikon ini. */
export const MACHINE_ICON = [
  ['rect', { x: '5', y: '2', width: '14', height: '20', rx: '2' }],
  ['rect', { x: '8', y: '5', width: '8', height: '6', rx: '1' }],
  ['path', { d: 'M10 18.5v-2a2 2 0 0 1 4 0v2' }],
];

let waitStart = 0;
let waitTimer;
// Esc selama menunggu: diabaikan. Membatalkan `cancel` saja tidak cukup: Chromium menutup paksa pada Esc
// kedua, dan ikut menutup laci di bawahnya
addEventListener('keydown', (e) => {
  if (waitStart && e.key === 'Escape') e.preventDefault();
}, true);
/**
 * Layar tunggu selama menunggu mesin: spinner, pesan langkahnya, dan lama menunggu. Seluruh halaman
 * terkunci (`<dialog>` modal paling atas, juga di atas laci), dan Esc tidak menutupnya. Tanpa `text`: tutup.
 */
export function waiting(text) {
  const d = $('tunggu');
  if (!text) {
    waitStart = 0;
    clearInterval(waitTimer);
    return d.close();
  }
  $('tunggu-teks').textContent = text;
  if (waitStart) return;
  if (!d.querySelector('svg')) d.querySelector('.putar').append(createElement(MACHINE_ICON));
  d.oncancel = (e) => e.preventDefault();
  waitStart = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - waitStart) / 1000);
    $('tunggu-lama').textContent = `Sudah menunggu ${Math.floor(s / 60)}:${pad(s % 60)}`;
  };
  tick();
  waitTimer = setInterval(tick, 1000);
  d.showModal();
}

/** Perubahan yang perlu ditampilkan ulang tab yang terbuka: logs, users, devices, data. */
export const bus = new EventTarget();
export const emit = (type) => bus.dispatchEvent(new Event(type));

// --- server (API HTTP) ------------------------------------------------------------------------

let base;
let headers;
export let port;

export async function connect() {
  const s = await invoke('server');
  base = s.url;
  port = s.port;
  headers = { authorization: `Bearer ${s.token}` };
}

/** Balasan lengkap `{success, data?, trans_id?, …}`; `success: false` menjadi error. */
export async function call(endpoint, body = {}) {
  const r = await fetch(`${base}/api/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.success) throw new Error(j.message);
  return j;
}
export const api = async (endpoint, body) => (await call(endpoint, body)).data;

/**
 * Cadangan data satu user di server (`get_backup`, dari data yang dikirim mesin), satu per mesin yang
 * punya, terbaru dulu: `{cloud_id, name, privilege, updated, template, body}` dengan `template` = base64
 * untuk set_userinfo dan `body` = byte body FkWeb yang sama (lihat fkBody).
 */
export async function backups(pin) {
  const list = await Promise.all(devices.map((d) => api('get_backup', { cloud_id: d.cloud_id, pin })
    .then((b) => ({ ...b, cloud_id: d.cloud_id, body: Uint8Array.from(atob(b.template), (c) => c.charCodeAt(0)) }), () => null)));
  return list.filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated));
}

/**
 * Kirim perintah ke mesin dan tunggu hasilnya (mesin mengambil perintah saat bertanya, ±20 detik–2 menit).
 * `status` "offline": mesin terputus sebelum mengambil perintahnya; perintah tetap mengantre di server.
 */
export async function command(cloud_id, endpoint, body = {}) {
  const { trans_id } = await call(endpoint, { cloud_id, ...body });
  const start = Date.now();
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 3000));
    const r = await call('get_result', { cloud_id, trans_id });
    if (r.status === 'done' || r.status === 'timeout') return r;
    // daftar mesin diperbarui tiap menit (main.js); terputus = tidak bertanya lebih dari 3 menit
    if (r.status === 'pending' && devices.find((d) => d.cloud_id === cloud_id)?.connected === false) return { ...r, status: 'offline' };
    if (r.status === 'pending' && Date.now() - start > 10 * 60_000) return { ...r, status: 'timeout' }; // mesin mati atau dicabut
  }
}

/**
 * Event realtime (SSE lewat fetch, karena EventSource tidak bisa mengirim token): absen baru dan
 * hasil perintah, isinya sama dengan webhook. Tersambung ulang sendiri bila koneksi putus.
 */
export async function listen(onEvent) {
  for (;;) {
    try {
      const r = await fetch(`${base}/api/events`, { headers });
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (let c; !(c = await reader.read()).done; ) {
        buf += c.value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
          buf = buf.slice(i + 2);
          if (line) onEvent(JSON.parse(line.slice(5)));
        }
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 1000));
  }
}

export let devices = [];
export async function loadDevices() {
  devices = await api('get_devices');
  emit('devices');
}

/**
 * Tanggal scan pertama tiap PIN sepanjang data (semua mesin): rekap menghitung karyawan mulai hari itu.
 * `null` sampai dimuat; bila gagal dimuat, rekap menghitung seperti biasa (tanpa tanggal mulai).
 */
export let firstScans = null;
export async function loadFirstScans() {
  const first = new Map();
  for (const l of await logs('2000-01-01', today())) {
    const d = l.scan_date.slice(0, 10);
    if (!(first.get(l.pin) <= d)) first.set(l.pin, d);
  }
  firstScans = first;
}
/** Absen baru dari event realtime: orang yang baru pertama kali scan. */
export const noteScan = (pin, date) => firstScans && !firstScans.has(pin) && firstScans.set(pin, date);

/** Log absen semua mesin (atau satu), masing-masing dengan `cloud_id`. */
export async function logs(from, to, cloudId) {
  const ids = cloudId ? [cloudId] : devices.map((d) => d.cloud_id);
  const parts = await Promise.all(
    ids.map(async (id) => (await api('get_attlog', { cloud_id: id, start_date: from, end_date: to })).map((l) => ({ ...l, cloud_id: id }))),
  );
  return parts.flat();
}

// --- data aplikasi (aplikasi.json) -----------------------------------------------------------

const defaults = () => ({
  version: 1,
  office: '', // nama kantor untuk judul laporan
  employees: {}, // PIN -> {name, dept, recap}: isian aplikasi menang atas nama di mesin
  schedule: structuredClone(DEFAULT_SCHEDULE), // jadwal utama, dan aturan (toleransi, batas lembur) untuk semua jadwal
  schedules: [], // jadwal lain {id, name, color, days, overtime, overtimeMax}, dipilih per karyawan (mis. paruh waktu)
  holidays: [], // {date, note}
  leaves: [], // {id, pin, from, to, kind, note}: izin/sakit/cuti/dinas (izin.js)
  corrections: [], // {id, pin, date, time, reason}: koreksi absen, dihitung sebagai scan; tidak pernah ditulis ke mesin
  backup: { folder: '', last: '' },
  pull: {}, // cloud_id -> ambil data karyawan yang sedang berjalan (karyawan.js)
  commands: [], // {trans, cloud_id, type, at}: perintah perawatan yang menunggu mesin (mesin.js)
  auth: null, // kata sandi aplikasi {salt, iterations, hash} (kunci.js)
});
export const data = defaults();

export async function loadData() {
  const saved = (await invoke('load_data')) ?? {};
  const d = defaults();
  Object.assign(data, d, saved, { schedule: { ...d.schedule, ...saved.schedule }, backup: { ...d.backup, ...saved.backup } });
  // dulu lembur satu sakelar untuk semua jadwal (`overtimeOn`); sekarang per hari di tiap jadwal
  const on = saved.schedule?.overtimeOn !== false;
  if (!saved.schedule?.overtime) data.schedule.overtime = Array(7).fill(on);
  for (const s of data.schedules) s.overtime ??= Array(7).fill(on);
  // lembur maksimal per hari (menit); sempat satu angka per jadwal
  for (const s of [data.schedule, ...data.schedules]) if (!Array.isArray(s.overtimeMax)) s.overtimeMax = Array(7).fill(s.overtimeMax || 0);
  data.schedules.forEach((s, i) => (s.color ??= SCHEDULE_COLORS[i % SCHEDULE_COLORS.length]));
}

/** Simpan aplikasi.json (atomik di sisi Rust), lalu beri tahu tab yang terbuka. */
export async function saveData(change = 'data') {
  try {
    await invoke('save_data', { data });
  } catch (e) {
    notify(`Gagal menyimpan pengaturan: ${e}`, true);
    throw e;
  }
  if (change) emit(change);
}

// --- karyawan ---------------------------------------------------------------------------------

/** User yang tercatat di server (`get_users`, semua mesin). */
export let users = [];
const machineNames = new Map();

export async function loadUsers() {
  const list = await api('get_users');
  if (JSON.stringify(list) === JSON.stringify(users)) return;
  users = list;
  machineNames.clear();
  // PIN yang sama di beberapa mesin = satu karyawan; nama yang terbaru dipakai
  for (const u of [...users].sort((a, b) => a.updated.localeCompare(b.updated))) if (u.name) machineNames.set(u.pin, u.name);
  emit('users');
}

export const byPin = (a, b) => a.length - b.length || a.localeCompare(b);
export const machineName = (pin) => machineNames.get(pin) ?? '';
export const nameOf = (pin) => data.employees[pin]?.name || machineNames.get(pin) || `PIN ${pin}`;
export const deptOf = (pin) => data.employees[pin]?.dept ?? '';
export const inRecap = (pin) => data.employees[pin]?.recap !== false;
/** Jadwal lain yang dipilih untuk karyawan ini; `undefined` = jadwal utama. */
export const scheduleOf = (pin) => data.schedules.find((s) => s.id === data.employees[pin]?.schedule);
export const scheduleName = (pin) => scheduleOf(pin)?.name ?? 'Utama';
/** Warna bawaan jadwal lain, jauh dari warna status (hijau tepat waktu, merah terlambat, biru izin). */
export const SCHEDULE_COLORS = ['#7c3aed', '#d97706', '#db2777', '#0d9488', '#4f46e5', '#92400e'];
/** Warna satu jadwal ("#rrggbb"); jadwal utama bawaan abu-abu biru. Dicek karena masuk ke atribut style. */
export const colorOf = (s) => (/^#[0-9a-f]{6}$/i.test(s?.color ?? '') ? s.color : '#64748b');
/** Tanda jadwal karyawan (titik warna dan nama) untuk Hari ini; kosong bila hanya ada jadwal utama. */
export const scheduleTag = (pin) => (data.schedules.length
  ? `<span class="jadwal-tag" style="--warna: ${colorOf(scheduleOf(pin) ?? data.schedule)}">${esc(scheduleName(pin))}</span>` : '');
/**
 * Dihapus dari mesin lewat aplikasi (`employees[pin].removed` = "YYYY-MM-DD hh:mm:ss") dan belum terdaftar
 * lagi sesudahnya. Riwayat absennya tetap ada; hari sesudah tanggal hapus tidak dihitung di rekap.
 */
export const isRemoved = (pin) => {
  const at = data.employees[pin]?.removed;
  return !!at && !users.some((u) => u.pin === pin && u.updated > at);
};
/** PIN yang pernah dipakai (termasuk yang dihapus): dipakai lagi berarti riwayat absennya tercampur. */
export const usedPins = () => [...new Set([...users.map((u) => u.pin), ...Object.keys(data.employees)])].sort(byPin);
/** Semua karyawan: dari mesin dan dari isian aplikasi, kecuali yang dihapus dari mesin. */
export const knownPins = () => usedPins().filter((pin) => !isRemoved(pin));

// --- export dan cetak -------------------------------------------------------------------------

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
/** Jenis kolom: format Excel, nilai untuk .xlsx (tanggal/jam = angka seri Excel), dan teks untuk CSV. */
const KINDS = {
  text: { format: '', xlsx: (v) => v ?? '', csv: (v) => v ?? '' },
  int: { format: '0', xlsx: (v) => v, csv: String },
  date: { format: 'dd/mm/yyyy', xlsx: (d) => (Date.parse(`${d}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000, csv: (d) => d },
  time: { format: 'hh:mm', xlsx: (m) => (m == null ? null : m / 1440), csv: hhmm },
  hours: { format: '0.00', xlsx: (m) => m / 60, csv: (m) => (m / 60).toFixed(2) },
};

/**
 * Tabel untuk export: `{name, title, columns: [{title, kind, width}], rows: [[nilai…]]}`.
 * Nilai mentah: tanggal "YYYY-MM-DD", jam dan lama dalam menit.
 */
export async function exportXlsx(fileName, tables) {
  const path = await save({ defaultPath: fileName, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (!path) return;
  const sheets = tables.map((t) => ({
    name: t.name,
    title: t.title,
    columns: t.columns.map((c) => ({ title: c.title, format: KINDS[c.kind].format, width: c.width })),
    rows: t.rows.map((r) => r.map((v, i) => KINDS[t.columns[i].kind].xlsx(v))),
  }));
  await invoke('save_xlsx', { path, sheets }).then(() => notify(`Tersimpan: ${path}`), (e) => notify(`Gagal menyimpan: ${e}`, true));
}

/** CSV UTF-8 (dengan BOM supaya Excel membaca huruf dengan benar), satu tabel. */
export async function exportCsv(fileName, t) {
  const path = await save({ defaultPath: fileName, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (!path) return;
  const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  // nama dari mesin seperti "=HYPERLINK(…)" jangan sampai dijalankan sebagai rumus oleh Excel
  const text = (v) => (/^[=+\-@\t\r]/.test(v ?? '') ? `'${v}` : (v ?? ''));
  const lines = [t.columns.map((c) => c.title), ...t.rows.map((r) => r.map((v, i) => (t.columns[i].kind === 'text' ? text(v) : KINDS[t.columns[i].kind].csv(v))))];
  const csv = `\uFEFF${lines.map((r) => r.map((v) => cell(String(v ?? ''))).join(',')).join('\r\n')}\r\n`;
  await invoke('save_text', { path, text: csv }).then(() => notify(`Tersimpan: ${path}`), (e) => notify(`Gagal menyimpan: ${e}`, true));
}

/** Judul laporan: nama kantor (bila diisi) dan periode. */
export const reportTitle = (what, from, to) => `${data.office ? `${data.office} · ` : ''}${what} ${period(from, to)}`;

/** Cetak tab yang terbuka (tampilan cetak A4 mendatar: `@media print` di index.html). */
export async function print(titleEl, title) {
  titleEl.textContent = title;
  await invoke('print').catch((e) => notify(`Gagal mencetak: ${e}`, true));
}
