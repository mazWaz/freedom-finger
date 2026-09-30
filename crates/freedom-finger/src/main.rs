//! `freedom-finger`: server absensi lokal untuk mesin Fingerspot, tanpa cloud.
//!
//! ```text
//! freedom-finger              jalankan server (folder data = folder program)
//! freedom-finger install      pasang sebagai layanan: jalan sendiri saat komputer menyala
//! freedom-finger uninstall    hapus layanan; data tetap ada
//! freedom-finger status       server jalan? mesin terhubung?
//! freedom-finger cari         cari mesin di jaringan lokal
//! freedom-finger backup FILE  salin database ke FILE (aman saat server berjalan)
//! ```

mod setup;

use std::error::Error;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use freedom_finger::config::Config;
use freedom_finger::store::Store;
use freedom_finger::{banner, net};
use serde_json::Value;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Parser)]
#[command(name = "freedom-finger", version, about = "Server absensi lokal untuk mesin Fingerspot: tanpa cloud, tanpa langganan")]
struct Cli {
    /// Folder data: pengaturan, database, foto (bawaan: folder program)
    #[arg(long, global = true, value_name = "FOLDER")]
    data: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Jalankan server (sama dengan tanpa perintah)
    Serve,
    /// Pasang sebagai layanan: jalan sendiri saat komputer menyala (butuh hak admin)
    Install,
    /// Hapus layanan (butuh hak admin); data tetap disimpan
    Uninstall,
    /// Server berjalan? Mesin terhubung?
    Status,
    /// Cari mesin di jaringan lokal
    #[command(visible_alias = "scan")]
    Cari {
        /// Password komunikasi mesin (untuk mesin di mode Lokal)
        #[arg(long, env = "FK_PASSWORD", default_value_t = 0)]
        password: u32,
    },
    /// Salin database ke file baru (aman saat server berjalan); berisi data jari/wajah, simpan di tempat aman
    Backup {
        /// File tujuan, belum boleh ada
        file: PathBuf,
    },
    /// Titik masuk layanan Windows
    #[command(hide = true)]
    ServiceRun,
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

fn run(cli: Cli) -> Result<()> {
    let data = || cli.data.clone().map_or_else(exe_dir, Ok);
    match cli.cmd.unwrap_or(Cmd::Serve) {
        Cmd::Serve => {
            let cfg = Config::load(&data()?)?;
            println!(
                "Freedom Finger {} berjalan di port {}\nFolder data  {}\n\n{}\n",
                env!("CARGO_PKG_VERSION"),
                cfg.port,
                cfg.dir.display(),
                banner(&cfg)
            );
            runtime()?.block_on(freedom_finger::serve(cfg, std::future::pending()))?;
        }
        Cmd::Install => {
            let (cfg, done) = setup::install()?;
            println!("✓ Terpasang di {}, jalan otomatis saat komputer menyala", cfg.dir.display());
            for d in done {
                println!("✓ {d}");
            }
            println!("\n{}", banner(&cfg));
        }
        Cmd::Uninstall => {
            let dir = setup::uninstall()?;
            println!("✓ Layanan dihapus. Data tetap ada di {} (hapus sendiri bila tidak dipakai lagi).", dir.display());
        }
        Cmd::Status => status(Config::port_of(&data()?))?,
        Cmd::Cari { password } => cari(Config::port_of(&data()?), password)?,
        Cmd::Backup { file } => {
            let cfg = Config::load(&data()?)?;
            if !cfg.db.exists() {
                return Err(format!("database {} tidak ada", cfg.db.display()).into());
            }
            if file.exists() {
                return Err(format!("{} sudah ada; pilih nama lain", file.display()).into());
            }
            Store::open(&cfg.db)?.backup_to(&file)?;
            println!("✓ {} disalin ke {}", cfg.db.display(), file.display());
        }
        Cmd::ServiceRun => service_run()?,
    }
    Ok(())
}

#[cfg(windows)]
fn service_run() -> Result<()> {
    Ok(setup::run_service()?)
}

#[cfg(not(windows))]
fn service_run() -> Result<()> {
    Err("hanya untuk layanan Windows; pakai `freedom-finger install`".into())
}

/// Folder program: folder data bawaan.
pub fn exe_dir() -> std::result::Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("lokasi program: {e}"))?;
    // Unix: ikuti symlink (mis. /usr/local/bin); Windows: canonicalize memberi awalan \\?\
    let exe = if cfg!(windows) { exe } else { std::fs::canonicalize(&exe).unwrap_or(exe) };
    exe.parent().map(Path::to_path_buf).ok_or_else(|| "folder program tidak terbaca".into())
}

fn runtime() -> Result<tokio::runtime::Runtime> {
    Ok(tokio::runtime::Runtime::new()?)
}

/// JSON dari server lokal yang sedang berjalan.
fn local(port: u16, path: &str) -> Option<Value> {
    let mut r = ureq::get(format!("http://127.0.0.1:{port}{path}")).call().ok()?;
    serde_json::from_str(&r.body_mut().read_to_string().ok()?).ok()
}

fn status(port: u16) -> Result<()> {
    let Some(s) = local(port, "/status.json") else {
        println!("Server tidak berjalan di port {port}.\nJalankan `freedom-finger` (manual) atau `freedom-finger install` (layanan).");
        return Ok(());
    };
    let text = |v: &Value| v.as_str().unwrap_or("-").to_owned();
    println!("Server   berjalan, versi {}, port {port}", text(&s["version"]));
    let devices = s["devices"].as_array().cloned().unwrap_or_default();
    if devices.is_empty() {
        let ip = s["server_ip"].as_str().unwrap_or("IP komputer ini");
        println!(
            "Mesin    belum ada yang terhubung. Di mesin, Menu → Jaringan: Mode Internet, Server IP {ip}, Server Port {port}, Server Req Ya"
        );
    }
    for d in &devices {
        let on = if d["connected"] == true { "● terhubung" } else { "○ terputus " };
        println!("Mesin    {on}  {}  IP {}  terakhir {}", text(&d["cloud_id"]), text(&d["ip"]), text(&d["last_activity"]));
    }
    println!("Absen    hari ini {}, total {}", s["logs_today"], s["logs_total"]);
    println!("Token    {}", text(&s["env_file"]));
    Ok(())
}

fn cari(port: u16, password: u32) -> Result<()> {
    let nets = net::lan_nets();
    if nets.is_empty() {
        return Err("komputer ini tidak terhubung ke jaringan lokal".into());
    }
    let list: Vec<String> = nets.iter().map(ToString::to_string).collect();
    println!("Mencari mesin di {} …", list.join(", "));
    // server lokal yang berjalan tahu mesin mana yang sudah terhubung, jadi keterangannya lebih lengkap
    let found: Vec<(String, String)> = match local(port, "/scan.json") {
        Some(r) => r["data"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|d| (d["ip"].as_str().unwrap_or("-").to_owned(), d["note"].as_str().unwrap_or("").to_owned()))
            .collect(),
        None => runtime()?
            .block_on(net::scan(password))
            .into_iter()
            .map(|f| {
                let note = match f.mode {
                    net::Mode::Lokal => "mesin di mode Lokal: ubah ke Mode Internet (Menu → Jaringan) agar mengirim ke server ini",
                    net::Mode::Ditolak => "mesin di mode Lokal, password komunikasi berbeda (--password)",
                    net::Mode::Diam => "kemungkinan mesin di mode Internet",
                };
                (f.ip.to_string(), note.to_owned())
            })
            .collect(),
    };
    if found.is_empty() {
        println!("Tidak ada mesin ditemukan. Pastikan mesin menyala dan satu jaringan dengan komputer ini.");
    }
    for (ip, note) in found {
        println!("{ip:<16} {note}");
    }
    Ok(())
}
