//! Pengaturan: file [`ENV_FILE`] di folder data, lalu variabel environment (yang menang bila
//! keduanya ada). Tanpa file pun server jalan: token API dibuat otomatis dan disimpan ke file itu.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use jiff::tz::TimeZone;

/// Nama file pengaturan di folder data.
pub const ENV_FILE: &str = "freedom-finger.env";
/// Port bawaan untuk mesin dan API (isian Server Port di menu mesin).
pub const DEFAULT_PORT: u16 = 8013;

#[derive(Debug, Clone)]
pub struct Config {
    /// Folder data: [`ENV_FILE`], database, foto.
    pub dir: PathBuf,
    /// `FKWEB_PORT` (8013): port yang diisi di menu mesin (Server Port) dan untuk API.
    pub port: u16,
    /// `FKWEB_TOKEN` (>= 16 karakter, dibuat otomatis bila kosong): token Bearer untuk `/api/*`.
    pub token: String,
    /// `FKWEB_DB` (absensi.db, relatif ke folder data)
    pub db: PathBuf,
    /// `FKWEB_TZ` (Asia/Jakarta): zona jam dinding mesin.
    pub tz: TimeZone,
    /// `FKWEB_WEBHOOK` (opsional): URL penerima callback bergaya developer.fingerspot.io.
    pub webhook: Option<String>,
    /// `FKWEB_DEVICES` (opsional, pisah koma): hanya cloud_id ini yang diterima.
    pub devices: Option<Vec<String>>,
    /// `FKWEB_PHOTOS` (photos, relatif ke folder data): folder foto absen.
    pub photos: PathBuf,
}

impl Config {
    /// Baca pengaturan untuk folder data `dir`. Folder dibuat, dan token API dibuat lalu disimpan
    /// ke [`ENV_FILE`], bila belum ada.
    pub fn load(dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|e| format!("folder data {}: {e}", dir.display()))?;
        let file = dir.join(ENV_FILE);
        if file.exists() {
            dotenvy::from_path(&file).map_err(|e| format!("{}: {e}", file.display()))?;
        }
        let token = match var("FKWEB_TOKEN") {
            Some(t) if t.len() >= 16 => t,
            Some(_) => return Err(format!("FKWEB_TOKEN minimal 16 karakter ({})", file.display())),
            None => new_token(&file)?,
        };
        let tz = var("FKWEB_TZ").unwrap_or_else(|| "Asia/Jakarta".into());
        let tz = TimeZone::get(&tz).map_err(|e| format!("FKWEB_TZ {tz}: {e}"))?;
        Ok(Self {
            dir: dir.to_owned(),
            port: port(var("FKWEB_PORT"))?,
            token,
            db: dir.join(var("FKWEB_DB").unwrap_or_else(|| "absensi.db".into())),
            tz,
            webhook: var("FKWEB_WEBHOOK"),
            devices: var("FKWEB_DEVICES").map(|d| d.split(',').map(|s| s.trim().to_owned()).collect()),
            photos: dir.join(var("FKWEB_PHOTOS").unwrap_or_else(|| "photos".into())),
        })
    }

    /// Port server tanpa efek samping (tidak membuat folder atau token); bawaan bila file tidak terbaca.
    pub fn port_of(dir: &Path) -> u16 {
        let from_file = || dotenvy::from_path_iter(dir.join(ENV_FILE)).ok()?.flatten().find(|(k, _)| k == "FKWEB_PORT").map(|(_, v)| v);
        port(var("FKWEB_PORT").or_else(from_file)).unwrap_or(DEFAULT_PORT)
    }
}

fn var(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

fn port(v: Option<String>) -> Result<u16, String> {
    v.map_or(Ok(DEFAULT_PORT), |p| p.parse().map_err(|_| format!("FKWEB_PORT tidak valid: {p}")))
}

/// Token acak 48 karakter hex, ditambahkan ke file pengaturan (hanya bisa dibaca pemilik).
fn new_token(file: &Path) -> Result<String, String> {
    let mut b = [0u8; 24];
    getrandom::getrandom(&mut b).map_err(|e| format!("token acak: {e}"))?;
    let token: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let fail = |e: std::io::Error| format!("{}: {e}", file.display());
    let fresh = !file.exists();
    let mut f = fs::OpenOptions::new().create(true).append(true).open(file).map_err(fail)?;
    if fresh {
        writeln!(f, "# Pengaturan Freedom Finger. Daftar variabel: README.md").map_err(fail)?;
    }
    writeln!(f, "\n# Token API, dibuat otomatis. Kirim sebagai header: Authorization: Bearer <token>\nFKWEB_TOKEN={token}")
        .map_err(fail)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(file, fs::Permissions::from_mode(0o600)).map_err(fail)?;
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_dibuat_sekali_lalu_dipakai_ulang() {
        let dir = std::env::temp_dir().join(format!("ff-config-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join(ENV_FILE);
        fs::create_dir_all(&dir).unwrap();
        let t = new_token(&file).unwrap();
        assert_eq!(t.len(), 48);
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.contains(&format!("FKWEB_TOKEN={t}")));
        let read: Vec<_> = dotenvy::from_path_iter(&file).unwrap().flatten().collect();
        assert_eq!(read, [("FKWEB_TOKEN".to_owned(), t.clone())]);
        assert_ne!(new_token(&dir.join("lain.env")).unwrap(), t);
        assert_eq!(Config::port_of(&dir), DEFAULT_PORT);
        fs::remove_dir_all(&dir).unwrap();
    }
}
