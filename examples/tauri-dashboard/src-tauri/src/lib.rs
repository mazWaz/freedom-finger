//! Freedom Finger untuk pengguna akhir: server absensi (mesin mengirim ke port 8013) dan aplikasi
//! absensi (riwayat, rekap, export, backup) dalam satu aplikasi, sekaligus contoh pemakaian SDK.
//! PC tidak menyala 24 jam, jadi aplikasi jalan sendiri saat login dan tetap hidup di tray walau
//! jendelanya ditutup; absen selama PC mati disusul lewat `sync_attlog` saat start (`src/main.js`).
//! Data di folder data aplikasi; `FKWEB_PORT` dll. tetap berlaku.
//!
//! Halaman memakai API HTTP server seperti aplikasi lain. Sisi Rust hanya mengerjakan yang tidak
//! bisa dilakukan halaman: `aplikasi.json`, file export, backup/pulihkan, cetak, dan update aplikasi.
//!
//! File ini merakit aplikasi (plugin, server tertanam, tray, jendela); perintah untuk halaman
//! (`invoke`) ada di `commands/`, satu file per topik.

mod commands;

use freedom_finger::config::Config;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

use commands::{backup, data, export, server, update};

/// Argumen saat dijalankan otomatis ketika login: mulai di tray, tanpa jendela.
const AUTOSTART_ARG: &str = "--tray";

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

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
                match backup::apply_restore(&cfg.dir, &cfg.db) {
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
            app.manage(server::Server { url: format!("http://localhost:{}", cfg.port), port: cfg.port, token: cfg.token.clone() });
            app.manage(data::Paths { dir: cfg.dir.clone(), db: cfg.db.clone() });
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
            server::server,
            server::lan_ip,
            data::load_data,
            data::save_data,
            export::save_text,
            export::save_xlsx,
            export::print,
            backup::default_backup_dir,
            backup::backup,
            backup::restore,
            update::check_update,
            update::install_update
        ])
        .run(tauri::generate_context!())
        .expect("aplikasi gagal dijalankan");
}
