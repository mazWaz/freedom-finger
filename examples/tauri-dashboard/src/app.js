// Bagian bersama semua tab: koneksi ke server di dalam aplikasi (API HTTP, docs/api.md), data milik
// aplikasi (aplikasi.json lewat perintah Rust), nama karyawan, tanggal, dan export.
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { DEFAULT_SCHEDULE, addDays, weekday } from './hitung-rekap.js';

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
/** "2026-09" -> ["2026-09-01", "2026-09-30"] */
export const monthRange = (ym) => [`${ym}-01`, new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10)];
/** `n` bulan terakhir, terbaru dulu: ["2026-09", "2026-08", …] */
export function lastMonths(n) {
  const [y, m] = today().split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
}
/** Rentang cepat di Riwayat -> [dari, sampai] */
export function range(kind) {
  const t = today();
  const first = `${t.slice(0, 8)}01`;
  const last = addDays(first, -1);
  return {
    today: [t, t],
    yesterday: [addDays(t, -1), addDays(t, -1)],
    week: [addDays(t, -((weekday(t) + 6) % 7)), t], // minggu mulai Senin
    month: [first, t],
    lastMonth: [`${last.slice(0, 8)}01`, last],
  }[kind];
}

// --- pesan untuk pengguna ---------------------------------------------------------------------

let hideTimer;
export function notify(text, error = false) {
  const p = $('pesan');
  p.textContent = text;
  p.className = error ? 'off' : 'ok';
  p.hidden = false;
  clearTimeout(hideTimer);
  if (!error) hideTimer = setTimeout(() => (p.hidden = true), 8000);
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
  schedule: structuredClone(DEFAULT_SCHEDULE), // jadwal utama, dan aturan (toleransi, lembur) untuk semua jadwal
  schedules: [], // jadwal lain {id, name, days}, dipilih per karyawan (mis. paruh waktu)
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
/** Semua PIN yang dikenal: dari mesin dan dari isian aplikasi. */
export const knownPins = () => [...new Set([...users.map((u) => u.pin), ...Object.keys(data.employees)])].sort(byPin);

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
