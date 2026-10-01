// Export .xlsx (dibuat server web, server/xlsx.ts) dan CSV (dibuat di sini), diunduh browser; dan cetak.
import { send } from './api.js';
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
  const sheets = tables.map((t) => ({
    name: t.name,
    title: t.title,
    columns: t.columns.map((c) => ({ title: c.title, format: KINDS[c.kind].format, width: c.width })),
    rows: t.rows.map((r) => r.map((v, i) => KINDS[t.columns[i].kind].xlsx(v))),
  }));
  const r = await send('/app/xlsx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sheets }) }).catch((e) => e);
  if (r instanceof Error || !r.ok) return notify(`Gagal membuat Excel: ${r instanceof Error ? r.message : (await r.json()).message}`, true);
  download(fileName, await r.blob());
}

/** CSV UTF-8 (dengan BOM supaya Excel membaca huruf dengan benar), satu tabel. */
export function exportCsv(fileName, t) {
  const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  // nama dari mesin seperti "=HYPERLINK(…)" jangan sampai dijalankan sebagai rumus oleh Excel
  const text = (v) => (/^[=+\-@\t\r]/.test(v ?? '') ? `'${v}` : (v ?? ''));
  const lines = [t.columns.map((c) => c.title), ...t.rows.map((r) => r.map((v, i) => (t.columns[i].kind === 'text' ? text(v) : KINDS[t.columns[i].kind].csv(v))))];
  const csv = `\uFEFF${lines.map((r) => r.map((v) => cell(String(v ?? ''))).join(',')).join('\r\n')}\r\n`;
  download(fileName, new Blob([csv], { type: 'text/csv' }));
}

/** Unduh lewat browser (folder Unduhan, atau tempat yang dipilih pengguna di pengaturan browser). */
function download(fileName, blob) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  notify(`Diunduh: ${fileName}`);
}

/** Judul laporan: nama kantor (bila diisi) dan periode. */
export const reportTitle = (what, from, to) => `${data.office ? `${data.office} · ` : ''}${what} ${period(from, to)}`;

/** Cetak tab yang terbuka (tampilan cetak A4 mendatar: `@media print` di styles.css). */
export function print(titleEl, title) {
  titleEl.textContent = title;
  window.print(); // dialog cetak browser; bisa juga simpan sebagai PDF
}
