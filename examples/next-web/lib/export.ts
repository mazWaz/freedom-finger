// Export .xlsx (dibuat server web, app/api/xlsx) dan CSV (dibuat di sini), diunduh browser; dan cetak.
import { send } from './api';
import { hhmm, period } from './format';

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
type Value = string | number | null | undefined;
/** Jenis kolom: format Excel, nilai untuk .xlsx (tanggal/jam = angka seri Excel), dan teks untuk CSV. */
const KINDS: Record<string, { format: string; xlsx: (v: any) => Value; csv: (v: any) => string }> = {
  text: { format: '', xlsx: (v) => v ?? '', csv: (v) => v ?? '' },
  int: { format: '0', xlsx: (v) => v, csv: String },
  date: { format: 'dd/mm/yyyy', xlsx: (d: string) => (Date.parse(`${d}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000, csv: (d) => d },
  time: { format: 'hh:mm', xlsx: (m: number | null) => (m == null ? null : m / 1440), csv: hhmm },
  hours: { format: '0.00', xlsx: (m: number) => m / 60, csv: (m: number) => (m / 60).toFixed(2) },
};

/** Tabel untuk export. Nilai mentah: tanggal "YYYY-MM-DD", jam dan lama dalam menit. */
export type Table = {
  name: string;
  title: string;
  columns: { title: string; kind: keyof typeof KINDS; width: number }[];
  rows: Value[][];
};

/** Excel dari satu atau beberapa tabel; hasil: pesan gagal, atau `null` bila berhasil diunduh. */
export async function exportXlsx(fileName: string, tables: Table[]): Promise<string | null> {
  const sheets = tables.map((t) => ({
    name: t.name,
    title: t.title,
    columns: t.columns.map((c) => ({ title: c.title, format: KINDS[c.kind].format, width: c.width })),
    rows: t.rows.map((r) => r.map((v, i) => KINDS[t.columns[i].kind].xlsx(v))),
  }));
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sheets }) };
  const r = await send('/api/xlsx', init).catch((e: Error) => e);
  if (r instanceof Error) return `Gagal membuat Excel: ${r.message}`;
  if (!r.ok) return `Gagal membuat Excel: ${(await r.json()).message}`;
  download(fileName, await r.blob());
  return null;
}

/** CSV UTF-8 (dengan BOM supaya Excel membaca huruf dengan benar), satu tabel. */
export function exportCsv(fileName: string, t: Table) {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  // nama dari mesin seperti "=HYPERLINK(…)" jangan sampai dijalankan sebagai rumus oleh Excel
  const text = (v: Value) => (/^[=+\-@\t\r]/.test(String(v ?? '')) ? `'${v}` : (v ?? ''));
  const lines = [
    t.columns.map((c) => c.title),
    ...t.rows.map((r) => r.map((v, i) => (t.columns[i].kind === 'text' ? text(v) : KINDS[t.columns[i].kind].csv(v)))),
  ];
  const csv = `﻿${lines.map((r) => r.map((v) => cell(String(v ?? ''))).join(',')).join('\r\n')}\r\n`;
  download(fileName, new Blob([csv], { type: 'text/csv' }));
}

/** Unduh lewat browser (folder Unduhan, atau tempat yang dipilih pengguna di pengaturan browser). */
function download(fileName: string, blob: Blob) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** Judul laporan: nama kantor (bila diisi) dan periode. */
export const reportTitle = (office: string, what: string, from: string, to: string) => `${office ? `${office} · ` : ''}${what} ${period(from, to)}`;
