// Titik masuk desktop (template Tauri v2): semua kode aplikasi ada di lib.rs.
// Build rilis Windows tanpa jendela konsol tambahan.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    freedom_finger_tauri_dashboard_lib::run();
}
