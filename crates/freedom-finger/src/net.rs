//! Jaringan lokal: IP komputer ini dan pencarian mesin di LAN.
//!
//! Mesin di mode Internet menghubungi server sendiri dan langsung tercatat (lihat
//! `Service::devices`). Pencarian di sini untuk mesin yang belum terhubung: setiap alamat di
//! jaringan lokal dicoba di TCP 5005. Handshake dijawab = mode Lokal; port terbuka tapi diam =
//! mode Internet (perilaku yang teramati di Revo WF-206BNC, 29-09-2026).

use std::fmt;
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::Arc;
use std::time::Duration;

use freedom_finger_sdk::tcp::{self, DEFAULT_PORT, cmd};
use if_addrs::IfAddr;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio::time::timeout;

/// Jaringan terbesar yang dipindai: /22 (1.022 alamat). Jaringan lebih besar dipersempit ke
/// /22 di sekitar IP komputer ini, supaya pencarian tetap beberapa detik.
const MIN_PREFIX: u8 = 22;
/// WiFi mesin lambat (ping sampai 1,2 detik).
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);
const REPLY_TIMEOUT: Duration = Duration::from_secs(3);
const PARALLEL: usize = 256;

/// Satu jaringan IPv4 lokal: IP komputer ini + panjang prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Net {
    pub ip: Ipv4Addr,
    pub prefix: u8,
}

impl Net {
    fn mask(self) -> u32 {
        u32::MAX.checked_shl(32 - u32::from(self.prefix)).unwrap_or(0)
    }

    /// Semua alamat host di jaringan ini, kecuali komputer ini.
    pub fn hosts(self) -> impl Iterator<Item = Ipv4Addr> {
        let base = u32::from(self.ip) & self.mask();
        let last = base | !self.mask();
        (base.saturating_add(1)..last).map(Ipv4Addr::from).filter(move |a| *a != self.ip)
    }
}

/// `192.168.1.0/24`
impl fmt::Display for Net {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", Ipv4Addr::from(u32::from(self.ip) & self.mask()), self.prefix)
    }
}

/// Jaringan IPv4 lokal (tanpa loopback dan link-local), paling besar /22.
pub fn lan_nets() -> Vec<Net> {
    let mut nets: Vec<Net> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.addr {
            IfAddr::V4(a) if !a.is_loopback() && !a.is_link_local() => Some(Net { ip: a.ip, prefix: a.prefixlen.max(MIN_PREFIX) }),
            _ => None,
        })
        .collect();
    nets.sort_by_key(|n| n.to_string());
    nets.dedup_by_key(|n| n.to_string());
    nets
}

/// IPv4 komputer ini yang dipakai untuk rute keluar: isian Server IP di menu mesin.
pub fn lan_ip() -> Option<Ipv4Addr> {
    // UDP connect tidak mengirim paket; hanya memilih antarmuka menurut tabel rute
    let routed = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|s| s.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).and_then(|()| s.local_addr()))
        .ok()
        .and_then(|a| match a {
            SocketAddr::V4(a) if !a.ip().is_unspecified() => Some(*a.ip()),
            _ => None,
        });
    routed.or_else(|| lan_nets().first().map(|n| n.ip))
}

/// Hasil pencarian satu alamat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Handshake dijawab: mesin di mode Lokal.
    Lokal,
    /// Handshake ditolak: mode Lokal, tapi password komunikasi berbeda.
    Ditolak,
    /// Port terbuka tapi diam: kemungkinan mesin di mode Internet.
    Diam,
}

/// Mesin (atau kemungkinan mesin) yang ditemukan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Found {
    pub ip: Ipv4Addr,
    pub mode: Mode,
}

/// Cari mesin di semua jaringan lokal (TCP 5005). Butuh beberapa detik.
pub async fn scan(password: u32) -> Vec<Found> {
    let hosts = lan_nets().into_iter().flat_map(Net::hosts).collect();
    scan_hosts(hosts, DEFAULT_PORT, password, REPLY_TIMEOUT).await
}

async fn scan_hosts(hosts: Vec<Ipv4Addr>, port: u16, password: u32, reply: Duration) -> Vec<Found> {
    let limit = Arc::new(Semaphore::new(PARALLEL));
    let mut tasks = JoinSet::new();
    for ip in hosts {
        let limit = limit.clone();
        tasks.spawn(async move {
            let _slot = limit.acquire_owned().await.ok()?;
            probe(ip, port, password, reply).await
        });
    }
    let mut found = Vec::new();
    while let Some(r) = tasks.join_next().await {
        found.extend(r.ok().flatten());
    }
    found.sort_by_key(|f| f.ip);
    found.dedup_by_key(|f| f.ip);
    found
}

async fn probe(ip: Ipv4Addr, port: u16, password: u32, reply: Duration) -> Option<Found> {
    let mut s = timeout(CONNECT_TIMEOUT, TcpStream::connect((ip, port))).await.ok()?.ok()?;
    let mode = match timeout(reply, handshake(&mut s, password)).await {
        Ok(Some(true)) => Mode::Lokal,
        Ok(Some(false)) => Mode::Ditolak,
        _ => Mode::Diam,
    };
    Some(Found { ip, mode })
}

/// `Some(ok)` bila mesin menjawab handshake `80`.
async fn handshake(s: &mut TcpStream, password: u32) -> Option<bool> {
    s.write_all(&tcp::frame(cmd::HANDSHAKE, password, 0xFFFF_0001, 0, 1, None)).await.ok()?;
    let (mut buf, mut chunk) = (Vec::new(), [0u8; 256]);
    loop {
        let n = s.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(r) = tcp::parse_reply(&buf, 1, 0) {
            return Some(r.ok);
        }
    }
}

#[cfg(test)]
mod tests {
    use tokio::net::TcpListener;

    use super::*;

    #[test]
    fn host_jaringan() {
        // jaringan /23 seperti kantor asal proyek: server dan mesin beda "blok /24"
        let net = Net { ip: Ipv4Addr::new(192, 168, 1, 10), prefix: 23 };
        assert_eq!(net.to_string(), "192.168.0.0/23");
        let hosts: Vec<_> = net.hosts().collect();
        assert_eq!(hosts.len(), 509); // 510 host - komputer ini
        assert!(hosts.contains(&Ipv4Addr::new(192, 168, 0, 201)));
        assert!(!hosts.contains(&net.ip));
        assert_eq!(Net { ip: Ipv4Addr::new(10, 0, 0, 1), prefix: 32 }.hosts().count(), 0);
    }

    #[tokio::test]
    async fn pencarian_membedakan_mode() {
        // mesin mode Lokal: menjawab handshake dengan ack OK
        let lokal = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = lokal.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = lokal.accept().await.unwrap();
            let mut b = [0u8; 16];
            s.read_exact(&mut b).await.unwrap();
            s.write_all(&[0xAA, 0x55, 0x01, 0x01, 0, 0, 0, 0, 0x01, 0x00]).await.unwrap();
        });
        let found = scan_hosts(vec![Ipv4Addr::LOCALHOST], port, 0, REPLY_TIMEOUT).await;
        assert_eq!(found, [Found { ip: Ipv4Addr::LOCALHOST, mode: Mode::Lokal }]);

        // mode Internet: port terbuka tapi diam
        let diam = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = diam.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (_s, _) = diam.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let found = scan_hosts(vec![Ipv4Addr::LOCALHOST], port, 0, Duration::from_millis(200)).await;
        assert_eq!(found[0].mode, Mode::Diam);

        // port tertutup: tidak ditemukan
        let tutup = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap().port();
        assert!(scan_hosts(vec![Ipv4Addr::LOCALHOST], tutup, 0, REPLY_TIMEOUT).await.is_empty());
    }
}
