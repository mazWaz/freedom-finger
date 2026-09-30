//! Freedom Finger untuk pengguna akhir: server absensi (mesin mengirim ke port 8013) dan aplikasi
//! absensi (riwayat, rekap, export, backup) dalam satu aplikasi, sekaligus contoh pemakaian SDK.
//! PC tidak menyala 24 jam, jadi aplikasi jalan sendiri saat login dan tetap hidup di tray walau
//! jendelanya ditutup; absen selama PC mati disusul lewat `sync_attlog` saat start (`src/main.js`).
//! Data di folder data aplikasi; `FKWEB_PORT` dll. tetap berlaku.
//!
//! Halaman memakai API HTTP server seperti aplikasi lain. Sisi Rust hanya mengerjakan yang tidak
//! bisa dilakukan halaman: `aplikasi.json`, file export, backup/pulihkan, cetak, dan update aplikasi.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use freedom_finger::config::Config;
use freedom_finger::store::Store;
use rust_xlsxwriter::{Format, Workbook};
use serde_json::Value;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_updater::UpdaterExt;

/// Argumen saat dijalankan otomatis ketika login: mulai di tray, tanpa jendela.
const AUTOSTART_ARG: &str = "--tray";
/// Data milik aplikasi (nama lengkap, jam kerja, libur, …), di samping database server. Isinya
/// diatur halaman (`src/app.js`); log mesin tidak pernah diubah aplikasi.
const DATA_FILE: &str = "aplikasi.json";
/// Jumlah backup harian yang disimpan di folder backup.
const KEEP_BACKUPS: usize = 30;
/// Akhiran file yang disiapkan `restore`, dipasang saat start berikutnya.
const STAGED: &str = ".pulihkan";

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Alamat, port, dan token API untuk halaman.
#[derive(Clone, serde::Serialize)]
struct Server {
    url: String,
    port: u16,
    token: String,
}

#[tauri::command]
fn server(s: tauri::State<'_, Server>) -> Server {
    s.inner().clone()
}

/// IP LAN komputer ini sekarang = isian Server IP di mesin (berubah bila tidak direservasi di router).
#[tauri::command]
fn lan_ip() -> Option<String> {
    freedom_finger::net::lan_ip().map(|ip| ip.to_string())
}

/// Folder data dan database server.
struct Paths {
    dir: PathBuf,
    db: PathBuf,
}

/// Isi `aplikasi.json`; `null` bila belum ada.
#[tauri::command]
fn load_data(p: State<'_, Paths>) -> Res<Option<Value>> {
    match fs::read_to_string(p.dir.join(DATA_FILE)) {
        Ok(s) => serde_json::from_str(&s).map(Some).map_err(|e| format!("{DATA_FILE} rusak: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
fn save_data(p: State<'_, Paths>, data: Value) -> Res<()> {
    write_atomic(&p.dir.join(DATA_FILE), serde_json::to_string_pretty(&data).map_err(err)?.as_bytes())
}

/// Tulis ke file sementara, pastikan sampai disk, lalu ganti nama: bila PC mati di tengah jalan,
/// file lama tetap utuh.
fn write_atomic(path: &Path, bytes: &[u8]) -> Res<()> {
    let tmp = suffixed(path, ".tmp");
    let write = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    };
    write().map_err(|e| format!("{}: {e}", path.display()))
}

fn suffixed(p: &Path, suffix: &str) -> PathBuf {
    let mut s = OsString::from(p.as_os_str());
    s.push(suffix);
    s.into()
}

/// File teks (CSV) di lokasi pilihan pengguna.
#[tauri::command(async)]
fn save_text(path: PathBuf, text: String) -> Res<()> {
    fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Satu sheet export. Tanggal dan jam dikirim sebagai angka seri Excel (hari sejak 1899-12-30)
/// dengan `format` seperti `dd/mm/yyyy`, supaya terbaca benar di Excel bahasa apa pun.
#[derive(serde::Deserialize)]
struct Sheet {
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
fn save_xlsx(path: PathBuf, sheets: Vec<Sheet>) -> Res<()> {
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

/// Folder backup bawaan: `Freedom Finger Backup` di folder pengguna. Bukan Dokumen, karena di
/// Windows folder itu sering disinkronkan OneDrive, dan backup berisi data jari/wajah.
#[tauri::command]
fn default_backup_dir(app: AppHandle) -> Res<PathBuf> {
    Ok(app.path().home_dir().map_err(err)?.join("Freedom Finger Backup"))
}

/// Backup database dan `aplikasi.json` ke `folder`, dengan tanggal `date` (YYYY-MM-DD, jam PC)
/// di nama file; backup hari yang sama ditimpa. Hanya [`KEEP_BACKUPS`] tanggal terakhir disimpan.
#[tauri::command(async)]
fn backup(p: State<'_, Paths>, folder: PathBuf, date: String) -> Res<PathBuf> {
    backup_into(&p, &folder, &date)
}

/// Satu backup pada satu waktu (otomatis dan tombol memakai file sementara yang sama).
static BACKUP: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn backup_into(p: &Paths, folder: &Path, date: &str) -> Res<PathBuf> {
    if !is_date(date) {
        return Err(format!("tanggal tidak valid: {date}"));
    }
    let _one = BACKUP.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let db = folder.join(format!("freedom-finger-{date}.db"));
    let tmp = suffixed(&db, ".tmp");
    let _ = fs::remove_file(&tmp); // sisa backup yang terputus
    // VACUUM INTO: aman walau server sedang menerima absen
    Store::open(&p.db).and_then(|s| s.backup_to(&tmp)).map_err(|e| format!("backup database: {e}"))?;
    fs::rename(&tmp, &db).map_err(err)?;
    if let Ok(bytes) = fs::read(p.dir.join(DATA_FILE)) {
        write_atomic(&folder.join(format!("aplikasi-{date}.json")), &bytes)?;
    }
    let mut dates: Vec<String> = fs::read_dir(folder)
        .map_err(err)?
        .flatten()
        .filter_map(|e| Some(e.file_name().to_str()?.strip_prefix("freedom-finger-")?.strip_suffix(".db")?.to_owned()))
        .filter(|d| is_date(d))
        .collect();
    dates.sort_unstable_by(|a, b| b.cmp(a));
    for d in dates.iter().skip(KEEP_BACKUPS) {
        let _ = fs::remove_file(folder.join(format!("freedom-finger-{d}.db")));
        let _ = fs::remove_file(folder.join(format!("aplikasi-{d}.json")));
    }
    Ok(db)
}

/// `YYYY-MM-DD`
fn is_date(s: &str) -> bool {
    s.len() == 10 && s.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() })
}

/// Siapkan pemulihan dari file backup, lalu mulai ulang aplikasi. Database yang sedang dipakai
/// server tidak bisa diganti selagi terbuka, jadi file baru dipasang saat start ([`apply_restore`]).
/// `aplikasi-<tanggal>.json` di samping backup ikut dipulihkan.
#[tauri::command(async)]
fn restore(app: AppHandle, p: State<'_, Paths>, file: PathBuf) -> Res<()> {
    stage_restore(&p, &file)?;
    // lewat event Exit, supaya kunci satu-instans dilepas sebelum aplikasi baru hidup
    app.request_restart();
    Ok(())
}

fn stage_restore(p: &Paths, file: &Path) -> Res<()> {
    let (staged_db, staged_json) = (suffixed(&p.db, STAGED), suffixed(&p.dir.join(DATA_FILE), STAGED));
    let r = stage_files(p, file, &staged_db, &staged_json);
    if r.is_err() {
        // tidak ada yang setengah jadi: tanpa ini, pemulihan yang "gagal" terpasang diam-diam saat start berikutnya
        let _ = fs::remove_file(&staged_db);
        let _ = fs::remove_file(&staged_json);
    }
    r
}

fn stage_files(p: &Paths, file: &Path, staged_db: &Path, staged_json: &Path) -> Res<()> {
    // aplikasi.json backup, dengan pengaturan backup PC ini (folder, backup terakhir) dan kata sandi yang
    // sekarang: pengaturan lama membuat backup otomatis hari ini ditimpa isi yang baru dipulihkan, dan
    // kata sandi lama mungkin sudah tidak diingat
    let date = file.file_name().and_then(|n| n.to_str()?.strip_prefix("freedom-finger-")?.strip_suffix(".db").map(str::to_owned));
    let json = date.map(|d| file.with_file_name(format!("aplikasi-{d}.json"))).filter(|j| j.exists());
    let json = match json {
        Some(j) => {
            let mut v: Value = serde_json::from_str(&fs::read_to_string(&j).map_err(err)?).map_err(|e| format!("{}: {e}", j.display()))?;
            let now: Option<Value> = fs::read_to_string(p.dir.join(DATA_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok());
            if let Some(obj) = v.as_object_mut() {
                for key in ["backup", "auth"] {
                    if let Some(x) = now.as_ref().and_then(|n| n.get(key)) {
                        obj.insert(key.into(), x.clone());
                    }
                }
            }
            Some(serde_json::to_string_pretty(&v).map_err(err)?)
        }
        None => None,
    };
    fs::copy(file, staged_db).map_err(|e| format!("{}: {e}", file.display()))?;
    Store::open(staged_db).and_then(|s| s.count_logs("")).map_err(|e| format!("{} bukan backup Freedom Finger: {e}", file.display()))?;
    if let Some(text) = json {
        write_atomic(staged_json, text.as_bytes())?;
    }
    Ok(())
}

/// Nama data lama setelah pulihkan: `absensi-sebelum-pulih.db` (bisa dipilih lagi di Pulihkan).
fn before_restore(db: &Path) -> PathBuf {
    let stem = db.file_stem().map_or_else(|| "absensi".into(), |s| s.to_string_lossy().into_owned());
    db.with_file_name(format!("{stem}-sebelum-pulih.db"))
}

/// Pasang file yang disiapkan [`restore`], sebelum server membuka database. Data lama disimpan
/// sebagai [`before_restore`], bersama jurnal SQLite-nya bila ada. Aman diulang bila terputus di
/// tengah jalan: data lama hanya ditimpa bila database sekarang masih ada.
fn apply_restore(dir: &Path, db: &Path) -> std::io::Result<()> {
    let staged = suffixed(db, STAGED);
    if staged.exists() {
        let old = before_restore(db);
        for ext in ["", "-journal", "-wal", "-shm"] {
            let (from, to) = (suffixed(db, ext), suffixed(&old, ext));
            if from.exists() {
                let _ = fs::remove_file(&to);
                fs::rename(from, to)?;
            } else if ext.is_empty() {
                break; // sudah dipindah pada percobaan sebelumnya
            }
        }
        fs::rename(staged, db)?;
    }
    let json = dir.join(DATA_FILE);
    let staged = suffixed(&json, STAGED);
    if staged.exists() {
        fs::rename(staged, json)?;
    }
    Ok(())
}

/// Cetak halaman (tampilan cetak: `@media print` di `index.html`); dialog OS juga bisa menyimpan PDF.
#[tauri::command]
fn print(w: tauri::WebviewWindow) -> Res<()> {
    w.print().map_err(err)
}

/// Ukuran awal jendela menurut layar, 720p sampai 4K. Layar kecil (area kerja kurang dari 1400x800 titik,
/// mis. 1280x720 dan 1366x768): seluruh area kerja. Lebih besar: 90%, di tengah. 4K dengan skala 100% (area
/// kerja minimal 3200x1700 titik): tampilan diperbesar 1,5x supaya tulisan tidak terlalu kecil. Pengguna
/// tetap bisa mengubahnya dengan Ctrl + / Ctrl - / Ctrl 0 (`zoomHotkeysEnabled`).
fn fit_to_screen(w: &tauri::WebviewWindow) -> tauri::Result<()> {
    let Some(m) = w.current_monitor()?.or(w.primary_monitor()?) else { return Ok(()) };
    let (scale, area) = (m.scale_factor(), m.work_area());
    let (width, height) = (f64::from(area.size.width) / scale, f64::from(area.size.height) / scale);
    let part = if width < 1400.0 || height < 800.0 { 1.0 } else { 0.9 };
    let (ow, oh) = ((f64::from(area.size.width) * part) as u32, (f64::from(area.size.height) * part) as u32);
    // ukuran yang diatur = isi jendela; bingkai dan judul jendela dikurangkan supaya pas di area kerja
    let (outer, inner) = (w.outer_size()?, w.inner_size()?);
    w.set_size(PhysicalSize::new(
        ow.saturating_sub(outer.width.saturating_sub(inner.width)),
        oh.saturating_sub(outer.height.saturating_sub(inner.height)),
    ))?;
    w.set_position(PhysicalPosition::new(
        area.position.x + ((area.size.width - ow) / 2) as i32,
        area.position.y + ((area.size.height - oh) / 2) as i32,
    ))?;
    if width >= 3200.0 && height >= 1700.0 {
        w.set_zoom(1.5)?;
    }
    Ok(())
}

/// Versi baru untuk halaman: nomor versinya dan versi yang terpasang.
#[derive(serde::Serialize)]
struct Update {
    version: String,
    current: String,
}

/// Versi baru di `latest.json` rilis GitHub terbaru (`plugins.updater` di tauri.conf.json), atau `None`.
/// Build debug (`tauri dev`) tidak pernah diperbarui: ia tidak terpasang sebagai aplikasi.
#[tauri::command]
async fn check_update(app: AppHandle) -> Res<Option<Update>> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let u = app.updater().map_err(err)?.check().await.map_err(err)?;
    Ok(u.map(|u| Update { version: u.version, current: u.current_version }))
}

/// Unduh versi baru, periksa tanda tangannya dengan `pubkey`, pasang, lalu mulai ulang. Windows: installer
/// NSIS menutup aplikasi sendiri dan membukanya lagi setelah selesai.
#[tauri::command]
async fn install_update(app: AppHandle) -> Res<()> {
    let u = app.updater().map_err(err)?.check().await.map_err(err)?.ok_or("tidak ada versi baru")?;
    u.download_and_install(|_, _| {}, || {}).await.map_err(err)?;
    // lewat event Exit, supaya kunci satu-instans dilepas sebelum aplikasi baru hidup
    app.request_restart();
    Ok(())
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        // harus pertama: membuka aplikasi lagi cukup memunculkan jendela yang ada (satu server per PC)
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_autostart::Builder::new().arg(AUTOSTART_ARG).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // hanya build rilis: `tauri dev` tidak mendaftarkan dirinya sebagai program login
            // ponytail: autostart selalu dinyalakan; tambah tombol matikan bila ada yang minta
            if !cfg!(debug_assertions)
                && let Err(e) = app.autolaunch().enable()
            {
                eprintln!("autostart: {e}");
            }
            let cfg = Config::load(&app.path().app_data_dir()?)?;
            // Windows: aplikasi lama (mulai ulang setelah pulihkan) mungkin masih memegang database sebentar
            for i in 0.. {
                match apply_restore(&cfg.dir, &cfg.db) {
                    Err(e) if i < 20 => {
                        eprintln!("pulihkan: {e}, dicoba lagi");
                        std::thread::sleep(std::time::Duration::from_millis(500));
                    }
                    r => {
                        // gagal: tetap jalan dengan data sekarang; file yang disiapkan dicoba lagi saat start berikutnya
                        if let Err(e) = r {
                            eprintln!("pulihkan gagal: {e}");
                        }
                        break;
                    }
                }
            }
            println!("Folder data {}\n\n{}", cfg.dir.display(), freedom_finger::banner(&cfg));
            app.manage(Server { url: format!("http://localhost:{}", cfg.port), port: cfg.port, token: cfg.token.clone() });
            app.manage(Paths { dir: cfg.dir.clone(), db: cfg.db.clone() });
            tauri::async_runtime::spawn(async move {
                // setelah mulai ulang (pulihkan backup), aplikasi lama mungkin masih memegang port sebentar
                for i in 0.. {
                    match freedom_finger::serve(cfg.clone(), std::future::pending()).await {
                        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse && i < 10 => {
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        }
                        r => {
                            if let Err(e) = r {
                                eprintln!("server absensi gagal: {e}");
                            }
                            break;
                        }
                    }
                }
            });

            let open = MenuItem::with_id(app, "open", "Buka Freedom Finger", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Keluar (absen tidak diterima)", true, None::<&str>)?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().ok_or("ikon aplikasi tidak ada")?)
                .tooltip("Freedom Finger: menerima absen")
                .menu(&Menu::with_items(app, &[&open, &quit])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            if let Some(w) = app.get_webview_window("main")
                && let Err(e) = fit_to_screen(&w)
            {
                eprintln!("ukuran jendela: {e}");
            }
            if !std::env::args().any(|a| a == AUTOSTART_ARG) {
                show(app.handle());
            }
            Ok(())
        })
        .on_window_event(|w, e| {
            // tutup jendela = sembunyikan ke tray; server tetap menerima absen dari mesin
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            server,
            lan_ip,
            load_data,
            save_data,
            save_text,
            save_xlsx,
            default_backup_dir,
            backup,
            restore,
            print,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("aplikasi gagal dijalankan");
}

#[cfg(test)]
mod tests {
    use super::*;
    use freedom_finger::store::Log;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ff-app-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn add_log(db: &Path, scan_date: &str) {
        let log = Log { pin: "2", scan_date, io_mode: 1 << 24, verify_mode: 1 << 28, photo: None };
        Store::open(db).unwrap().insert_logs("MESIN01", [log]).unwrap();
    }

    fn count(db: &Path) -> i64 {
        Store::open(db).unwrap().count_logs("").unwrap()
    }

    #[test]
    fn backup_lalu_pulihkan_kembali_ke_isi_backup() {
        let dir = temp("pulih");
        let p = Paths { dir: dir.clone(), db: dir.join("absensi.db") };
        add_log(&p.db, "2026-09-29 08:00:00");
        fs::write(dir.join(DATA_FILE), r#"{"office":"lama","backup":{"last":"2026-09-28 08:00"},"auth":{"hash":"lama"}}"#).unwrap();
        let folder = dir.join("backup");
        // 31 backup lama: setelah backup baru, tinggal 30 tanggal terbaru
        fs::create_dir_all(&folder).unwrap();
        for d in 1..=31 {
            fs::write(folder.join(format!("freedom-finger-2026-08-{d:02}.db")), "").unwrap();
        }
        let file = backup_into(&p, &folder, "2026-09-29").unwrap();
        assert_eq!(fs::read_dir(&folder).unwrap().filter(|e| e.as_ref().unwrap().path().extension().unwrap() == "db").count(), 30);
        assert!(!folder.join("freedom-finger-2026-08-02.db").exists() && folder.join("freedom-finger-2026-08-03.db").exists());
        assert!(fs::read_to_string(folder.join("aplikasi-2026-09-29.json")).unwrap().contains(r#""office":"lama""#));

        // data berubah sesudah backup, lalu dipulihkan
        add_log(&p.db, "2026-09-29 17:00:00");
        fs::write(dir.join(DATA_FILE), r#"{"office":"baru","backup":{"last":"2026-09-29 09:00"},"auth":{"hash":"baru"}}"#).unwrap();
        stage_restore(&p, &file).unwrap();
        assert_eq!(count(&p.db), 2); // belum dipasang sampai start berikutnya
        apply_restore(&p.dir, &p.db).unwrap();
        assert_eq!(count(&p.db), 1);
        // isi dari backup, pengaturan backup dan kata sandi dari PC ini
        let restored: Value = serde_json::from_str(&fs::read_to_string(dir.join(DATA_FILE)).unwrap()).unwrap();
        assert_eq!((&restored["office"], &restored["backup"]["last"]), (&Value::from("lama"), &Value::from("2026-09-29 09:00")));
        assert_eq!(restored["auth"]["hash"], "baru");
        assert_eq!(count(&dir.join("absensi-sebelum-pulih.db")), 2);
        apply_restore(&p.dir, &p.db).unwrap(); // tidak ada yang disiapkan: tidak berubah
        assert_eq!(count(&p.db), 1);

        // terputus setelah database lama dipindah: percobaan berikutnya tidak menimpa data lama
        stage_restore(&p, &file).unwrap();
        fs::rename(&p.db, dir.join("absensi-sebelum-pulih.db")).unwrap();
        apply_restore(&p.dir, &p.db).unwrap();
        assert_eq!((count(&p.db), count(&dir.join("absensi-sebelum-pulih.db"))), (1, 1));

        // file yang bukan database, atau aplikasi.json yang rusak, ditolak tanpa sisa
        let junk = dir.join("bukan.db");
        fs::write(&junk, "bukan database").unwrap();
        assert!(stage_restore(&p, &junk).is_err());
        fs::write(folder.join("aplikasi-2026-09-29.json"), "{rusak").unwrap();
        assert!(stage_restore(&p, &file).is_err());
        assert!(!suffixed(&p.db, STAGED).exists() && !suffixed(&dir.join(DATA_FILE), STAGED).exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn xlsx_dan_tulis_atomik() {
        let dir = temp("xlsx");
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
        write_atomic(&dir.join("a.json"), b"1").unwrap();
        write_atomic(&dir.join("a.json"), b"2").unwrap();
        assert_eq!(fs::read(dir.join("a.json")).unwrap(), b"2");
        assert!(!dir.join("a.json.tmp").exists());
        println!("xlsx: {}", path.display()); // diperiksa manual: buka di Excel/LibreOffice
    }
}
