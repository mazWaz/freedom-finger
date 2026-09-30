//! Isi JSON pesan FkWeb (format yang disadap dari mesin asli, 29-09-2026).

use serde::{Deserialize, Deserializer, Serialize};

use super::Body;
use super::record::{LOG_SIZE, LogRecord, USER_SIZE, UserEntry, Verify, verify_kinds};
use crate::time::WallTime;

/// Nomor kredensial (`backup_number`).
pub mod backup_number {
    /// 0-9 = jari ke-0 sampai ke-9.
    pub const FINGER_LAST: u8 = 9;
    /// Password angka (biner = ASCII tanpa NUL).
    pub const PASSWORD: u8 = 10;
    /// Nomor kartu RFID (biner = ASCII tanpa NUL).
    pub const CARD: u8 = 11;
    /// Wajah.
    pub const FACE: u8 = 12;
}

/// Nilai `user_privilege` yang diterima mesin.
pub mod privilege {
    /// User biasa (API `privilege` 1).
    pub const USER: &str = "USER";
    /// Admin (API `privilege` 2).
    pub const MANAGER: &str = "MANAGER";
    /// Subadmin (API `privilege` 3), dugaan.
    pub const OPERATOR: &str = "OPERATOR";
}

/// Body `receive_cmd`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Poll {
    /// Nama mesin.
    pub fk_name: Option<String>,
    /// Jam mesin `YYYYMMDDhhmmss` (lihat [`Poll::time`]).
    pub fk_time: Option<String>,
    /// Info firmware, versi data jari/wajah, kredensial yang didukung.
    pub fk_info: Option<serde_json::Value>,
}

impl Poll {
    /// Jam mesin; `None` bila kosong atau tidak valid.
    pub fn time(&self) -> Option<WallTime> {
        WallTime::parse_fk14(self.fk_time.as_deref()?)
    }
}

/// Body `realtime_glog`.
#[derive(Debug, Clone, Deserialize)]
pub struct RealtimeLog {
    /// PIN.
    pub user_id: String,
    /// `YYYYMMDDhhmmss`
    pub io_time: String,
    /// Aksi << 24 (1 masuk, 2 pulang); sama dengan byte 40-43 record log `GET_LOG_DATA`.
    pub io_mode: u32,
    /// Sama dengan byte 44-47 record log `GET_LOG_DATA`.
    pub verify_mode: u32,
    /// `"BIN_1"` bila ada foto absen; di mesin ini selalu `null`.
    pub log_image: Option<String>,
}

impl RealtimeLog {
    /// Jam absen; `None` bila `io_time` tidak valid.
    pub fn time(&self) -> Option<WallTime> {
        WallTime::parse_fk14(&self.io_time)
    }

    /// 1 = masuk, 2 = pulang.
    pub fn action(&self) -> u8 {
        (self.io_mode >> 24) as u8
    }

    /// Cara verifikasi, urut seperti di mesin.
    pub fn verify(&self) -> Vec<Verify> {
        verify_kinds(self.verify_mode)
    }
}

/// Satu kredensial user: `enroll_data` merujuk biner (`"BIN_n"`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Enroll {
    /// Jenis kredensial (lihat [`backup_number`]).
    pub backup_number: u8,
    /// Rujukan biner: `"BIN_n"`.
    pub enroll_data: String,
}

/// Data user: hasil `GET_USER_INFO`, isi `realtime_enroll_data`, dan parameter `SET_USER_INFO`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserInfo {
    /// PIN.
    pub user_id: String,
    /// Nama (mesin memotong di 15 karakter).
    #[serde(default)]
    pub user_name: String,
    /// Lihat [`privilege`].
    #[serde(default)]
    pub user_privilege: String,
    /// Status aktif dari mesin (`"ON"` untuk user aktif).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enable_flag: Option<String>,
    /// Mesin mengirim `null` bila belum ada kredensial.
    #[serde(default, deserialize_with = "null_as_empty")]
    pub enroll_data_array: Vec<Enroll>,
    /// Foto profil (`"BIN_n"`), bila ada.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_photo: Option<String>,
}

impl UserInfo {
    /// Kredensial nomor tertentu (lihat [`backup_number`]) dari body yang sama.
    pub fn credential<'a>(&self, body: &'a Body, number: u8) -> Option<&'a [u8]> {
        body.bin(&self.enroll_data_array.iter().find(|e| e.backup_number == number)?.enroll_data)
    }

    /// Jumlah jari terdaftar.
    pub fn finger_count(&self) -> usize {
        self.enroll_data_array.iter().filter(|e| e.backup_number <= backup_number::FINGER_LAST).count()
    }

    /// Jumlah wajah terdaftar (0 atau 1).
    pub fn face_count(&self) -> usize {
        self.enroll_data_array.iter().filter(|e| e.backup_number == backup_number::FACE).count()
    }
}

/// Hasil `GET_USER_ID_LIST`: record 36 byte per user ([`UserEntry`]).
#[derive(Debug, Clone, Deserialize)]
pub struct UserIdList {
    /// Ukuran satu record (36).
    #[serde(default = "user_size")]
    pub one_user_id_size: usize,
    /// Jumlah user.
    pub user_id_count: usize,
}

impl UserIdList {
    /// Daftar user dari biner pertama.
    pub fn users(&self, body: &Body) -> Vec<UserEntry> {
        let size = self.one_user_id_size.max(USER_SIZE);
        body.bins.first().map_or_else(Vec::new, |b| b.chunks_exact(size).filter_map(UserEntry::parse).collect())
    }
}

/// Hasil `GET_LOG_DATA`: semua log, record 48 byte ([`LogRecord`]).
#[derive(Debug, Clone, Deserialize)]
pub struct LogData {
    /// Jumlah log.
    pub log_count: usize,
    /// Ukuran satu record; 48 di mesin ini.
    pub one_log_size: usize,
}

impl LogData {
    /// Kosong bila ukuran record bukan 48 (format yang belum dikenal).
    pub fn logs(&self, body: &Body) -> Vec<LogRecord> {
        match (self.one_log_size, body.bins.first()) {
            (LOG_SIZE, Some(b)) => b.chunks_exact(LOG_SIZE).filter_map(LogRecord::parse).collect(),
            _ => Vec::new(),
        }
    }
}

fn user_size() -> usize {
    USER_SIZE
}

fn null_as_empty<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Vec<T>, D::Error> {
    Ok(Option::<Vec<T>>::deserialize(d)?.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_info_asli_dari_mesin() {
        let body = Body::new(
            r#"{"enable_flag":"ON","enroll_data_array":[{"backup_number":0,"enroll_data":"BIN_1"},{"backup_number":10,"enroll_data":"BIN_2"}],"user_id":"5","user_name":"Siti","user_privilege":"MANAGER"}"#,
            vec![vec![7; 800], b"123".to_vec()],
        );
        let u: UserInfo = body.parse().unwrap();
        assert_eq!((u.finger_count(), u.face_count()), (1, 0));
        assert_eq!(u.credential(&body, backup_number::PASSWORD), Some(b"123".as_slice()));
        let kosong: UserInfo = Body::new(r#"{"enroll_data_array":null,"user_id":"1"}"#, vec![]).parse().unwrap();
        assert!(kosong.enroll_data_array.is_empty());
    }

    #[test]
    fn log_realtime() {
        let body = Body::new(
            r#"{"fk_bin_data_lib":"FKDataHS103","io_mode":33554432,"io_time":"20260331180326","log_image":null,"user_id":"13","verify_mode":268435456}"#,
            vec![],
        );
        let l: RealtimeLog = body.parse().unwrap();
        assert_eq!((l.action(), l.verify(), l.time().unwrap().to_string()), (2, vec![Verify::Finger], "2026-03-31 18:03:26".into()));
    }
}
