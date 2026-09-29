//! Aplikasi ini sekaligus server Freedom Finger (mesin mengirim ke port 8013) dan dashboard.
//! Data (pengaturan, token, database) ada di folder data aplikasi; `FKWEB_PORT` dll. tetap berlaku.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use freedom_finger::config::Config;
use tauri::Manager;

/// Alamat dan token API untuk halaman.
#[derive(Clone, serde::Serialize)]
struct Server {
    url: String,
    token: String,
}

#[tauri::command]
fn server(s: tauri::State<'_, Server>) -> Server {
    s.inner().clone()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let cfg = Config::load(&app.path().app_data_dir()?)?;
            println!("Folder data {}\n\n{}", cfg.dir.display(), freedom_finger::banner(&cfg));
            app.manage(Server { url: format!("http://localhost:{}", cfg.port), token: cfg.token.clone() });
            tauri::async_runtime::spawn(async move {
                if let Err(e) = freedom_finger::serve(cfg, std::future::pending()).await {
                    eprintln!("server absensi gagal: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![server])
        .run(tauri::generate_context!())
        .expect("aplikasi gagal dijalankan");
}
