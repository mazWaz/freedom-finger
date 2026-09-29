//! Konfigurasi dari environment (dan `.env` di direktori kerja).

use std::path::PathBuf;

use jiff::tz::TimeZone;

#[derive(Debug, Clone)]
pub struct Config {
    /// `FKWEB_PORT` (8013): port yang diisi di menu mesin (Server Port) dan untuk API.
    pub port: u16,
    /// `FKWEB_TOKEN` (wajib, >= 16 karakter): token Bearer untuk `/api/*`.
    pub token: String,
    /// `FKWEB_DB` (absensi.db)
    pub db: String,
    /// `FKWEB_TZ` (Asia/Jakarta): zona jam dinding mesin.
    pub tz: TimeZone,
    /// `FKWEB_WEBHOOK` (opsional): URL penerima callback bergaya developer.fingerspot.io.
    pub webhook: Option<String>,
    /// `FKWEB_DEVICES` (opsional, pisah koma): hanya cloud_id ini yang diterima.
    pub devices: Option<Vec<String>>,
    /// `FKWEB_PHOTOS` (photos): folder foto absen.
    pub photos: PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let token = var("FKWEB_TOKEN").filter(|t| t.len() >= 16).ok_or("isi FKWEB_TOKEN (minimal 16 karakter) di .env")?;
        let port = match var("FKWEB_PORT") {
            Some(p) => p.parse().map_err(|_| format!("FKWEB_PORT tidak valid: {p}"))?,
            None => 8013,
        };
        let tz = var("FKWEB_TZ").unwrap_or_else(|| "Asia/Jakarta".into());
        let tz = TimeZone::get(&tz).map_err(|e| format!("FKWEB_TZ {tz}: {e}"))?;
        Ok(Self {
            port,
            token,
            db: var("FKWEB_DB").unwrap_or_else(|| "absensi.db".into()),
            tz,
            webhook: var("FKWEB_WEBHOOK"),
            devices: var("FKWEB_DEVICES").map(|d| d.split(',').map(|s| s.trim().to_owned()).collect()),
            photos: var("FKWEB_PHOTOS").unwrap_or_else(|| "photos".into()).into(),
        })
    }
}
