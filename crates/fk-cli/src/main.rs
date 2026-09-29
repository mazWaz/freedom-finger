//! `fk`: kelola mesin Fingerspot lewat TCP 5005. Mesin harus di **mode Lokal** (menu Jaringan);
//! selama itu server absensi tidak menerima data.
//!
//! ```text
//! fk log > absensi.csv      semua log, baca saja (tidak menandai log "sudah dibaca")
//! fk jam [--sinkron]        selisih jam mesin vs komputer ini; --sinkron = samakan
//! fk list
//! fk add <pin> <nama> [--manager]
//! fk edit <pin> [--nama <nama>] [--manager | --user] [--aktif | --nonaktif]
//! fk delete <pin> [--yes]
//! ```
//!
//! Hanya PIN yang disebut yang disentuh. Perintah hapus massal (`C1`) sengaja tidak ada.

use std::collections::HashMap;
use std::error::Error;
use std::io::BufRead;
use std::process::ExitCode;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use clap::builder::FalseyValueParser;
use clap::{Parser, Subcommand};
use freedom_finger_sdk::tcp::Client;
use freedom_finger_sdk::tcp::record::{NAME_MAX, PIN_MAX, UserEntry};
use freedom_finger_sdk::time::WallTime;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Parser)]
#[command(name = "fk", version, about = "Kelola mesin Fingerspot lewat TCP 5005 (mesin di mode Lokal)")]
struct Cli {
    /// Alamat IP mesin (lihat menu Jaringan di mesin)
    #[arg(long, env = "FK_HOST", global = true)]
    host: Option<String>,
    #[arg(long, env = "FK_PORT", default_value_t = freedom_finger_sdk::tcp::DEFAULT_PORT, global = true)]
    port: u16,
    /// Password komunikasi mesin
    #[arg(long, env = "FK_PASSWORD", default_value_t = 0, global = true)]
    password: u32,
    /// Zona jam mesin, jam dari UTC (7 = WIB). Tidak diambil dari zona proses: layanan OS bisa berjalan di UTC.
    #[arg(long, env = "FK_UTC_OFFSET", default_value_t = 7, allow_negative_numbers = true, global = true)]
    utc_offset: i64,
    /// Cetak hex setiap bingkai ke stderr
    #[arg(long, env = "FK_DEBUG", value_parser = FalseyValueParser::new(), global = true)]
    debug: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Semua log ke CSV di stdout (pin, nama, waktu, aksi, verifikasi)
    Log,
    /// Selisih jam mesin vs komputer ini
    Jam {
        /// Samakan jam mesin ke jam komputer ini
        #[arg(long)]
        sinkron: bool,
    },
    /// Daftar user: PIN, hak akses, aktif, nama
    List,
    /// Tambah user baru, identik dengan user buatan mesin
    Add {
        #[arg(value_parser = pin)]
        pin: String,
        #[arg(value_parser = name)]
        nama: String,
        #[arg(long)]
        manager: bool,
    },
    /// Ubah nama, hak akses, atau status aktif
    Edit {
        #[arg(value_parser = pin)]
        pin: String,
        #[arg(long, value_parser = name)]
        nama: Option<String>,
        #[arg(long, conflicts_with = "user")]
        manager: bool,
        #[arg(long)]
        user: bool,
        #[arg(long, conflicts_with = "nonaktif")]
        aktif: bool,
        #[arg(long)]
        nonaktif: bool,
    },
    /// Hapus satu user beserta sidik jari/wajah/kartu/password-nya
    Delete {
        #[arg(value_parser = pin)]
        pin: String,
        /// Tanpa konfirmasi
        #[arg(long)]
        yes: bool,
    },
}

fn pin(s: &str) -> std::result::Result<String, String> {
    if (1..=PIN_MAX).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()) {
        Ok(s.into())
    } else {
        Err(format!("PIN harus angka 1-{PIN_MAX} digit (batas resmi mesin)"))
    }
}

fn name(s: &str) -> std::result::Result<String, String> {
    let n = s.trim();
    if !n.is_empty() && n.encode_utf16().count() <= NAME_MAX {
        Ok(n.into())
    } else {
        Err(format!("nama wajib diisi, maksimal {NAME_MAX} karakter"))
    }
}

/// Kolom CSV dengan tanda kutip.
fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn action(a: u8) -> String {
    match a {
        1 => "masuk".into(),
        2 => "pulang".into(),
        a => a.to_string(),
    }
}

fn unix_now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64())
}

struct Fk {
    c: Client,
    /// Offset zona mesin, detik dari UTC.
    off: i64,
}

impl Fk {
    fn now(&self) -> WallTime {
        WallTime::now(self.off)
    }

    fn name(&mut self, pin: &str) -> Result<String> {
        let month = self.now();
        Ok(self.c.name(pin, month)?)
    }

    fn find(&mut self, pin: &str) -> Result<Option<UserEntry>> {
        Ok(self.c.users()?.into_iter().find(|u| u.pin == pin))
    }

    fn show(&mut self, u: Option<UserEntry>, pin: &str) -> Result<()> {
        let u = u.ok_or_else(|| format!("PIN {pin} tidak muncul di daftar user mesin"))?;
        let name = self.name(&u.pin)?;
        let (role, active) = (if u.manager { "manager" } else { "user   " }, if u.active { "aktif   " } else { "nonaktif" });
        println!("{:>6}  {role}  {active}  {name}", u.pin);
        Ok(())
    }

    /// Selisih jam mesin - komputer ini dalam detik (±1: mesin hanya mengirim detik bulat).
    fn check_time(&mut self) -> Result<i64> {
        let dev = self.c.time()?;
        let diff = (dev.to_unix(self.off) as f64 - unix_now()).round() as i64;
        println!("mesin {dev}  mac {}  selisih {diff:+} detik", self.now());
        Ok(diff)
    }
}

fn run(cli: Cli) -> Result<()> {
    if let Cmd::Edit { nama: None, manager: false, user: false, aktif: false, nonaktif: false, .. } = cli.cmd {
        return Err("tidak ada yang diubah".into());
    }
    let host = cli.host.ok_or("isi alamat IP mesin: --host <IP> atau variabel FK_HOST")?;
    let mut c = Client::connect((host.as_str(), cli.port), cli.password)?;
    c.set_debug(cli.debug);
    let mut fk = Fk { c, off: cli.utc_offset * 3600 };
    match cli.cmd {
        Cmd::Log => {
            let t0 = Instant::now();
            let logs = fk.c.logs()?;
            let mut names = HashMap::new();
            for u in fk.c.users()? {
                let n = fk.name(&u.pin)?;
                names.insert(u.pin, n);
            }
            println!("pin,nama,waktu,aksi,verifikasi");
            for l in &logs {
                let verify: Vec<String> = l.verify().into_iter().map(|v| v.name()).collect();
                let name = names.get(&l.pin).map_or("", String::as_str);
                println!("{},{},{},{},{}", l.pin, quote(name), l.time, action(l.action()), verify.join("+"));
            }
            let (first, last) = (logs.iter().map(|l| l.time).min(), logs.iter().map(|l| l.time).max());
            let fmt = |t: Option<WallTime>| t.map_or("-".into(), |t| t.to_string());
            eprintln!("{} log, {} s/d {}, {:.1} detik", logs.len(), fmt(first), fmt(last), t0.elapsed().as_secs_f64());
        }
        Cmd::Jam { sinkron } => {
            fk.check_time()?;
            if sinkron {
                // kirim tepat di awal detik
                std::thread::sleep(Duration::from_secs_f64(1.0 - unix_now().fract()));
                let now = fk.now();
                fk.c.set_time(now)?;
                if fk.check_time()?.abs() > 2 {
                    return Err("jam mesin masih belum sama setelah sinkron".into());
                }
            }
        }
        Cmd::List => {
            for u in fk.c.users()? {
                let pin = u.pin.clone();
                fk.show(Some(u), &pin)?;
            }
        }
        Cmd::Add { pin, nama, manager } => {
            if fk.find(&pin)?.is_some() {
                return Err(format!("PIN {pin} sudah dipakai \"{}\"; pakai edit", fk.name(&pin)?).into());
            }
            let month = fk.now();
            fk.c.add_user(&pin, &nama, month)?;
            if manager {
                fk.c.set_manager(&pin, true)?;
            }
            let u = fk.find(&pin)?;
            fk.show(u, &pin)?;
        }
        Cmd::Edit { pin, nama, manager, user, aktif, nonaktif } => {
            if fk.find(&pin)?.is_none() {
                return Err(format!("PIN {pin} tidak ada di mesin").into());
            }
            if let Some(n) = nama {
                let month = fk.now();
                fk.c.set_name(&pin, &n, month)?;
            }
            if manager || user {
                fk.c.set_manager(&pin, manager)?;
            }
            if aktif || nonaktif {
                fk.c.set_active(&pin, aktif)?;
            }
            let u = fk.find(&pin)?;
            fk.show(u, &pin)?;
        }
        Cmd::Delete { pin, yes } => {
            if fk.find(&pin)?.is_none() {
                return Err(format!("PIN {pin} tidak ada di mesin").into());
            }
            let old = fk.name(&pin)?;
            if !yes {
                eprint!("Hapus PIN {pin} \"{old}\" beserta sidik jari/wajah/kartu/password-nya? Ketik PIN lagi: ");
                let mut line = String::new();
                std::io::stdin().lock().read_line(&mut line)?;
                if line.trim() != pin {
                    return Err("dibatalkan".into());
                }
            }
            fk.c.delete_user(&pin)?;
            if fk.find(&pin)?.is_some() {
                return Err(format!("perintah terkirim tapi PIN {pin} masih ada di daftar").into());
            }
            println!("PIN {pin} \"{old}\" terhapus");
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Gagal: {e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;

    use super::*;

    #[test]
    fn argumen() {
        Cli::command().debug_assert();
        let p = |args: &[&str]| Cli::try_parse_from([&["fk", "--host", "192.168.1.201"], args].concat());
        assert!(p(&["add", "99999", "Tes Contoh"]).is_ok());
        assert!(p(&["add", "99999", "Tes", "Contoh"]).is_err()); // nama berspasi harus dikutip
        assert!(p(&["add", "12a", "Tes"]).is_err());
        assert!(p(&["add", &"1".repeat(23), "Tes"]).is_err());
        assert!(p(&["add", "1", "Nama Yang Terlalu Panjang"]).is_err());
        assert!(p(&["add", "1", "   "]).is_err());
        assert!(p(&["edit", "1", "--manager", "--user"]).is_err());
        assert!(p(&["edit", "1", "--aktif", "--nonaktif"]).is_err());
        assert!(p(&["delete", "1", "--yes"]).is_ok());
        let Cmd::Add { nama, .. } = p(&["add", "1", "  Siti "]).unwrap().cmd else { unreachable!() };
        assert_eq!(nama, "Siti");
    }

    #[test]
    fn csv() {
        assert_eq!(quote(r#"Budi "B""#), r#""Budi ""B""""#);
        assert_eq!((action(1), action(2), action(5)), ("masuk".into(), "pulang".into(), "5".into()));
    }
}
