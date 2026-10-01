// Export .xlsx (Riwayat, Rekap) untuk app/api/xlsx. Halaman mengirim tabel; tanggal dan jam berupa angka
// seri Excel (hari sejak 1899-12-30) dengan format seperti `dd/mm/yyyy`, supaya terbaca benar di Excel
// bahasa apa pun.
import 'server-only';
import ExcelJS from 'exceljs';

type Cell = number | string | null;
export type Sheet = { name: string; title: string; columns: { title: string; format?: string; width: number }[]; rows: Cell[][] };

export async function workbook(sheets: Sheet[]): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, {
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3' }, // A4 mendatar
      views: [{ state: 'frozen', ySplit: 3 }],
    });
    Object.assign(ws.getCell(1, 1), { value: s.title, font: { bold: true, size: 13 } });
    s.columns.forEach((c, i) => {
      Object.assign(ws.getCell(3, i + 1), {
        value: c.title,
        font: { bold: true },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } },
        alignment: { wrapText: true },
      });
      ws.getColumn(i + 1).width = c.width;
    });
    s.rows.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v == null) return;
        const cell = ws.getCell(r + 4, c + 1);
        cell.value = v;
        if (typeof v === 'number' && s.columns[c]?.format) cell.numFmt = s.columns[c].format;
      }),
    );
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + s.rows.length, column: Math.max(1, s.columns.length) } };
  }
  return new Blob([await wb.xlsx.writeBuffer()]);
}

