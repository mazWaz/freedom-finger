//! Susunan byte rekaman biner FkWeb: log 48 byte (`GET_LOG_DATA`) dan daftar user 36 byte
//! (`GET_USER_ID_LIST`). Semua fungsi murni (tanpa I/O). Detail offset: `docs/protokol.md`.

use crate::time::WallTime;

/// Ukuran record log.
pub const LOG_SIZE: usize = 48;
/// Ukuran record daftar user.
pub const USER_SIZE: usize = 36;

/// Cara verifikasi (nibble kode verifikasi).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verify {
    /// Sidik jari.
    Finger,
    /// Password.
    Password,
    /// Kartu RFID.
    Card,
    /// Wajah.
    Face,
    /// Kode lain yang belum dikenal.
    Other(u8),
}

impl Verify {
    /// Dari satu nibble kode verifikasi.
    pub fn from_nibble(n: u8) -> Self {
        match n {
            1 => Self::Finger,
            2 => Self::Password,
            3 => Self::Card,
            4 => Self::Face,
            n => Self::Other(n),
        }
    }

    /// Nama Indonesia: jari, password, kartu, wajah.
    pub fn name(self) -> String {
        match self {
            Self::Finger => "jari".into(),
            Self::Password => "password".into(),
            Self::Card => "kartu".into(),
            Self::Face => "wajah".into(),
            Self::Other(n) => format!("jenis{n}"),
        }
    }
}

/// Urai kode verifikasi: nibble dari yang teratas, berhenti di nibble 0. `0x1000_0000` = jari,
/// `0x4000_0000` = wajah, `0x1200_0000` = jari + password. Sama untuk log realtime dan `GET_LOG_DATA`.
pub fn verify_kinds(verify_mode: u32) -> Vec<Verify> {
    (0..8).rev().map(|i| (verify_mode >> (i * 4) & 0xF) as u8).take_while(|&n| n != 0).map(Verify::from_nibble).collect()
}

/// Satu log absensi.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogRecord {
    /// PIN.
    pub pin: String,
    /// Jam dinding mesin.
    pub time: WallTime,
    /// Byte 40-43. Aksi = `io_mode >> 24` (1 masuk, 2 pulang); sama dengan `io_mode` log realtime.
    pub io_mode: u32,
    /// Byte 44-47; sama dengan `verify_mode` log realtime.
    pub verify_mode: u32,
}

impl LogRecord {
    /// Log 48 byte: PIN @0, detik @35, u32 @36 (tahun-1900 bit 2-11, bulan 12-15, tanggal 16-20,
    /// jam 21-25, menit 26-31), io_mode @40, verify_mode @44.
    pub fn parse(r: &[u8]) -> Option<Self> {
        let r: &[u8; LOG_SIZE] = r.get(..LOG_SIZE)?.try_into().ok()?;
        let w = u32_at(r, 36);
        let time = WallTime {
            year: ((w >> 2) & 0x3FF) as u16 + 1900,
            month: ((w >> 12) & 15) as u8,
            day: ((w >> 16) & 31) as u8,
            hour: ((w >> 21) & 31) as u8,
            minute: (w >> 26) as u8,
            second: r[35],
        };
        Some(Self { pin: ascii_until_nul(&r[..32]), time, io_mode: u32_at(r, 40), verify_mode: u32_at(r, 44) })
    }

    /// 1 = masuk, 2 = pulang (lihat `docs/riset.md`: mesin mengganti status menurut jam).
    pub fn action(&self) -> u8 {
        (self.io_mode >> 24) as u8
    }

    /// Cara verifikasi, urut seperti di mesin.
    pub fn verify(&self) -> Vec<Verify> {
        verify_kinds(self.verify_mode)
    }
}

/// Satu baris `user_id_array` di hasil `GET_USER_ID_LIST`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserEntry {
    /// PIN.
    pub pin: String,
    /// Hak akses manager (admin).
    pub manager: bool,
    /// User aktif (boleh absen).
    pub active: bool,
    /// Bit 0 = password, `0x0C` = jari + wajah, 0 = belum ada kredensial.
    pub enrolled: u8,
}

impl UserEntry {
    /// Urai satu record; `None` bila kurang dari 36 byte.
    pub fn parse(r: &[u8]) -> Option<Self> {
        let r = r.get(..USER_SIZE)?;
        Some(Self { pin: ascii_until_nul(&r[..24]), manager: r[32] == 1, active: r[33] == 1, enrolled: r[34] })
    }
}

fn ascii_until_nul(b: &[u8]) -> String {
    b.iter().take_while(|&&c| c != 0).map(|&c| char::from(c)).collect()
}

fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn record_log_asli() {
        let rec = |tail: &str| [b"7".as_slice(), &[0; 31], &unhex(tail)].concat();
        let l = LogRecord::parse(&rec("0100000afa313a920000000200000010")).unwrap();
        assert_eq!((l.pin.as_str(), l.time.to_string().as_str(), l.action()), ("7", "2026-03-26 17:36:10", 2));
        assert_eq!(l.verify(), [Verify::Finger]);
        assert_eq!(LogRecord::parse(&rec("01000003fa315a7a0000000200000040")).unwrap().verify(), [Verify::Face]);
        assert_eq!(LogRecord::parse(&rec("01000003fa315a7a0000000100000012")).unwrap().verify(), [Verify::Finger, Verify::Password]);
    }
}
