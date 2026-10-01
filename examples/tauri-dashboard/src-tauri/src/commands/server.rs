/// Alamat, port, dan token API untuk halaman.
#[derive(Clone, serde::Serialize)]
pub struct Server {
    pub url: String,
    pub port: u16,
    pub token: String,
}

#[tauri::command]
pub fn server(s: tauri::State<'_, Server>) -> Server {
    s.inner().clone()
}

/// IP LAN komputer ini sekarang = isian Server IP di mesin (berubah bila tidak direservasi di router).
#[tauri::command]
pub fn lan_ip() -> Option<String> {
    freedom_finger::net::lan_ip().map(|ip| ip.to_string())
}
