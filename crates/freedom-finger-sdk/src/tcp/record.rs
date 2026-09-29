//! Susunan byte data TCP 5005: log 48 byte, daftar user 36 byte, blok info user 204 byte, jam 8 byte.
//! Semua fungsi murni (tanpa I/O). Detail offset: `docs/protokol.md` bagian 7.

use crate::time::WallTime;

/// Ukuran record log.
pub const LOG_SIZE: usize = 48;
/// Ukuran record daftar user.
pub const USER_SIZE: usize = 36;
/// Ukuran blok info user.
pub const INFO_SIZE: usize = 204;
/// Mesin memotong nama di 15 karakter.
pub const NAME_MAX: usize = 15;
/// Batas resmi PIN.
pub const PIN_MAX: usize = 22;

/// PIN 48 byte (ASCII diakhiri NUL), dipakai `E8`, `93`, `94`, `95`, `96`.
pub fn pin_block(pin: &str) -> [u8; 48] {
    let mut b = [0; 48];
    put_ascii(&mut b, pin);
    b
}

/// Blok info user 204 byte: PIN @0, nama UTF-16LE @36, sisanya nol (SDK `FK_SetUserName_StringID`).
pub fn name_block(pin: &str, name: &str) -> [u8; INFO_SIZE] {
    let mut b = [0; INFO_SIZE];
    put_ascii(&mut b, pin);
    for (i, u) in name.encode_utf16().take(63).enumerate() {
        b[36 + i * 2..38 + i * 2].copy_from_slice(&u.to_le_bytes());
    }
    b
}

/// Blok bawaan user yang identik dengan user buatan mesin: PostId 1 @164, tahun @168, bulan @170,
/// hari tanggal 1 @172, ShiftId @173..203 = 1 untuk Senin-Jumat, 0 Sabtu-Minggu (31 slot penuh).
pub fn default_info(pin: &str, name: &str, month: WallTime) -> [u8; INFO_SIZE] {
    let mut b = name_block(pin, name);
    let first = WallTime { day: 1, ..month }.weekday();
    b[164..168].copy_from_slice(&1u32.to_le_bytes());
    b[168..170].copy_from_slice(&month.year.to_le_bytes());
    b[170..172].copy_from_slice(&u16::from(month.month).to_le_bytes());
    b[172] = first;
    for i in 0..31 {
        b[173 + i] = u8::from((1..=5).contains(&((usize::from(first) + i) % 7)));
    }
    b
}

/// Nama dari blok info user (UTF-16LE @36 sampai NUL).
pub fn info_name(info: &[u8]) -> String {
    let units: Vec<u16> =
        info.get(36..164).unwrap_or_default().chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0).collect();
    String::from_utf16_lossy(&units)
}

/// `p2` untuk `E8`/`E9`: selektor (tahun, bulan) blok info user. 2026-09 = `0x3534`.
pub fn month_selector(t: WallTime) -> u32 {
    ((u32::from(t.year) + 0x30) << 9 | u32::from(t.month) << 5 | 0x14) & 0xFFFF
}

/// Jam 8 byte: tahun u16 | bulan | tanggal | hari (Minggu = 0) | jam | menit | detik.
pub fn time_block(t: WallTime) -> [u8; 8] {
    let y = t.year.to_le_bytes();
    [y[0], y[1], t.month, t.day, t.weekday(), t.hour, t.minute, t.second]
}

/// Kebalikan [`time_block`]; hari dalam minggu diabaikan.
pub fn parse_time(b: &[u8]) -> Option<WallTime> {
    let b: &[u8; 8] = b.get(..8)?.try_into().ok()?;
    Some(WallTime { year: u16::from_le_bytes([b[0], b[1]]), month: b[2], day: b[3], hour: b[5], minute: b[6], second: b[7] })
}

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
/// `0x4000_0000` = wajah, `0x1200_0000` = jari + password. Sama untuk log TCP 5005 dan FkWeb.
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
    /// Byte 40-43. Aksi = `io_mode >> 24` (1 masuk, 2 pulang); sama dengan `io_mode` FkWeb.
    pub io_mode: u32,
    /// Byte 44-47; sama dengan `verify_mode` FkWeb.
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

/// Satu baris daftar user (`97`, dan `user_id_array` FkWeb `GET_USER_ID_LIST`).
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

fn put_ascii(b: &mut [u8], s: &str) {
    let n = s.len().min(b.len() - 1);
    b[..n].copy_from_slice(&s.as_bytes()[..n]);
}

pub(crate) fn ascii_until_nul(b: &[u8]) -> String {
    b.iter().take_while(|&&c| c != 0).map(|&c| char::from(c)).collect()
}

fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tcp::tests::{hex, unhex};
    use crate::time::WIB;

    fn at(s: &str) -> WallTime {
        WallTime::parse_fk14(s).unwrap()
    }

    #[test]
    fn selektor_bulan() {
        assert_eq!(month_selector(at("20260928120000")), 0x3534); // nilai yang terbukti di mesin
        assert_eq!(month_selector(at("20261001003000")), 0x3554);
    }

    #[test]
    fn blok_nama() {
        let b = name_block("99999", "Tes Contoh");
        assert_eq!(&b[..6], b"99999\0");
        assert_eq!(info_name(&b), "Tes Contoh");
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

    #[test]
    fn jam_8_byte() {
        let t = at("20260928213444"); // Senin
        assert_eq!(hex(&time_block(t)), "ea07091c0115222c");
        assert_eq!(parse_time(&unhex("ea07091c0115222c")), Some(t));
        assert_eq!(time_block(at("20260927120000"))[4], 0); // Minggu
        assert_eq!(time_block(WallTime::from_unix(at("20260928010000").to_unix(WIB), WIB))[4], 1);
    }

    #[test]
    fn blok_bawaan_sama_dengan_user_buatan_mesin() {
        let tail = |m| hex(&default_info("99999", "Tes", at(m))[164..]);
        assert_eq!(tail("20260915120000"), "01000000ea0709000201010101000001010101010000010101010100000101010101000001010101");
        assert_eq!(tail("20261015120000"), "01000000ea070a000401010000010101010100000101010101000001010101010000010101010100");
    }
}
