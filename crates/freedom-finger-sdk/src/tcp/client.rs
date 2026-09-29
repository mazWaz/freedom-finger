use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::record::{self, INFO_SIZE, LOG_SIZE, LogRecord, USER_SIZE, UserEntry};
use super::{Reply, cmd, frame, parse_reply, status};
use crate::time::WallTime;

/// WiFi mesin lambat (ping sampai 1,2 detik), jadi batas tunggu per perintah dibuat longgar.
const TIMEOUT: Duration = Duration::from_secs(15);

/// Kegagalan perintah TCP 5005.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Koneksi gagal atau terputus.
    #[error("koneksi: {0}")]
    Io(#[from] std::io::Error),
    /// Password komunikasi salah, atau mesin tidak di mode Lokal.
    #[error("handshake ditolak (password komunikasi salah, atau mesin tidak di mode Lokal)")]
    HandshakeRejected,
    /// Di mode Internet port 5005 tetap menerima koneksi, tapi handshake tidak pernah dijawab.
    #[error("mesin tidak menjawab handshake (mesin di mode Internet? pindah ke mode Lokal di menu Jaringan)")]
    NoHandshake,
    /// Mesin menjawab gagal (ack `FD`).
    #[error("{what} ditolak mesin (status {status})")]
    Rejected {
        /// Operasi yang ditolak.
        what: &'static str,
        /// Kode error dari mesin (`docs/protokol.md` bagian 3).
        status: u32,
    },
    /// Mesin tidak menjawab perintah ini dalam 15 detik.
    #[error("timeout menunggu balasan cmd 0x{0:02x}")]
    Timeout(u8),
    /// Mesin menutup koneksi.
    #[error("koneksi ditutup mesin")]
    Closed,
    /// Data dari mesin atau argumen tidak sesuai format.
    #[error("data dari mesin tidak valid: {0}")]
    Invalid(&'static str),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Klien blocking TCP 5005. Satu koneksi, satu perintah pada satu waktu (sesuai perilaku mesin).
///
/// ```no_run
/// use freedom_finger_sdk::{tcp::Client, time::{WallTime, WIB}};
/// let mut fk = Client::connect(("192.168.1.201", 5005), 0)?;
/// for log in fk.logs()? {
///     println!("{} {} aksi {}", log.pin, log.time, log.action());
/// }
/// fk.set_time(WallTime::now(WIB))?;
/// # Ok::<(), freedom_finger_sdk::tcp::Error>(())
/// ```
#[derive(Debug)]
pub struct Client {
    sock: TcpStream,
    seq: u16,
    debug: bool,
}

impl Client {
    /// Hubungkan dan lakukan handshake (`80` dengan password komunikasi, lalu `13` tiga kali).
    pub fn connect(addr: impl ToSocketAddrs, password: u32) -> Result<Self> {
        let addr = addr.to_socket_addrs()?.next().ok_or(Error::Invalid("alamat kosong"))?;
        let sock = TcpStream::connect_timeout(&addr, TIMEOUT)?;
        sock.set_read_timeout(Some(Duration::from_millis(250)))?;
        let mut c = Self { sock, seq: 0, debug: false };
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(1, |d| d.subsec_nanos());
        let hs = c.xfer(cmd::HANDSHAKE, password, 0xFFFF_0000 | (1 + nanos % 0xFFFE), None, 0).map_err(|e| match e {
            Error::Timeout(_) => Error::NoHandshake,
            e => e,
        })?;
        if !hs.ok {
            return Err(Error::HandshakeRejected);
        }
        c.xfer(cmd::DEVICE_INFO, 0, 0, None, 0x30)?;
        c.xfer(cmd::DEVICE_INFO, 1, 0, None, 0x400)?;
        c.xfer(cmd::DEVICE_INFO, 0, 0, None, 0x30)?;
        Ok(c)
    }

    /// Cetak hex setiap bingkai ke stderr.
    pub fn set_debug(&mut self, on: bool) {
        self.debug = on;
    }

    /// Kirim satu perintah mentah. `read` = jumlah byte data yang ingin dibaca (0 untuk perintah tulis).
    pub fn xfer(&mut self, cmd: u8, p1: u32, p2: u32, send: Option<&[u8]>, read: usize) -> Result<Reply> {
        self.seq = self.seq % 0xFFFF + 1;
        let len = send.map_or(read, <[u8]>::len);
        let out = frame(cmd, p1, p2, u16::try_from(len).map_err(|_| Error::Invalid("data > 65535 byte"))?, self.seq, send);
        if self.debug {
            eprintln!(">> {}", hex(&out));
        }
        self.sock.write_all(&out)?;
        let (deadline, mut buf, mut chunk) = (Instant::now() + TIMEOUT, Vec::new(), [0u8; 4096]);
        loop {
            if let Some(r) = parse_reply(&buf, self.seq, read) {
                if self.debug {
                    eprintln!("<< ok={} status={} +{}B", r.ok, r.status, r.data.len());
                }
                return Ok(r);
            }
            if Instant::now() > deadline {
                return Err(Error::Timeout(cmd));
            }
            match self.sock.read(&mut chunk) {
                Ok(0) => return Err(Error::Closed),
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(e) => return Err(e.into()),
            }
        }
    }

    fn must(&mut self, what: &'static str, cmd: u8, p1: u32, p2: u32, send: Option<&[u8]>, read: usize) -> Result<Reply> {
        let r = self.xfer(cmd, p1, p2, send, read)?;
        if r.ok { Ok(r) } else { Err(Error::Rejected { what, status: r.status }) }
    }

    /// Data besar dibaca per halaman <= 1024 byte: `p2` halaman pertama = `first`, berikutnya = halaman << 16.
    fn read_paged(&mut self, what: &'static str, cmd: u8, p1: u32, first: u32, total: usize) -> Result<Vec<u8>> {
        let mut out = Vec::with_capacity(total);
        for page in 0u32.. {
            if out.len() >= total {
                break;
            }
            let n = (total - out.len()).min(1024);
            out.extend(self.must(what, cmd, p1, if page == 0 { first } else { page << 16 }, None, n)?.data);
        }
        Ok(out)
    }

    /// Nilai status `B4` (lihat [`status`]).
    pub fn status(&mut self, idx: u32) -> Result<u32> {
        Ok(self.must("status", cmd::STATUS, idx, 0xFFFF_0000, None, 0)?.status)
    }

    /// Baca jam mesin (`B2`).
    pub fn time(&mut self) -> Result<WallTime> {
        let r = self.must("baca jam", cmd::GET_TIME, 0, 0, None, 8)?;
        record::parse_time(&r.data).ok_or(Error::Invalid("jam"))
    }

    /// Setel jam mesin (`B3`); hari dalam minggu dihitung otomatis.
    pub fn set_time(&mut self, t: WallTime) -> Result<()> {
        self.must("set jam", cmd::SET_TIME, 0, 0, Some(&record::time_block(t)), 0).map(drop)
    }

    /// Semua log (`A4`). Tidak menandai log "sudah dibaca", jadi aman bagi software lain.
    pub fn logs(&mut self) -> Result<Vec<LogRecord>> {
        let count = self.status(status::TOTAL_LOGS)?;
        let raw = self.read_paged("baca log", cmd::ALL_LOGS, 0, count, count as usize * LOG_SIZE)?;
        Ok(raw.chunks_exact(LOG_SIZE).filter_map(LogRecord::parse).collect())
    }

    /// Daftar semua user (`97`).
    pub fn users(&mut self) -> Result<Vec<UserEntry>> {
        let total = self.status(status::TOTAL_USERS)? * USER_SIZE as u32;
        let raw = self.read_paged("daftar user", cmd::USER_LIST, total, total, total as usize)?;
        Ok(raw.chunks_exact(USER_SIZE).filter_map(UserEntry::parse).collect())
    }

    /// Blok info user 204 byte untuk bulan tertentu (nama, jabatan, jadwal shift). PIN yang tidak ada
    /// ditolak dengan status 3.
    pub fn info(&mut self, pin: &str, month: WallTime) -> Result<Vec<u8>> {
        let p2 = record::month_selector(month);
        self.must("pilih user", cmd::USER_INFO_READ, 0, p2, Some(&record::pin_block(pin)), 0)?;
        Ok(self.must("baca info user", cmd::USER_INFO_READ, 1, p2, None, INFO_SIZE)?.data)
    }

    /// Nama user, dari blok info bulan `month`.
    pub fn name(&mut self, pin: &str, month: WallTime) -> Result<String> {
        Ok(record::info_name(&self.info(pin, month)?))
    }

    /// Tulis nama; bila PIN belum ada, mesin membuat user baru (tanpa jabatan dan jadwal: pakai [`Client::add_user`]).
    pub fn set_name(&mut self, pin: &str, name: &str, month: WallTime) -> Result<()> {
        self.must("tulis nama", cmd::USER_INFO_WRITE, 0x15, record::month_selector(month), Some(&record::name_block(pin, name)), 0)
            .map(drop)
    }

    /// Tulis jabatan (bila PostId 1-16) lalu jadwal bulan milik blok (urutan SDK `SetUserInfoEx`).
    pub fn set_info(&mut self, blk: &[u8; INFO_SIZE]) -> Result<()> {
        let month = WallTime { year: u16::from_le_bytes([blk[168], blk[169]]), month: blk[170], day: 15, hour: 0, minute: 0, second: 0 };
        let p2 = record::month_selector(month);
        if (1..=16).contains(&u32::from_le_bytes([blk[164], blk[165], blk[166], blk[167]])) {
            self.must("tulis jabatan", cmd::USER_INFO_WRITE, 0x16, p2, Some(blk), 0)?;
        }
        self.must("tulis jadwal", cmd::USER_INFO_WRITE, 0x17, p2, Some(blk), 0).map(drop)
    }

    /// User baru yang byte-demi-byte sama dengan user buatan mesin: nama, lalu jabatan 1 + jadwal bawaan.
    pub fn add_user(&mut self, pin: &str, name: &str, month: WallTime) -> Result<()> {
        self.set_name(pin, name, month)?;
        self.set_info(&record::default_info(pin, name, month))
    }

    /// Aktifkan (`94`) atau nonaktifkan (`95`) user.
    pub fn set_active(&mut self, pin: &str, on: bool) -> Result<()> {
        let c = if on { cmd::ENABLE } else { cmd::DISABLE };
        self.must("ubah status aktif", c, 1, 0, Some(&record::pin_block(pin)), 0).map(drop)
    }

    /// `true` = manager (admin), `false` = user biasa.
    pub fn set_manager(&mut self, pin: &str, on: bool) -> Result<()> {
        self.must("ubah hak akses", cmd::PRIVILEGE, 1, u32::from(on), Some(&record::pin_block(pin)), 0).map(drop)
    }

    /// Hapus satu user beserta semua datanya (`93` p2 = 12). Perintah hapus massal (`C1`) sengaja tidak ada.
    pub fn delete_user(&mut self, pin: &str) -> Result<()> {
        self.must("hapus user", cmd::DELETE, 1, 12, Some(&record::pin_block(pin)), 0).map(drop)
    }

    /// Kunci (`false`) atau buka (`true`) keypad mesin.
    pub fn set_keypad(&mut self, unlocked: bool) -> Result<()> {
        self.must("kunci keypad", cmd::KEYPAD, u32::from(unlocked), 0, None, 0).map(drop)
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
