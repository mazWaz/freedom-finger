//! Protokol TCP 5005 (SmackBio FK "CIF13_1"), aktif saat mesin di **mode Lokal**.
//!
//! - [`frame`] dan [`parse_reply`]: bingkai perintah dan balasan, tanpa I/O (sans-IO).
//! - [`record`]: susunan byte log, daftar user, blok info user, jam.
//! - [`Client`]: klien blocking di atas `std::net`.
//!
//! Spesifikasi lengkap: `docs/protokol.md` bagian 1-13.

mod client;
pub mod record;

pub use client::{Client, Error};

/// Port bawaan SDK FK.
pub const DEFAULT_PORT: u16 = 5005;

/// Kode perintah yang dipakai SDK (daftar lengkap: `docs/protokol.md` bagian 5).
pub mod cmd {
    /// Buka sesi; p1 = password komunikasi.
    pub const HANDSHAKE: u8 = 0x80;
    /// Blok info (p1 = 0) dan JSON kemampuan (p1 = 1).
    pub const DEVICE_INFO: u8 = 0x13;
    /// Data produk (serial, tanggal produksi).
    pub const PRODUCT: u8 = 0xC3;
    /// Nilai status/jumlah; p1 = indeks [`super::status`].
    pub const STATUS: u8 = 0xB4;
    /// Baca satu setting; p1 = indeks.
    pub const SETTING: u8 = 0xB0;
    /// Baca jam (8 byte).
    pub const GET_TIME: u8 = 0xB2;
    /// Setel jam (8 byte).
    pub const SET_TIME: u8 = 0xB3;
    /// p1 = 0 kunci, 1 buka.
    pub const KEYPAD: u8 = 0x81;
    /// Baca **semua** log tanpa menandai "sudah dibaca" (A1/A2 sengaja tidak dipakai).
    pub const ALL_LOGS: u8 = 0xA4;
    /// Daftar user (record 36 byte).
    pub const USER_LIST: u8 = 0x97;
    /// Baca blok info user 204 byte (dua langkah: pilih PIN, lalu baca).
    pub const USER_INFO_READ: u8 = 0xE8;
    /// Tulis blok info user; p1 = `0x15` nama, `0x16` jabatan, `0x17` jadwal.
    pub const USER_INFO_WRITE: u8 = 0xE9;
    /// Hapus kredensial; p2 = 12 menghapus seluruh user.
    pub const DELETE: u8 = 0x93;
    /// Aktifkan user.
    pub const ENABLE: u8 = 0x94;
    /// Nonaktifkan user.
    pub const DISABLE: u8 = 0x95;
    /// Hak akses; p2 = 0 user, 1 manager.
    pub const PRIVILEGE: u8 = 0x96;
}

/// Indeks status `B4` (enum SDK `enumGetDeviceStatus`).
pub mod status {
    /// Jumlah manager.
    pub const MANAGERS: u32 = 1;
    /// Jumlah user biasa.
    pub const USERS: u32 = 2;
    /// Jumlah sidik jari.
    pub const FINGERPRINTS: u32 = 3;
    /// Jumlah password.
    pub const PASSWORDS: u32 = 4;
    /// Log yang belum ditandai "sudah dibaca".
    pub const UNREAD_LOGS: u32 = 6;
    /// Total log.
    pub const TOTAL_LOGS: u32 = 8;
    /// Jumlah wajah.
    pub const FACES: u32 = 10;
    /// Total user.
    pub const TOTAL_USERS: u32 = 11;
}

/// Bingkai perintah: `55 AA | 01 | cmd | p1 u32 | p2 u32 | len u16 | seq u16`,
/// lalu bila ada data: `55 AA + data + 00 00`. `len` = panjang data kirim, atau panjang yang ingin dibaca.
pub fn frame(cmd: u8, p1: u32, p2: u32, len: u16, seq: u16, data: Option<&[u8]>) -> Vec<u8> {
    let mut f = Vec::with_capacity(20 + data.map_or(0, <[u8]>::len));
    f.extend_from_slice(&[0x55, 0xAA, 0x01, cmd]);
    f.extend_from_slice(&p1.to_le_bytes());
    f.extend_from_slice(&p2.to_le_bytes());
    f.extend_from_slice(&len.to_le_bytes());
    f.extend_from_slice(&seq.to_le_bytes());
    if let Some(d) = data {
        f.extend_from_slice(&[0x55, 0xAA]);
        f.extend_from_slice(d);
        f.extend_from_slice(&[0, 0]);
    }
    f
}

/// Balasan mesin untuk satu perintah.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    /// `true` bila ack `01` (berhasil).
    pub ok: bool,
    /// Nilai status u32 di ack (untuk `B4`/`B0` berisi nilainya; bila gagal berisi kode error).
    pub status: u32,
    /// Data yang dibaca (kosong untuk perintah tulis atau bila gagal).
    pub data: Vec<u8>,
}

/// Cari balasan untuk `seq` di `buf`: ack `AA 55 | 01 | 01/FD | status u32 | seq u16`, lalu bila ada
/// data `55 AA + data + 4 byte penutup`. `None` = balasan belum lengkap, tunggu byte berikutnya.
pub fn parse_reply(buf: &[u8], seq: u16, read_len: usize) -> Option<Reply> {
    let i = (0..buf.len().saturating_sub(9))
        .find(|&i| buf[i] == 0xAA && buf[i + 1] == 0x55 && u16::from_le_bytes([buf[i + 8], buf[i + 9]]) == seq)?;
    let ok = buf[i + 3] == 1;
    let status = u32::from_le_bytes([buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]]);
    if ok && read_len > 0 {
        let data = buf.get(i + 12..i + 12 + read_len)?;
        return Some(Reply { ok, status, data: data.to_vec() });
    }
    Some(Reply { ok, status, data: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bingkai_sesuai_dekompilasi() {
        // hapus kredensial wajah PIN "1", seq 7
        let f = frame(0x93, 1, 12, 48, 7, Some(&record::pin_block("1")));
        assert_eq!(hex(&f[..16]), "55aa0193010000000c00000030000700");
        assert_eq!(hex(&f[16..19]), "55aa31");
        assert_eq!(f.len(), 16 + 2 + 48 + 2);
        // tanpa data: header 16 byte saja (baca jam B2, len 8)
        assert_eq!(hex(&frame(0xB2, 0, 0, 8, 1, None)), "55aa01b2000000000000000008000100");
    }

    #[test]
    fn balasan_bertahap() {
        // ack OK status 0 seq 2, lalu 55 AA + 4 byte data + penutup
        let full = unhex("aa550101000000000200" /* ack */).into_iter().chain(unhex("55aa01020304deadbeef")).collect::<Vec<_>>();
        assert_eq!(parse_reply(&full[..12], 2, 4), None); // data belum lengkap
        assert_eq!(parse_reply(&full, 2, 4).unwrap().data, [1, 2, 3, 4]);
        assert_eq!(parse_reply(&full, 3, 4), None); // seq lain
        // ditolak: ack FD, status 3
        let r = parse_reply(&unhex("aa5501fd030000000500"), 5, 8).unwrap();
        assert!(!r.ok);
        assert_eq!(r.status, 3);
    }

    pub(crate) fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    pub(crate) fn unhex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }
}
