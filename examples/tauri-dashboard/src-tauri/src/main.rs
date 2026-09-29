//! Freedom Finger untuk pengguna akhir: server absensi (mesin mengirim ke port 8013) dan dashboard
//! dalam satu aplikasi, sekaligus contoh pemakaian SDK. PC tidak menyala 24 jam, jadi aplikasi
//! jalan sendiri saat login dan tetap hidup di tray walau jendelanya ditutup; absen selama PC mati
//! disusul lewat `sync_attlog` saat start (`src/main.js`). Data di folder data aplikasi;
//! `FKWEB_PORT` dll. tetap berlaku.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use freedom_finger::config::Config;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

/// Argumen saat dijalankan otomatis ketika login: mulai di tray, tanpa jendela.
const AUTOSTART_ARG: &str = "--tray";

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
        .setup(|app| {
            // hanya build rilis: `tauri dev` tidak mendaftarkan dirinya sebagai program login
            // ponytail: autostart selalu dinyalakan; tambah tombol matikan bila ada yang minta
            if !cfg!(debug_assertions)
                && let Err(e) = app.autolaunch().enable()
            {
                eprintln!("autostart: {e}");
            }
            let cfg = Config::load(&app.path().app_data_dir()?)?;
            println!("Folder data {}\n\n{}", cfg.dir.display(), freedom_finger::banner(&cfg));
            app.manage(Server { url: format!("http://localhost:{}", cfg.port), port: cfg.port, token: cfg.token.clone() });
            tauri::async_runtime::spawn(async move {
                if let Err(e) = freedom_finger::serve(cfg, std::future::pending()).await {
                    eprintln!("server absensi gagal: {e}");
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
        .invoke_handler(tauri::generate_handler![server, lan_ip])
        .run(tauri::generate_context!())
        .expect("aplikasi gagal dijalankan");
}
