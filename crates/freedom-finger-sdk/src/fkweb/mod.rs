//! Protokol FkWeb (HTTP push), aktif saat mesin di **mode Internet**. Seluruhnya sans-IO: modul ini
//! hanya menyusun dan mengurai; server HTTP-nya dibuat pemakai (lihat crate `freedom-finger`).
//!
//! Alur: mesin `POST /` dengan header `request_code` ([`request_code`]); untuk `receive_cmd` server
//! membalas header `response_code`/`trans_id`/`cmd_code` dan body = parameter perintah ([`Command`]).
//! Spesifikasi lengkap: `docs/protokol.md`.

mod command;
mod message;
pub mod record;

pub use command::Command;
pub use message::{Enroll, LogData, Poll, RealtimeLog, UserIdList, UserInfo, backup_number, privilege};

/// Nilai header `request_code` dari mesin.
pub mod request_code {
    /// Mesin bertanya "ada perintah?" (±20 detik sampai 2 menit sekali).
    pub const RECEIVE_CMD: &str = "receive_cmd";
    /// Hasil perintah; header `trans_id` = perintahnya, `cmd_return_code` = hasil.
    pub const SEND_CMD_RESULT: &str = "send_cmd_result";
    /// Log absen realtime (juga antrean log lama saat pertama tersambung).
    pub const REALTIME_GLOG: &str = "realtime_glog";
    /// Data user/jari/wajah yang baru didaftarkan atau diubah.
    pub const REALTIME_ENROLL_DATA: &str = "realtime_enroll_data";
}

/// Nilai header `response_code` dari server.
pub mod response_code {
    /// Berhasil; untuk `receive_cmd` berarti body berisi perintah.
    pub const OK: &str = "OK";
    /// Jawaban `receive_cmd` bila antrean kosong.
    pub const NO_CMD: &str = "ERROR_NO_CMD";
}

/// Body FkWeb: `u32 LE panjang JSON+NUL | JSON UTF-8 + NUL | [u32 LE panjang | biner]...`.
/// JSON merujuk data biner sebagai `"BIN_1"`, `"BIN_2"`, … sesuai urutan `bins`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Body {
    /// JSON tanpa NUL penutup; kosong bila tidak ada.
    pub json: String,
    /// Blok biner, dirujuk JSON sebagai `"BIN_1"`, `"BIN_2"`, … sesuai urutan.
    pub bins: Vec<Vec<u8>>,
}

impl Body {
    /// Body dari teks JSON dan biner.
    pub fn new(json: impl Into<String>, bins: Vec<Vec<u8>>) -> Self {
        Self { json: json.into(), bins }
    }

    /// Body dari nilai yang bisa diserialisasi ke JSON.
    pub fn from_json<T: serde::Serialize>(value: &T, bins: Vec<Vec<u8>>) -> Self {
        Self::new(serde_json::to_string(value).unwrap_or_default(), bins)
    }

    /// Byte siap kirim. JSON kosong = body kosong (perintah tanpa parameter).
    pub fn encode(&self) -> Vec<u8> {
        if self.json.is_empty() {
            return Vec::new();
        }
        let text_len = self.json.len() + 1;
        let mut out = Vec::with_capacity(4 + text_len + self.bins.iter().map(|b| 4 + b.len()).sum::<usize>());
        out.extend_from_slice(&(text_len as u32).to_le_bytes());
        out.extend_from_slice(self.json.as_bytes());
        out.push(0);
        for b in &self.bins {
            out.extend_from_slice(&(b.len() as u32).to_le_bytes());
            out.extend_from_slice(b);
        }
        out
    }

    /// Urai byte. Yang bukan format FkWeb tidak membuat error: JSON kosong dan byte mentah jadi satu biner.
    pub fn decode(buf: &[u8]) -> Self {
        let n = match buf.get(..4) {
            Some(h) => u32::from_le_bytes([h[0], h[1], h[2], h[3]]) as usize,
            None => return Self { json: String::new(), bins: if buf.is_empty() { vec![] } else { vec![buf.to_vec()] } },
        };
        if n > buf.len() - 4 {
            return Self { json: String::new(), bins: vec![buf.to_vec()] };
        }
        let mut bins = Vec::new();
        let mut p = 4 + n;
        while p + 4 <= buf.len() {
            let len = u32::from_le_bytes([buf[p], buf[p + 1], buf[p + 2], buf[p + 3]]) as usize;
            bins.push(buf[p + 4..(p + 4 + len).min(buf.len())].to_vec());
            p += 4 + len;
        }
        let text = &buf[4..4 + n];
        Self { json: String::from_utf8_lossy(text.strip_suffix(&[0]).unwrap_or(text)).into_owned(), bins }
    }

    /// Biner yang dirujuk `"BIN_n"`.
    pub fn bin(&self, name: &str) -> Option<&[u8]> {
        let n: usize = name.strip_prefix("BIN_")?.parse().ok()?;
        self.bins.get(n.checked_sub(1)?).map(Vec::as_slice)
    }

    /// Urai JSON ke tipe pesan ([`Poll`], [`RealtimeLog`], [`UserInfo`], …).
    pub fn parse<T: serde::de::DeserializeOwned>(&self) -> serde_json::Result<T> {
        serde_json::from_str(if self.json.is_empty() { "{}" } else { &self.json })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_json_nul_lalu_biner() {
        // SET_TIME seperti MakeSetTimeCmdParamBin di InjesApp: 25 byte JSON + NUL
        let b = Body::new(r#"{"time":"20260929020000"}"#, vec![]).encode();
        assert_eq!(b[..4], [0x1a, 0, 0, 0]);
        assert_eq!(b.last(), Some(&0));
        assert_eq!(Body::decode(&b), Body::new(r#"{"time":"20260929020000"}"#, vec![]));
        let with_bin = Body::new(r#"{"time":"20260929020000"}"#, vec![vec![1, 2, 3]]);
        assert_eq!(with_bin.encode(), [b.as_slice(), &[3, 0, 0, 0, 1, 2, 3]].concat());
        assert_eq!(Body::decode(&with_bin.encode()).bin("BIN_1"), Some([1, 2, 3].as_slice()));
        // bukan format FkWeb: disimpan mentah, tidak panik
        assert_eq!(Body::decode(b"halo"), Body::new("", vec![b"halo".to_vec()]));
        assert!(Body::default().encode().is_empty());
    }
}
