use std::fs;
use std::path::{Path, PathBuf};

use freedom_finger::store::Store;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::data::{DATA_FILE, Paths, suffixed, write_atomic};
use super::{Res, err};

/// Jumlah backup harian yang disimpan di folder backup.
const KEEP_BACKUPS: usize = 30;
/// Akhiran file yang disiapkan `restore`, dipasang saat start berikutnya.
const STAGED: &str = ".pulihkan";

/// Folder backup bawaan: `Freedom Finger Backup` di folder pengguna. Bukan Dokumen, karena di
/// Windows folder itu sering disinkronkan OneDrive, dan backup berisi data jari/wajah.
#[tauri::command]
pub fn default_backup_dir(app: AppHandle) -> Res<PathBuf> {
    Ok(app.path().home_dir().map_err(err)?.join("Freedom Finger Backup"))
}

/// Backup database dan `aplikasi.json` ke `folder`, dengan tanggal `date` (YYYY-MM-DD, jam PC)
/// di nama file; backup hari yang sama ditimpa. Hanya [`KEEP_BACKUPS`] tanggal terakhir disimpan.
#[tauri::command(async)]
pub fn backup(p: State<'_, Paths>, folder: PathBuf, date: String) -> Res<PathBuf> {
    backup_into(&p, &folder, &date)
}

/// Satu backup pada satu waktu (otomatis dan tombol memakai file sementara yang sama).
static BACKUP: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn backup_into(p: &Paths, folder: &Path, date: &str) -> Res<PathBuf> {
    if !is_date(date) {
        return Err(format!("tanggal tidak valid: {date}"));
    }
    let _one = BACKUP.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let db = folder.join(format!("freedom-finger-{date}.db"));
    let tmp = suffixed(&db, ".tmp");
    let _ = fs::remove_file(&tmp); // sisa backup yang terputus
    // VACUUM INTO: aman walau server sedang menerima absen
    Store::open(&p.db).and_then(|s| s.backup_to(&tmp)).map_err(|e| format!("backup database: {e}"))?;
    fs::rename(&tmp, &db).map_err(err)?;
    if let Ok(bytes) = fs::read(p.dir.join(DATA_FILE)) {
        write_atomic(&folder.join(format!("aplikasi-{date}.json")), &bytes)?;
    }
    let mut dates: Vec<String> = fs::read_dir(folder)
        .map_err(err)?
        .flatten()
        .filter_map(|e| Some(e.file_name().to_str()?.strip_prefix("freedom-finger-")?.strip_suffix(".db")?.to_owned()))
        .filter(|d| is_date(d))
        .collect();
    dates.sort_unstable_by(|a, b| b.cmp(a));
    for d in dates.iter().skip(KEEP_BACKUPS) {
        let _ = fs::remove_file(folder.join(format!("freedom-finger-{d}.db")));
        let _ = fs::remove_file(folder.join(format!("aplikasi-{d}.json")));
    }
    Ok(db)
}

/// `YYYY-MM-DD`
fn is_date(s: &str) -> bool {
    s.len() == 10 && s.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() })
}

/// Siapkan pemulihan dari file backup, lalu mulai ulang aplikasi. Database yang sedang dipakai
/// server tidak bisa diganti selagi terbuka, jadi file baru dipasang saat start ([`apply_restore`]).
/// `aplikasi-<tanggal>.json` di samping backup ikut dipulihkan.
#[tauri::command(async)]
pub fn restore(app: AppHandle, p: State<'_, Paths>, file: PathBuf) -> Res<()> {
    stage_restore(&p, &file)?;
    // lewat event Exit, supaya kunci satu-instans dilepas sebelum aplikasi baru hidup
    app.request_restart();
    Ok(())
}

fn stage_restore(p: &Paths, file: &Path) -> Res<()> {
    let (staged_db, staged_json) = (suffixed(&p.db, STAGED), suffixed(&p.dir.join(DATA_FILE), STAGED));
    let r = stage_files(p, file, &staged_db, &staged_json);
    if r.is_err() {
        // tidak ada yang setengah jadi: tanpa ini, pemulihan yang "gagal" terpasang diam-diam saat start berikutnya
        let _ = fs::remove_file(&staged_db);
        let _ = fs::remove_file(&staged_json);
    }
    r
}

fn stage_files(p: &Paths, file: &Path, staged_db: &Path, staged_json: &Path) -> Res<()> {
    // aplikasi.json backup, dengan pengaturan backup PC ini (folder, backup terakhir) dan kata sandi yang
    // sekarang: pengaturan lama membuat backup otomatis hari ini ditimpa isi yang baru dipulihkan, dan
    // kata sandi lama mungkin sudah tidak diingat
    let date = file.file_name().and_then(|n| n.to_str()?.strip_prefix("freedom-finger-")?.strip_suffix(".db").map(str::to_owned));
    let json = date.map(|d| file.with_file_name(format!("aplikasi-{d}.json"))).filter(|j| j.exists());
    let json = match json {
        Some(j) => {
            let mut v: Value = serde_json::from_str(&fs::read_to_string(&j).map_err(err)?).map_err(|e| format!("{}: {e}", j.display()))?;
            let now: Option<Value> = fs::read_to_string(p.dir.join(DATA_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok());
            if let Some(obj) = v.as_object_mut() {
                for key in ["backup", "auth"] {
                    if let Some(x) = now.as_ref().and_then(|n| n.get(key)) {
                        obj.insert(key.into(), x.clone());
                    }
                }
            }
            Some(serde_json::to_string_pretty(&v).map_err(err)?)
        }
        None => None,
    };
    fs::copy(file, staged_db).map_err(|e| format!("{}: {e}", file.display()))?;
    Store::open(staged_db).and_then(|s| s.count_logs("")).map_err(|e| format!("{} bukan backup Freedom Finger: {e}", file.display()))?;
    if let Some(text) = json {
        write_atomic(staged_json, text.as_bytes())?;
    }
    Ok(())
}

/// Nama data lama setelah pulihkan: `absensi-sebelum-pulih.db` (bisa dipilih lagi di Pulihkan).
fn before_restore(db: &Path) -> PathBuf {
    let stem = db.file_stem().map_or_else(|| "absensi".into(), |s| s.to_string_lossy().into_owned());
    db.with_file_name(format!("{stem}-sebelum-pulih.db"))
}

/// Pasang file yang disiapkan [`restore`], sebelum server membuka database. Data lama disimpan
/// sebagai [`before_restore`], bersama jurnal SQLite-nya bila ada. Aman diulang bila terputus di
/// tengah jalan: data lama hanya ditimpa bila database sekarang masih ada.
pub fn apply_restore(dir: &Path, db: &Path) -> std::io::Result<()> {
    let staged = suffixed(db, STAGED);
    if staged.exists() {
        let old = before_restore(db);
        for ext in ["", "-journal", "-wal", "-shm"] {
            let (from, to) = (suffixed(db, ext), suffixed(&old, ext));
            if from.exists() {
                let _ = fs::remove_file(&to);
                fs::rename(from, to)?;
            } else if ext.is_empty() {
                break; // sudah dipindah pada percobaan sebelumnya
            }
        }
        fs::rename(staged, db)?;
    }
    let json = dir.join(DATA_FILE);
    let staged = suffixed(&json, STAGED);
    if staged.exists() {
        fs::rename(staged, json)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use freedom_finger::store::Log;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ff-app-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn add_log(db: &Path, scan_date: &str) {
        let log = Log { pin: "2", scan_date, io_mode: 1 << 24, verify_mode: 1 << 28, photo: None };
        Store::open(db).unwrap().insert_logs("MESIN01", [log]).unwrap();
    }

    fn count(db: &Path) -> i64 {
        Store::open(db).unwrap().count_logs("").unwrap()
    }

    #[test]
    fn backup_lalu_pulihkan_kembali_ke_isi_backup() {
        let dir = temp("pulih");
        let p = Paths { dir: dir.clone(), db: dir.join("absensi.db") };
        add_log(&p.db, "2026-09-29 08:00:00");
        fs::write(dir.join(DATA_FILE), r#"{"office":"lama","backup":{"last":"2026-09-28 08:00"},"auth":{"hash":"lama"}}"#).unwrap();
        let folder = dir.join("backup");
        // 31 backup lama: setelah backup baru, tinggal 30 tanggal terbaru
        fs::create_dir_all(&folder).unwrap();
        for d in 1..=31 {
            fs::write(folder.join(format!("freedom-finger-2026-08-{d:02}.db")), "").unwrap();
        }
        let file = backup_into(&p, &folder, "2026-09-29").unwrap();
        assert_eq!(fs::read_dir(&folder).unwrap().filter(|e| e.as_ref().unwrap().path().extension().unwrap() == "db").count(), 30);
        assert!(!folder.join("freedom-finger-2026-08-02.db").exists() && folder.join("freedom-finger-2026-08-03.db").exists());
        assert!(fs::read_to_string(folder.join("aplikasi-2026-09-29.json")).unwrap().contains(r#""office":"lama""#));

        // data berubah sesudah backup, lalu dipulihkan
        add_log(&p.db, "2026-09-29 17:00:00");
        fs::write(dir.join(DATA_FILE), r#"{"office":"baru","backup":{"last":"2026-09-29 09:00"},"auth":{"hash":"baru"}}"#).unwrap();
        stage_restore(&p, &file).unwrap();
        assert_eq!(count(&p.db), 2); // belum dipasang sampai start berikutnya
        apply_restore(&p.dir, &p.db).unwrap();
        assert_eq!(count(&p.db), 1);
        // isi dari backup, pengaturan backup dan kata sandi dari PC ini
        let restored: Value = serde_json::from_str(&fs::read_to_string(dir.join(DATA_FILE)).unwrap()).unwrap();
        assert_eq!((&restored["office"], &restored["backup"]["last"]), (&Value::from("lama"), &Value::from("2026-09-29 09:00")));
        assert_eq!(restored["auth"]["hash"], "baru");
        assert_eq!(count(&dir.join("absensi-sebelum-pulih.db")), 2);
        apply_restore(&p.dir, &p.db).unwrap(); // tidak ada yang disiapkan: tidak berubah
        assert_eq!(count(&p.db), 1);

        // terputus setelah database lama dipindah: percobaan berikutnya tidak menimpa data lama
        stage_restore(&p, &file).unwrap();
        fs::rename(&p.db, dir.join("absensi-sebelum-pulih.db")).unwrap();
        apply_restore(&p.dir, &p.db).unwrap();
        assert_eq!((count(&p.db), count(&dir.join("absensi-sebelum-pulih.db"))), (1, 1));

        // file yang bukan database, atau aplikasi.json yang rusak, ditolak tanpa sisa
        let junk = dir.join("bukan.db");
        fs::write(&junk, "bukan database").unwrap();
        assert!(stage_restore(&p, &junk).is_err());
        fs::write(folder.join("aplikasi-2026-09-29.json"), "{rusak").unwrap();
        assert!(stage_restore(&p, &file).is_err());
        assert!(!suffixed(&p.db, STAGED).exists() && !suffixed(&dir.join(DATA_FILE), STAGED).exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
