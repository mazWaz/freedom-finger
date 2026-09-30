//! SDK mesin absensi **Fingerspot Revo WF-206BNC** (platform SmackBio FK, `CommunicationInterfaceId` 13_1).
//!
//! Protokol [`fkweb`]: mesin di **mode Internet** (menu **Jaringan → Mode**) mengirim ke server lewat
//! HTTP: log realtime, user + template, daftar jari/wajah jarak jauh, dan perintah dari server.
//!
//! Logika protokol tidak melakukan I/O (sans-IO), jadi bisa diuji tanpa mesin. Server HTTP-nya
//! dibangun pemakai, contohnya crate `freedom-finger`.
//!
//! ```
//! use freedom_finger_sdk::fkweb::{Body, Command};
//! let cmd = Command::EnterEnroll { user_id: "2".into(), backup_number: 0 };
//! let param: Vec<u8> = cmd.body().encode(); // body jawaban receive_cmd, header cmd_code = cmd.code()
//! assert_eq!(Body::decode(&param).json, r#"{"cmd":"enter_enroll","param":{"backup_number":0,"user_id":"2"}}"#);
//! ```
//!
//! Spesifikasi protokol dan hasil riset: `docs/protokol.md`, `docs/riset.md`.

#![warn(missing_docs)]

pub mod fkweb;
pub mod time;
