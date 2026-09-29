//! Jam dinding mesin.
//!
//! Mesin menyimpan jam lokal tanpa zona waktu (di kantor ini WIB). Karena itu SDK memakai
//! [`WallTime`] polos dan zona waktu selalu diberikan pemanggil sebagai offset detik dari UTC,
//! tidak pernah diambil dari zona proses (launchd, Docker, dan `cargo test` bisa berjalan di UTC).

use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

/// Tanggal dan jam dinding seperti yang tercatat di mesin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct WallTime {
    /// Tahun, mis. 2026.
    pub year: u16,
    /// Bulan 1-12.
    pub month: u8,
    /// Tanggal 1-31.
    pub day: u8,
    /// Jam 0-23.
    pub hour: u8,
    /// Menit 0-59.
    pub minute: u8,
    /// Detik 0-59.
    pub second: u8,
}

/// Offset WIB (UTC+7) dalam detik. Indonesia tidak memakai DST.
pub const WIB: i64 = 7 * 3600;

impl WallTime {
    /// Jam dinding dari detik Unix dan offset zona (detik dari UTC).
    pub fn from_unix(secs: i64, utc_offset: i64) -> Self {
        let t = secs + utc_offset;
        let (year, month, day) = civil_from_days(t.div_euclid(86_400));
        let rem = t.rem_euclid(86_400);
        Self { year: year as u16, month, day, hour: (rem / 3600) as u8, minute: (rem % 3600 / 60) as u8, second: (rem % 60) as u8 }
    }

    /// Jam dinding sekarang pada offset zona tertentu.
    pub fn now(utc_offset: i64) -> Self {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
        Self::from_unix(secs, utc_offset)
    }

    /// Kebalikan [`WallTime::from_unix`].
    pub fn to_unix(&self, utc_offset: i64) -> i64 {
        self.days() * 86_400 + i64::from(self.hour) * 3600 + i64::from(self.minute) * 60 + i64::from(self.second) - utc_offset
    }

    /// Hari dalam minggu: 0 = Minggu, 1 = Senin, …, 6 = Sabtu (sama dengan SYSTEMTIME mesin).
    pub fn weekday(&self) -> u8 {
        (self.days() + 4).rem_euclid(7) as u8 // 1970-01-01 = Kamis
    }

    /// Format jam FkWeb: `YYYYMMDDhhmmss`.
    pub fn fk14(&self) -> String {
        format!("{:04}{:02}{:02}{:02}{:02}{:02}", self.year, self.month, self.day, self.hour, self.minute, self.second)
    }

    /// Baca format `YYYYMMDDhhmmss`. `None` bila bukan 14 digit atau di luar rentang.
    pub fn parse_fk14(s: &str) -> Option<Self> {
        if s.len() != 14 || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let n = |a: usize, b: usize| s[a..b].parse::<u16>().ok();
        let t = Self {
            year: n(0, 4)?,
            month: n(4, 6)? as u8,
            day: n(6, 8)? as u8,
            hour: n(8, 10)? as u8,
            minute: n(10, 12)? as u8,
            second: n(12, 14)? as u8,
        };
        t.is_valid().then_some(t)
    }

    fn is_valid(&self) -> bool {
        (1..=12).contains(&self.month) && (1..=31).contains(&self.day) && self.hour < 24 && self.minute < 60 && self.second < 60
    }

    fn days(&self) -> i64 {
        days_from_civil(i64::from(self.year), i64::from(self.month), i64::from(self.day))
    }
}

/// `YYYY-MM-DD hh:mm:ss`
impl fmt::Display for WallTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02} {:02}:{:02}:{:02}", self.year, self.month, self.day, self.hour, self.minute, self.second)
    }
}

// Konversi kalender Gregorian <-> hari sejak 1970-01-01 (algoritma Howard Hinnant, bebas dependency).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, u8, u8) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_bolak_balik_dan_hari() {
        // 2026-09-28 21:34:44 WIB = Senin (contoh jam asli dari mesin)
        let t = WallTime::from_unix(1_790_606_084, WIB);
        assert_eq!(t.to_string(), "2026-09-28 21:34:44");
        assert_eq!(t.weekday(), 1);
        assert_eq!(t.to_unix(WIB), 1_790_606_084);
        // offset menentukan tanggal: 01:00 WIB tanggal 28 = masih tanggal 27 di UTC
        assert_eq!(WallTime::from_unix(1_790_532_000, WIB).to_string(), "2026-09-28 01:00:00");
        assert_eq!(WallTime::from_unix(1_790_532_000, 0).day, 27);
    }

    #[test]
    fn format_fk14() {
        let t = WallTime::parse_fk14("20260929131140").unwrap();
        assert_eq!(t.to_string(), "2026-09-29 13:11:40");
        assert_eq!(t.fk14(), "20260929131140");
        assert_eq!(WallTime::parse_fk14("20261329000000"), None);
        assert_eq!(WallTime::parse_fk14("2026092913114"), None);
    }
}
