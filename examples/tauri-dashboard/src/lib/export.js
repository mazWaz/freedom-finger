// Export .xlsx dan CSV (file ditulis perintah Rust `save_xlsx`/`save_text`) dan cetak.
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { data } from './data.js';
import { hhmm, period } from './format.js';
import { notify } from './ui.js';

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

/** Cetak tab yang terbuka (tampilan cetak A4 mendatar: `@media print` di styles.css). */
export async function print(titleEl, title) {
  titleEl.textContent = title;
  await invoke('print').catch((e) => notify(`Gagal mencetak: ${e}`, true));
}
