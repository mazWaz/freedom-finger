//! `freedom-finger`: FKWEB_TOKEN dan lainnya dari env atau `.env` di direktori kerja (lihat [`Config`]).
//! Menu mesin > Jaringan: Mode Internet, Server IP = IP server, Server Port = 8013, Server Req = Ya.

use freedom_finger::config::Config;
use freedom_finger::http;
use freedom_finger::service::Service;
use freedom_finger::store::Store;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let cfg = Config::from_env()?;
    let svc = Service::new(Store::open(&cfg.db)?, &cfg);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    println!("server absensi di port {}", cfg.port);
    axum::serve(listener, http::router(svc, cfg.token)).await?;
    Ok(())
}
