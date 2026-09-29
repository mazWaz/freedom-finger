//! Layanan Windows native (tanpa alat tambahan): `FreedomFinger`, akun LocalSystem, mulai
//! otomatis saat komputer menyala, restart 5 detik setelah gagal.

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use windows_service::service::{
    ServiceAccess, ServiceAction, ServiceActionType, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode,
    ServiceFailureActions, ServiceFailureResetPeriod, ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
use windows_service::{define_windows_service, service_dispatcher};

use super::{ADMIN, run, serve_until};

const NAME: &str = "FreedomFinger";
/// Nama aturan firewall (tanpa spasi supaya aman sebagai argumen `netsh`).
const RULE: &str = "name=FreedomFinger";

fn err(e: windows_service::Error) -> String {
    match &e {
        // ERROR_ACCESS_DENIED
        windows_service::Error::Winapi(io) if io.raw_os_error() == Some(5) => ADMIN.into(),
        _ => e.to_string(),
    }
}

fn manager(access: ServiceManagerAccess) -> Result<ServiceManager, String> {
    ServiceManager::local_computer(None::<&str>, access).map_err(err)
}

/// Hak admin diperiksa oleh Service Control Manager; pesan jelas datang dari [`err`].
pub fn need_admin() -> Result<(), String> {
    manager(ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE).map(drop)
}

/// Hentikan layanan dan tunggu sampai berhenti, supaya file program boleh ditimpa.
pub fn stop() {
    let Ok(m) = manager(ServiceManagerAccess::CONNECT) else { return };
    let Ok(s) = m.open_service(NAME, ServiceAccess::STOP | ServiceAccess::QUERY_STATUS) else { return };
    let _ = s.stop();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(20) {
        match s.query_status() {
            Ok(st) if st.current_state != ServiceState::Stopped => std::thread::sleep(Duration::from_millis(250)),
            _ => break,
        }
    }
    // proses bisa masih memegang file program sesaat setelah Stopped
    std::thread::sleep(Duration::from_millis(500));
}

pub fn install(exe: &Path, dir: &Path, port: u16) -> Result<Vec<String>, String> {
    // data (token, template sidik jari) hanya untuk SYSTEM dan Administrators
    run("icacls", &[&dir.to_string_lossy(), "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"])?;
    let info = ServiceInfo {
        name: OsString::from(NAME),
        display_name: OsString::from("Freedom Finger"),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: exe.to_owned(),
        launch_arguments: vec![OsString::from("service-run")],
        dependencies: vec![],
        account_name: None, // LocalSystem
        account_password: None,
    };
    let m = manager(ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE)?;
    let access = ServiceAccess::QUERY_STATUS | ServiceAccess::START | ServiceAccess::CHANGE_CONFIG;
    let s = match m.open_service(NAME, access) {
        Ok(s) => {
            s.change_config(&info).map_err(err)?;
            s
        }
        Err(_) => m.create_service(&info, access).map_err(err)?,
    };
    s.set_description("Server absensi lokal untuk mesin Fingerspot").map_err(err)?;
    let restart = ServiceAction { action_type: ServiceActionType::Restart, delay: Duration::from_secs(5) };
    s.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(24 * 3600)),
        reboot_msg: None,
        command: None,
        actions: Some(vec![restart.clone(), restart.clone(), restart]),
    })
    .map_err(err)?;
    s.set_failure_actions_on_non_crash_failures(true).map_err(err)?;
    let _ = run("netsh", &["advfirewall", "firewall", "delete", "rule", RULE]);
    let local = format!("localport={port}");
    run(
        "netsh",
        &["advfirewall", "firewall", "add", "rule", RULE, "dir=in", "action=allow", "protocol=TCP", &local, "remoteip=localsubnet"],
    )?;
    s.start(&[] as &[&OsStr]).map_err(err)?;
    Ok(vec![format!("Firewall: port {port} dibuka untuk jaringan lokal")])
}

pub fn uninstall(_port: u16) -> Result<(), String> {
    stop();
    let m = manager(ServiceManagerAccess::CONNECT)?;
    if let Ok(s) = m.open_service(NAME, ServiceAccess::DELETE) {
        s.delete().map_err(err)?;
    }
    let _ = run("netsh", &["advfirewall", "firewall", "delete", "rule", RULE]);
    Ok(())
}

define_windows_service!(ffi_service_main, service_main);

/// Titik masuk layanan (`freedom-finger service-run`, dipanggil Service Control Manager).
pub fn run_service() -> Result<(), String> {
    service_dispatcher::start(NAME, ffi_service_main).map_err(err)
}

fn service_main(_args: Vec<OsString>) {
    let (tx, rx) = mpsc::channel();
    let handler = move |c| match c {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            let _ = tx.send(());
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    };
    let Ok(status) = service_control_handler::register(NAME, handler) else { return };
    let report = |state, accept, code| {
        let _ = status.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: accept,
            exit_code: ServiceExitCode::Win32(code),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        });
    };
    report(ServiceState::Running, ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN, 0);
    let result = serve_until(rx);
    if let Err(e) = &result {
        eprintln!("gagal: {e}");
    }
    // kode bukan 0 = gagal: Windows menjalankan ulang layanan (lihat update_failure_actions)
    report(ServiceState::Stopped, ServiceControlAccept::empty(), u32::from(result.is_err()));
}
