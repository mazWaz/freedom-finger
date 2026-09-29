//! `install` / `uninstall`: pasang program sebagai layanan OS supaya jalan sendiri saat komputer
//! menyala, tanpa login, lalu buka port di firewall. Data tidak pernah dihapus.
//!
//! | OS | Folder | Layanan |
//! |---|---|---|
//! | Windows | `C:\FreedomFinger` | layanan Windows `FreedomFinger` (LocalSystem), restart bila gagal |
//! | Linux | `/opt/freedom-finger` | unit systemd `freedom-finger` (user `freedom-finger`) |
//! | macOS | `/opt/freedom-finger` | LaunchDaemon `com.github.mazwaz.freedom-finger` |

use std::path::{Path, PathBuf};
use std::process::Command;
use std::{fs, io};

use freedom_finger::config::Config;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as os;
#[cfg(windows)]
pub use windows::run_service;

const ADMIN: &str = "butuh hak admin: jalankan dengan sudo (Linux/macOS) atau dari terminal \"Run as administrator\" (Windows)";

/// Folder pasang: program, pengaturan, database, foto.
pub fn dir() -> PathBuf {
    if cfg!(windows) { PathBuf::from(r"C:\FreedomFinger") } else { PathBuf::from("/opt/freedom-finger") }
}

/// Pasang atau perbarui layanan. Hasil: pengaturan di folder layanan + langkah yang dikerjakan.
pub fn install() -> Result<(Config, Vec<String>), String> {
    os::need_admin()?;
    let dir = dir();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // nama tetap, apa pun nama file unduhan (mis. freedom-finger-linux-x64)
    let target = dir.join(format!("freedom-finger{}", std::env::consts::EXE_SUFFIX));
    os::stop(); // supaya program lama boleh ditimpa
    fs::create_dir_all(&dir).map_err(admin)?;
    if !same_file(&exe, &target) {
        fs::copy(&exe, &target).map_err(|e| format!("salin program ke {}: {}", target.display(), admin(e)))?;
    }
    let cfg = Config::load(&dir)?;
    let done = os::install(&target, &dir, cfg.port)?;
    Ok((cfg, done))
}

/// Hapus layanan dan aturan firewall. Hasil: folder data yang dibiarkan.
pub fn uninstall() -> Result<PathBuf, String> {
    os::need_admin()?;
    let dir = dir();
    os::uninstall(Config::port_of(&dir))?;
    Ok(dir)
}

fn same_file(a: &Path, b: &Path) -> bool {
    matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(a), Ok(b)) if a == b)
}

fn admin(e: io::Error) -> String {
    if e.kind() == io::ErrorKind::PermissionDenied { ADMIN.into() } else { e.to_string() }
}

/// Jalankan perintah OS; `Err` berisi pesan error-nya.
fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cmd).args(args).output().map_err(|e| format!("{cmd}: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let msg = [out.stderr, out.stdout].iter().map(|b| String::from_utf8_lossy(b).trim().to_owned()).find(|m| !m.is_empty());
        Err(format!("{cmd} {}: {}", args.join(" "), msg.unwrap_or_default()))
    }
}

#[cfg(unix)]
fn set_mode(p: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(p, fs::Permissions::from_mode(mode)).map_err(admin)
}

#[cfg(unix)]
fn need_root() -> Result<(), String> {
    if run("id", &["-u"]).is_ok_and(|u| u.trim() == "0") { Ok(()) } else { Err(ADMIN.into()) }
}

#[cfg(target_os = "linux")]
use linux as os;

#[cfg(target_os = "linux")]
mod linux {
    use super::*;

    const UNIT: &str = "/etc/systemd/system/freedom-finger.service";
    const USER: &str = "freedom-finger";

    pub fn need_admin() -> Result<(), String> {
        need_root()
    }

    pub fn stop() {
        let _ = run("systemctl", &["stop", "freedom-finger"]);
    }

    pub fn install(exe: &Path, dir: &Path, port: u16) -> Result<Vec<String>, String> {
        let d = dir.to_string_lossy();
        if run("id", &["-u", USER]).is_err() {
            let shell = ["/usr/sbin/nologin", "/sbin/nologin"].into_iter().find(|p| Path::new(p).exists()).unwrap_or("/bin/false");
            run("useradd", &["--system", "--no-create-home", "--home-dir", &d, "--shell", shell, USER])?;
        }
        // data (token, template sidik jari) hanya untuk akun layanan
        run("chown", &["-R", &format!("{USER}:{USER}"), &d])?;
        set_mode(dir, 0o700)?;
        let unit = format!(
            "[Unit]\nDescription=Freedom Finger (server absensi lokal)\nAfter=network-online.target\nWants=network-online.target\n\n\
             [Service]\nExecStart={exe}\nWorkingDirectory={d}\nUser={USER}\nUMask=0077\nRestart=always\nRestartSec=5\n\n\
             [Install]\nWantedBy=multi-user.target\n",
            exe = exe.display()
        );
        fs::write(UNIT, unit).map_err(admin)?;
        run("systemctl", &["daemon-reload"])?;
        run("systemctl", &["enable", "--now", "freedom-finger"])?;
        Ok(firewall(port, true))
    }

    pub fn uninstall(port: u16) -> Result<(), String> {
        let _ = run("systemctl", &["disable", "--now", "freedom-finger"]);
        match fs::remove_file(UNIT) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(admin(e)),
            _ => {}
        }
        run("systemctl", &["daemon-reload"])?;
        firewall(port, false);
        Ok(())
    }

    /// ufw atau firewalld bila aktif; tanpa keduanya port biasanya sudah terbuka.
    fn firewall(port: u16, open: bool) -> Vec<String> {
        let p = format!("{port}/tcp");
        let mut done = Vec::new();
        if run("ufw", &["status"]).is_ok_and(|o| o.contains("Status: active")) {
            let r = if open { run("ufw", &["allow", &p]) } else { run("ufw", &["delete", "allow", &p]) };
            if r.is_ok() {
                done.push(format!("Firewall (ufw): port {port} dibuka"));
            }
        }
        if run("firewall-cmd", &["--state"]).is_ok() {
            let arg = format!("--{}-port={p}", if open { "add" } else { "remove" });
            if run("firewall-cmd", &["--permanent", &arg]).and_then(|_| run("firewall-cmd", &["--reload"])).is_ok() {
                done.push(format!("Firewall (firewalld): port {port} dibuka"));
            }
        }
        done
    }
}

#[cfg(target_os = "macos")]
use macos as os;

#[cfg(target_os = "macos")]
mod macos {
    use std::time::Duration;

    use super::*;

    const LABEL: &str = "com.github.mazwaz.freedom-finger";

    fn plist() -> String {
        format!("/Library/LaunchDaemons/{LABEL}.plist")
    }

    pub fn need_admin() -> Result<(), String> {
        need_root()
    }

    pub fn stop() {
        let _ = run("launchctl", &["bootout", &format!("system/{LABEL}")]);
    }

    pub fn install(exe: &Path, dir: &Path, _port: u16) -> Result<Vec<String>, String> {
        set_mode(dir, 0o700)?;
        let log = dir.join("freedom-finger.log");
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>{exe}</string></array>
  <key>WorkingDirectory</key><string>{dir}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict></plist>
"#,
            exe = exe.display(),
            dir = dir.display(),
            log = log.display()
        );
        fs::write(plist(), xml).map_err(admin)?;
        // bootout sebelumnya bisa belum selesai; coba lagi sebentar
        let mut last = Ok(String::new());
        for _ in 0..5 {
            last = run("launchctl", &["bootstrap", "system", &plist()]);
            if last.is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        last.map(|_| Vec::new())
    }

    pub fn uninstall(_port: u16) -> Result<(), String> {
        stop();
        match fs::remove_file(plist()) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(admin(e)),
            _ => Ok(()),
        }
    }
}

/// Jalankan server sampai `stop` menerima sinyal (layanan Windows).
#[cfg(windows)]
fn serve_until(stop: std::sync::mpsc::Receiver<()>) -> Result<(), String> {
    let cfg = Config::load(&crate::exe_dir()?)?;
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let shutdown = async move {
        let _ = tokio::task::spawn_blocking(move || stop.recv()).await;
    };
    rt.block_on(freedom_finger::serve(cfg, shutdown)).map_err(|e| e.to_string())
}
