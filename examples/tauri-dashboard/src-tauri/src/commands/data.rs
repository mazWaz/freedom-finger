use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::State;

use super::{Res, err};

/// Data milik aplikasi (nama lengkap, jam kerja, libur, …), di samping database server. Isinya
/// diatur halaman (`src/lib/data.js`); log mesin tidak pernah diubah aplikasi.
pub const DATA_FILE: &str = "aplikasi.json";

/// Folder data dan database server.
pub struct Paths {
    pub dir: PathBuf,
    pub db: PathBuf,
}

/// Isi `aplikasi.json`; `null` bila belum ada.
#[tauri::command]
pub fn load_data(p: State<'_, Paths>) -> Res<Option<Value>> {
    match fs::read_to_string(p.dir.join(DATA_FILE)) {
        Ok(s) => serde_json::from_str(&s).map(Some).map_err(|e| format!("{DATA_FILE} rusak: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
pub fn save_data(p: State<'_, Paths>, data: Value) -> Res<()> {
    write_atomic(&p.dir.join(DATA_FILE), serde_json::to_string_pretty(&data).map_err(err)?.as_bytes())
}

/// Tulis ke file sementara, pastikan sampai disk, lalu ganti nama: bila PC mati di tengah jalan,
/// file lama tetap utuh.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Res<()> {
    let tmp = suffixed(path, ".tmp");
    let write = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    };
    write().map_err(|e| format!("{}: {e}", path.display()))
}

pub fn suffixed(p: &Path, suffix: &str) -> PathBuf {
    let mut s = OsString::from(p.as_os_str());
    s.push(suffix);
    s.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tulis_atomik_mengganti_isi_tanpa_sisa() {
        let dir = std::env::temp_dir().join(format!("ff-app-{}-atomik", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        write_atomic(&dir.join("a.json"), b"1").unwrap();
        write_atomic(&dir.join("a.json"), b"2").unwrap();
        assert_eq!(fs::read(dir.join("a.json")).unwrap(), b"2");
        assert!(!dir.join("a.json.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
