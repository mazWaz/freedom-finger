use std::fs;
use std::path::PathBuf;

use rust_xlsxwriter::{Format, Workbook};
use serde_json::Value;

use super::{Res, err};

/// File teks (CSV) di lokasi pilihan pengguna.
#[tauri::command(async)]
pub fn save_text(path: PathBuf, text: String) -> Res<()> {
    fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Satu sheet export. Tanggal dan jam dikirim sebagai angka seri Excel (hari sejak 1899-12-30)
/// dengan `format` seperti `dd/mm/yyyy`, supaya terbaca benar di Excel bahasa apa pun.
#[derive(serde::Deserialize)]
pub struct Sheet {
    name: String,
    title: String,
    columns: Vec<Column>,
    rows: Vec<Vec<Value>>,
}

#[derive(serde::Deserialize)]
struct Column {
    title: String,
    #[serde(default)]
    format: String,
    width: f64,
}

#[tauri::command(async)]
pub fn save_xlsx(path: PathBuf, sheets: Vec<Sheet>) -> Res<()> {
    let mut wb = Workbook::new();
    let title = Format::new().set_bold().set_font_size(13);
    let head = Format::new().set_bold().set_background_color("#E8E8E8").set_text_wrap();
    for s in &sheets {
        let ws = wb.add_worksheet();
        ws.set_name(&s.name).map_err(err)?.set_landscape().set_paper_size(9).set_print_fit_to_pages(1, 0); // A4 mendatar
        ws.write_string_with_format(0, 0, &s.title, &title).map_err(err)?;
        let formats: Vec<Format> = s.columns.iter().map(|c| Format::new().set_num_format(&c.format)).collect();
        for (c, col) in (0u16..).zip(&s.columns) {
            ws.write_string_with_format(2, c, &col.title, &head).map_err(err)?;
            ws.set_column_width(c, col.width).map_err(err)?;
        }
        for (r, row) in (3u32..).zip(&s.rows) {
            for ((c, v), f) in (0u16..).zip(row).zip(&formats) {
                match v {
                    Value::Number(n) => ws.write_number_with_format(r, c, n.as_f64().unwrap_or_default(), f).map_err(err)?,
                    Value::String(t) => ws.write_string(r, c, t).map_err(err)?,
                    _ => ws,
                };
            }
        }
        let last = u16::try_from(s.columns.len().max(1) - 1).map_err(err)?;
        ws.set_freeze_panes(3, 0).map_err(err)?.set_repeat_rows(2, 2).map_err(err)?;
        ws.autofilter(2, 0, 2 + u32::try_from(s.rows.len()).map_err(err)?, last).map_err(err)?;
    }
    wb.save(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Cetak halaman (tampilan cetak: `@media print` di `src/styles.css`); dialog OS juga bisa menyimpan PDF.
#[tauri::command]
pub fn print(w: tauri::WebviewWindow) -> Res<()> {
    w.print().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xlsx_bisa_dibuka() {
        let dir = std::env::temp_dir().join(format!("ff-app-{}-xlsx", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let sheet: Sheet = serde_json::from_value(serde_json::json!({
            "name": "Rekap", "title": "Rekap absensi 01-09-2026 s.d. 30-09-2026",
            "columns": [{ "title": "Tanggal", "format": "dd/mm/yyyy", "width": 12 }, { "title": "Nama", "width": 20 },
                        { "title": "Jam kerja (jam)", "format": "0.00", "width": 10 }],
            "rows": [[46294, "Budi Santoso", 8.5], [46295, "Siti", null]],
        }))
        .unwrap();
        let path = dir.join("rekap.xlsx");
        save_xlsx(path.clone(), vec![sheet]).unwrap();
        assert_eq!(&fs::read(&path).unwrap()[..2], b"PK");
        println!("xlsx: {}", path.display()); // diperiksa manual: buka di Excel/LibreOffice
    }
}
