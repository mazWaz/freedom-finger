use serde_json::json;

use super::{Body, UserInfo};
use crate::time::WallTime;

/// Perintah server → mesin (jawaban `receive_cmd`). Semua terbukti di mesin asli (29-09-2026).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Daftar PIN; hasil [`super::UserIdList`].
    GetUserIdList,
    /// Data satu user; hasil [`UserInfo`] + biner. PIN yang tidak ada **tidak dijawab**.
    GetUserInfo {
        /// PIN.
        user_id: String,
    },
    /// Ganti **seluruh** data user: kredensial yang tidak dikirim ikut terhapus.
    SetUserInfo {
        /// Data user (nama, hak akses, daftar kredensial).
        info: UserInfo,
        /// Biner yang dirujuk `enroll_data`/`user_photo` sebagai `"BIN_n"`, berurutan.
        bins: Vec<Vec<u8>>,
    },
    /// Hapus satu user beserta semua kredensialnya.
    DeleteUser {
        /// PIN.
        user_id: String,
    },
    /// Tampilkan layar daftar jari/wajah untuk PIN ini (fitur "Register Online").
    /// Hasil pendaftaran datang belakangan sebagai `realtime_enroll_data`.
    EnterEnroll {
        /// PIN.
        user_id: String,
        /// Kredensial yang didaftarkan (lihat [`super::backup_number`]).
        backup_number: u8,
    },
    /// Setel jam dinding mesin.
    SetTime(WallTime),
    /// Restart; mesin **tidak mengirim hasil**.
    Restart,
    /// Semua log; hasil [`super::LogData`].
    GetLogData,
}

impl Command {
    /// Nilai header `cmd_code`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::GetUserIdList => "GET_USER_ID_LIST",
            Self::GetUserInfo { .. } => "GET_USER_INFO",
            Self::SetUserInfo { .. } => "SET_USER_INFO",
            Self::DeleteUser { .. } => "DELETE_USER",
            Self::EnterEnroll { .. } => "SET_COMMAND",
            Self::SetTime(_) => "SET_TIME",
            Self::Restart => "RESET_FK",
            Self::GetLogData => "GET_LOG_DATA",
        }
    }

    /// Body jawaban (parameter perintah).
    pub fn body(&self) -> Body {
        match self {
            Self::GetUserIdList | Self::Restart | Self::GetLogData => Body::default(),
            Self::GetUserInfo { user_id } | Self::DeleteUser { user_id } => Body::from_json(&json!({ "user_id": user_id }), vec![]),
            Self::SetUserInfo { info, bins } => Body::from_json(info, bins.clone()),
            Self::EnterEnroll { user_id, backup_number } => {
                Body::from_json(&json!({ "cmd": "enter_enroll", "param": { "user_id": user_id, "backup_number": backup_number } }), vec![])
            }
            Self::SetTime(t) => Body::from_json(&json!({ "time": t.fk14() }), vec![]),
        }
    }

    /// `false` untuk perintah yang tidak dibalas mesin.
    pub fn expects_result(&self) -> bool {
        !matches!(self, Self::Restart)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perintah_sama_dengan_hasil_sadapan() {
        let enroll = Command::EnterEnroll { user_id: "2".into(), backup_number: 0 };
        assert_eq!(enroll.code(), "SET_COMMAND");
        assert_eq!(enroll.body().json, r#"{"cmd":"enter_enroll","param":{"backup_number":0,"user_id":"2"}}"#);
        assert_eq!(enroll.body().encode()[..4], [0x41, 0, 0, 0]);
        let t = Command::SetTime(WallTime::parse_fk14("20260929131140").unwrap());
        assert_eq!(t.body().json, r#"{"time":"20260929131140"}"#);
        assert!(Command::GetLogData.body().encode().is_empty());
        let info = UserInfo { user_id: "99999".into(), user_name: "Tes".into(), user_privilege: "USER".into(), ..Default::default() };
        assert_eq!(
            Command::SetUserInfo { info, bins: vec![] }.body().json,
            r#"{"user_id":"99999","user_name":"Tes","user_privilege":"USER","enroll_data_array":[]}"#
        );
    }
}
