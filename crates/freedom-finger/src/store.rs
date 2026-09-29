//! Penyimpanan SQLite. Satu-satunya modul yang berisi SQL; skema sama dengan versi TypeScript
//! sebelumnya, jadi `absensi.db` lama bisa langsung dipakai.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

pub use rusqlite::Error;
pub type Result<T> = rusqlite::Result<T>;

#[derive(Debug)]
pub struct Store {
    db: Connection,
}

/// Satu perintah di antrean.
#[derive(Debug, Clone)]
pub struct Queued {
    pub trans_id: String,
    pub cmd_code: String,
    pub param: Vec<u8>,
}

/// Satu log absensi.
#[derive(Debug, Clone)]
pub struct Log<'a> {
    pub pin: &'a str,
    pub scan_date: &'a str,
    pub io_mode: u32,
    pub verify_mode: u32,
    pub photo: Option<&'a str>,
}

/// Baris `devices`: data poll terakhir mesin.
#[derive(Debug, Clone)]
pub struct Device {
    pub name: Option<String>,
    /// JSON `fk_info`
    pub info: Option<String>,
    /// Jam mesin `YYYYMMDDhhmmss`
    pub fk_time: Option<String>,
    pub last_activity: Option<String>,
}

/// Cadangan user: body FkWeb utuh (JSON + foto/jari/wajah) terakhir.
#[derive(Debug, Clone)]
pub struct Backup {
    pub name: String,
    /// Hak akses FkWeb (`USER`/`MANAGER`/`OPERATOR`)
    pub privilege: String,
    pub data: Vec<u8>,
    pub updated: String,
}

impl Store {
    /// Buka (atau buat) database. `":memory:"` untuk uji.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS devices (cloud_id TEXT PRIMARY KEY, name TEXT, info TEXT, fk_time TEXT, last_activity TEXT);
             CREATE TABLE IF NOT EXISTS logs (cloud_id TEXT, pin TEXT, scan_date TEXT, verify INT, status_scan INT, io_mode INT,
               verify_mode INT, photo TEXT, PRIMARY KEY (cloud_id, pin, scan_date));
             CREATE TABLE IF NOT EXISTS cmds (trans_id TEXT PRIMARY KEY, cloud_id TEXT, type TEXT, cmd_code TEXT, param BLOB,
               status TEXT DEFAULT 'pending', result_code TEXT, data TEXT, created TEXT, sent TEXT, done TEXT);
             CREATE TABLE IF NOT EXISTS users (cloud_id TEXT, pin TEXT, name TEXT, privilege TEXT, data BLOB, updated TEXT,
               PRIMARY KEY (cloud_id, pin));",
        )?;
        Ok(Self { db })
    }

    // --- mesin -------------------------------------------------------------------------------

    pub fn touch_device(&self, dev: &str, now: &str) -> Result<()> {
        self.db.execute(
            "INSERT INTO devices (cloud_id, last_activity) VALUES (?1, ?2)
             ON CONFLICT(cloud_id) DO UPDATE SET last_activity = excluded.last_activity",
            params![dev, now],
        )?;
        Ok(())
    }

    pub fn update_poll(&self, dev: &str, name: Option<&str>, info: &Value, fk_time: Option<&str>) -> Result<()> {
        self.db.execute(
            "UPDATE devices SET name = ?1, info = ?2, fk_time = ?3 WHERE cloud_id = ?4",
            params![name, info.to_string(), fk_time, dev],
        )?;
        Ok(())
    }

    pub fn device(&self, dev: &str) -> Result<Option<Device>> {
        self.db
            .query_row("SELECT name, info, fk_time, last_activity FROM devices WHERE cloud_id = ?1", [dev], |r| {
                Ok(Device { name: r.get(0)?, info: r.get(1)?, fk_time: r.get(2)?, last_activity: r.get(3)? })
            })
            .optional()
    }

    /// Semua mesin yang pernah terhubung, urut Cloud ID.
    pub fn device_list(&self) -> Result<Vec<(String, Device)>> {
        let mut q = self.db.prepare("SELECT cloud_id, name, info, fk_time, last_activity FROM devices ORDER BY cloud_id")?;
        let rows = q.query_map([], |r| {
            Ok((r.get(0)?, Device { name: r.get(1)?, info: r.get(2)?, fk_time: r.get(3)?, last_activity: r.get(4)? }))
        })?;
        rows.collect()
    }

    // --- log ---------------------------------------------------------------------------------

    /// Simpan log; `true` bila baru (log ganda diabaikan). `verify` dan `status_scan` mengikuti API
    /// developer.fingerspot.io: nibble teratas `verify_mode`, dan aksi - 1 (0 masuk, 1 pulang).
    pub fn insert_log(&self, dev: &str, l: &Log<'_>) -> Result<bool> {
        let n = self.db.execute(
            "INSERT OR IGNORE INTO logs (cloud_id, pin, scan_date, verify, status_scan, io_mode, verify_mode, photo)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![dev, l.pin, l.scan_date, l.verify_mode >> 28, i64::from(l.io_mode >> 24) - 1, l.io_mode, l.verify_mode, l.photo],
        )?;
        Ok(n > 0)
    }

    /// Simpan banyak log dalam satu transaksi (`GET_LOG_DATA` bisa ribuan record); jumlah yang baru.
    pub fn insert_logs<'a>(&self, dev: &str, logs: impl IntoIterator<Item = Log<'a>>) -> Result<usize> {
        let tx = self.db.unchecked_transaction()?;
        let mut added = 0;
        for l in logs {
            added += usize::from(self.insert_log(dev, &l)?);
        }
        tx.commit()?;
        Ok(added)
    }

    /// Jumlah log dengan `scan_date >= since` (`""` = semua).
    pub fn count_logs(&self, since: &str) -> Result<i64> {
        self.db.query_row("SELECT COUNT(*) FROM logs WHERE scan_date >= ?1", [since], |r| r.get(0))
    }

    /// Log antara dua tanggal `YYYY-MM-DD` (inklusif), bentuk data `get_attlog`.
    pub fn logs(&self, dev: &str, start: &str, end: &str) -> Result<Vec<Value>> {
        let mut q = self.db.prepare(
            "SELECT pin, scan_date, verify, status_scan, photo FROM logs
             WHERE cloud_id = ?1 AND scan_date >= ?2 AND scan_date <= ?3 ORDER BY scan_date",
        )?;
        let rows = q.query_map(params![dev, start, format!("{end} 23:59:59")], |r| {
            let mut v = json!({ "pin": r.get::<_, String>(0)?, "scan_date": r.get::<_, String>(1)?,
                                "verify": r.get::<_, i64>(2)?, "status_scan": r.get::<_, i64>(3)? });
            if let Some(p) = r.get::<_, Option<String>>(4)? {
                v["photo"] = p.into();
            }
            Ok(v)
        })?;
        rows.collect()
    }

    // --- cadangan user -----------------------------------------------------------------------

    /// Body FkWeb utuh (JSON + foto/jari/wajah) terakhir untuk user ini.
    pub fn save_backup(&self, dev: &str, pin: &str, name: &str, privilege: &str, raw: &[u8], now: &str) -> Result<()> {
        self.db.execute(
            "INSERT INTO users VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(cloud_id, pin)
             DO UPDATE SET name = excluded.name, privilege = excluded.privilege, data = excluded.data, updated = excluded.updated",
            params![dev, pin, name, privilege, raw, now],
        )?;
        Ok(())
    }

    pub fn backup(&self, dev: &str, pin: &str) -> Result<Option<Backup>> {
        self.db
            .query_row("SELECT name, privilege, data, updated FROM users WHERE cloud_id = ?1 AND pin = ?2", [dev, pin], |r| {
                Ok(Backup { name: r.get(0)?, privilege: r.get(1)?, data: r.get(2)?, updated: r.get(3)? })
            })
            .optional()
    }

    // --- antrean perintah --------------------------------------------------------------------

    /// Tambah perintah; `false` bila `trans_id` sudah dipakai.
    pub fn enqueue(&self, dev: &str, trans: &str, kind: &str, cmd_code: &str, param: &[u8], now: &str) -> Result<bool> {
        let n = self.db.execute(
            "INSERT OR IGNORE INTO cmds (trans_id, cloud_id, type, cmd_code, param, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![trans, dev, kind, cmd_code, param, now],
        )?;
        Ok(n > 0)
    }

    pub fn next_pending(&self, dev: &str) -> Result<Option<Queued>> {
        self.db
            .query_row(
                "SELECT trans_id, cmd_code, param FROM cmds WHERE cloud_id = ?1 AND status = 'pending' ORDER BY rowid LIMIT 1",
                [dev],
                |r| Ok(Queued { trans_id: r.get(0)?, cmd_code: r.get(1)?, param: r.get::<_, Option<Vec<u8>>>(2)?.unwrap_or_default() }),
            )
            .optional()
    }

    /// `SET_TIME` yang masih menunggu/terkirim (supaya jam otomatis tidak menumpuk).
    pub fn set_time_in_flight(&self, dev: &str) -> Result<bool> {
        self.db
            .query_row("SELECT 1 FROM cmds WHERE cloud_id = ?1 AND cmd_code = 'SET_TIME' AND status IN ('pending', 'sent')", [dev], |_| {
                Ok(())
            })
            .optional()
            .map(|r| r.is_some())
    }

    pub fn mark_sent(&self, trans: &str, now: &str) -> Result<()> {
        self.db.execute("UPDATE cmds SET status = 'sent', sent = ?1 WHERE trans_id = ?2", params![now, trans])?;
        Ok(())
    }

    pub fn mark_done(&self, trans: &str, result_code: &str, data: &Value, now: &str) -> Result<()> {
        self.db.execute(
            "UPDATE cmds SET status = 'done', result_code = ?1, data = ?2, done = ?3, sent = COALESCE(sent, ?3) WHERE trans_id = ?4",
            params![result_code, data.to_string(), now, trans],
        )?;
        Ok(())
    }

    /// Jenis perintah (nama endpoint API) milik mesin ini.
    pub fn cmd_kind(&self, dev: &str, trans: &str) -> Result<Option<String>> {
        self.db.query_row("SELECT type FROM cmds WHERE trans_id = ?1 AND cloud_id = ?2", [trans, dev], |r| r.get(0)).optional()
    }

    /// Perintah terkirim sebelum `before` tanpa hasil = timeout (mesin diam untuk perintah/PIN yang tidak dikenal).
    pub fn expire_sent(&self, before: &str) -> Result<()> {
        self.db.execute("UPDATE cmds SET status = 'timeout' WHERE status = 'sent' AND sent < ?1", [before])?;
        Ok(())
    }

    /// Bentuk data `get_result`.
    pub fn result(&self, dev: &str, trans: &str) -> Result<Option<Value>> {
        self.db
            .query_row(
                "SELECT trans_id, type, cmd_code, status, result_code, data, created, sent, done FROM cmds
                 WHERE trans_id = ?1 AND cloud_id = ?2",
                [trans, dev],
                |r| {
                    let data: Option<String> = r.get(5)?;
                    Ok(json!({
                        "success": true, "trans_id": r.get::<_, String>(0)?, "type": r.get::<_, String>(1)?,
                        "cmd_code": r.get::<_, String>(2)?, "status": r.get::<_, String>(3)?,
                        "result_code": r.get::<_, Option<String>>(4)?,
                        "data": data.and_then(|d| serde_json::from_str::<Value>(&d).ok()),
                        "created": r.get::<_, Option<String>>(6)?, "sent": r.get::<_, Option<String>>(7)?,
                        "done": r.get::<_, Option<String>>(8)?,
                    }))
                },
            )
            .optional()
    }
}
