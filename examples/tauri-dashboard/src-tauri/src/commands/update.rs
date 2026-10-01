use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use super::{Res, err};

/// Versi baru untuk halaman: nomor versinya dan versi yang terpasang.
#[derive(serde::Serialize)]
pub struct Update {
    version: String,
    current: String,
}

/// Versi baru di `latest.json` rilis GitHub terbaru (`plugins.updater` di tauri.conf.json), atau `None`.
/// Build debug (`tauri dev`) tidak pernah diperbarui: ia tidak terpasang sebagai aplikasi.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Res<Option<Update>> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let u = app.updater().map_err(err)?.check().await.map_err(err)?;
    Ok(u.map(|u| Update { version: u.version, current: u.current_version }))
}

/// Unduh versi baru, periksa tanda tangannya dengan `pubkey`, pasang, lalu mulai ulang. Windows: installer
/// NSIS menutup aplikasi sendiri dan membukanya lagi setelah selesai.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Res<()> {
    let u = app.updater().map_err(err)?.check().await.map_err(err)?.ok_or("tidak ada versi baru")?;
    u.download_and_install(|_, _| {}, || {}).await.map_err(err)?;
    // lewat event Exit, supaya kunci satu-instans dilepas sebelum aplikasi baru hidup
    app.request_restart();
    Ok(())
}
