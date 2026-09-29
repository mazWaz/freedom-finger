//! Freedom Finger: server absensi lokal pengganti developer.fingerspot.io. Menerima FkWeb dari
//! mesin (mode Internet) dan menyediakan API bergaya developer.fingerspot.io, tanpa cloud.
//!
//! Lapisan: [`store`] (SQL) → [`service`] (logika, tanpa HTTP) → [`http`] (axum). [`config`] dari
//! file pengaturan dan env; [`net`] mencari mesin di jaringan lokal.
//!
//! Server bisa ditanam di aplikasi Rust lain (misalnya Tauri):
//!
//! ```no_run
//! # async fn f() -> Result<(), Box<dyn std::error::Error>> {
//! let cfg = freedom_finger::config::Config::load(std::path::Path::new("data"))?;
//! freedom_finger::serve(cfg, std::future::pending()).await?;
//! # Ok(()) }
//! ```

use std::future::{Future, IntoFuture};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

pub mod config;
pub mod http;
pub mod net;
pub mod service;
pub mod store;

use config::{Config, ENV_FILE};

/// Jalankan server sampai `shutdown` selesai (lalu paling lama 3 detik untuk request yang masih berjalan).
pub async fn serve(cfg: Config, shutdown: impl Future<Output = ()> + Send + 'static) -> std::io::Result<()> {
    let store = store::Store::open(&cfg.db).map_err(|e| std::io::Error::other(format!("{}: {e}", cfg.db.display())))?;
    let svc = service::Service::new(store, &cfg);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    let app = http::router(svc, cfg.token).into_make_service_with_connect_info::<SocketAddr>();
    let stop = Arc::new(tokio::sync::Notify::new());
    let s = stop.clone();
    let server = axum::serve(listener, app).with_graceful_shutdown(async move {
        shutdown.await;
        s.notify_one();
    });
    // koneksi /api/events tidak pernah selesai sendiri, jadi setelah diminta berhenti hanya ditunggu sebentar
    tokio::select! {
        r = server.into_future() => r,
        () = async { stop.notified().await; tokio::time::sleep(Duration::from_secs(3)).await } => Ok(()),
    }
}

/// Petunjuk untuk pengguna: isian menu mesin, alamat halaman status, letak token.
pub fn banner(cfg: &Config) -> String {
    let ip = net::lan_ip().map_or_else(|| "IP komputer ini (lihat ipconfig / ip addr)".to_owned(), |ip| ip.to_string());
    format!(
        "Atur di mesin absensi (Menu → Jaringan):\n  Mode         Internet\n  Server IP    {ip}\n  Server Port  {port}\n  Server Req   Ya\n\n\
         Status     http://localhost:{port}\nToken API  tersimpan di {env}",
        port = cfg.port,
        env = cfg.dir.join(ENV_FILE).display(),
    )
}
