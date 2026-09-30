//! Koneksi dari mesin: kepala balasan ditulis `Content-Type`, `Content-Length`, `Date`.
//!
//! Mesin (Revo WF-206BNC, firmware v1.14) membaca `Content-Length` peka huruf besar-kecil. Tanpa itu
//! isi perintah dianggap kosong, sehingga perintah berparameter (`SET_TIME`, `GET_USER_INFO`, …)
//! dijawab `ERROR_INVALID_PARAMTER`, sedangkan perintah tanpa isi tetap jalan. hyper selalu menulis
//! nama header huruf kecil, dan opsi `title_case_headers` ikut mengubah `response_code` (mesin lalu
//! tidak menjawab sama sekali). Keduanya diuji di mesin asli 30-09-2026 lewat perantara yang
//! mengubah balasan.
//!
//! Mesin memakai HTTP/1.0 dengan satu request per koneksi ke `POST /`, jadi cukup kepala balasan
//! pertama di koneksi yang diawali `POST / ` yang dibetulkan. Koneksi lain (API, halaman status)
//! diteruskan apa adanya.

use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::task::{Context, Poll, ready};

use axum::extract::connect_info::Connected;
use axum::serve::{IncomingStream, Listener};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};

const DEVICE: &[u8] = b"POST / ";
const NAMES: [(&[u8], &[u8]); 3] = [(b"content-type", b"Content-Type"), (b"content-length", b"Content-Length"), (b"date", b"Date")];

/// `TcpListener` yang membungkus tiap koneksi dengan [`DeviceIo`].
pub struct DeviceListener(pub TcpListener);

impl Listener for DeviceListener {
    type Io = DeviceIo;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        let (io, addr) = Listener::accept(&mut self.0).await; // error accept ditangani axum (dicoba lagi)
        (DeviceIo { io, seen: Vec::new(), device: None, head: None, written: 0 }, addr)
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.0.local_addr()
    }
}

/// Alamat pengirim untuk `ConnectInfo` (axum hanya menyediakannya untuk `TcpListener` bawaan).
#[derive(Clone, Copy, Debug)]
pub struct Remote(pub SocketAddr);

impl Connected<IncomingStream<'_, DeviceListener>> for Remote {
    fn connect_info(stream: IncomingStream<'_, DeviceListener>) -> Self {
        Self(*stream.remote_addr())
    }
}

/// Satu koneksi: dari mesin atau bukan diputuskan dari byte pertama request.
pub struct DeviceIo {
    io: TcpStream,
    /// awal request sampai cukup untuk dibandingkan dengan `POST / `
    seen: Vec<u8>,
    device: Option<bool>,
    /// kepala balasan yang sudah dibetulkan (panjangnya sama dengan aslinya)
    head: Option<Vec<u8>>,
    written: usize,
}

impl AsyncRead for DeviceIo {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        let this = &mut *self;
        let before = buf.filled().len();
        ready!(Pin::new(&mut this.io).poll_read(cx, buf))?;
        if this.device.is_none() {
            let got = &buf.filled()[before..];
            let need = DEVICE.len() - this.seen.len();
            this.seen.extend(got.iter().take(need));
            if got.is_empty() || this.seen.len() == DEVICE.len() || !DEVICE.starts_with(&this.seen) {
                this.device = Some(this.seen == DEVICE);
            }
        }
        Poll::Ready(Ok(()))
    }
}

impl AsyncWrite for DeviceIo {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        let this = &mut *self;
        if this.device != Some(true) || this.head.as_ref().is_some_and(|h| this.written == h.len()) {
            return Pin::new(&mut this.io).poll_write(cx, buf);
        }
        if this.head.is_none() {
            // hyper menulis kepala dan isi dalam satu buffer, karena `is_write_vectored` bernilai false
            let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
                this.device = Some(false); // bukan kepala utuh: teruskan apa adanya
                return Pin::new(&mut this.io).poll_write(cx, buf);
            };
            this.head = Some(title_case(&buf[..end + 4]));
        }
        // sisa kepala yang sudah dibetulkan berada di posisi yang sama dengan awal `buf`
        let head = this.head.as_deref().unwrap_or_default();
        let n = ready!(Pin::new(&mut this.io).poll_write(cx, &head[this.written..]))?;
        this.written += n;
        Poll::Ready(Ok(n))
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.io).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.io).poll_shutdown(cx)
    }
}

/// `content-type:` → `Content-Type:` dst. di awal baris; nama lain (`response_code`, …) tetap.
fn title_case(head: &[u8]) -> Vec<u8> {
    let mut out = head.to_vec();
    let mut start = 0;
    while let Some(p) = out[start..].windows(2).position(|w| w == b"\r\n") {
        start += p + 2;
        for (lower, title) in NAMES {
            if out[start..].starts_with(lower) && out.get(start + lower.len()) == Some(&b':') {
                out[start..start + lower.len()].copy_from_slice(title);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn hanya_nama_header_standar_yang_diubah() {
        let head = b"HTTP/1.0 200 OK\r\ncontent-type: a\r\nresponse_code: OK\r\ncontent-length: 3\r\ndate: x\r\nx-date: y\r\n\r\n";
        assert_eq!(
            title_case(head),
            b"HTTP/1.0 200 OK\r\nContent-Type: a\r\nresponse_code: OK\r\nContent-Length: 3\r\nDate: x\r\nx-date: y\r\n\r\n"
        );
    }

    #[tokio::test]
    async fn balasan_ke_mesin_berhuruf_besar_api_tidak() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let app = axum::Router::new().fallback(|| async {
            ([("response_code", "OK"), ("cmd_code", "SET_TIME"), ("content-type", "application/octet-stream")], vec![7u8; 30])
        });
        tokio::spawn(async move { axum::serve(DeviceListener(l), app).await });
        let raw = |req: &'static [u8]| async move {
            let mut s = TcpStream::connect(addr).await.unwrap();
            s.write_all(req).await.unwrap();
            let mut out = Vec::new();
            s.read_to_end(&mut out).await.unwrap();
            String::from_utf8_lossy(&out).into_owned()
        };
        let dev = raw(b"POST / HTTP/1.0\r\nrequest_code: receive_cmd\r\nContent-Length: 0\r\n\r\n").await;
        for h in [
            "\r\nContent-Type: application/octet-stream\r\n",
            "\r\nContent-Length: 30\r\n",
            "\r\nDate: ",
            "\r\nresponse_code: OK\r\n",
            "\r\ncmd_code: SET_TIME\r\n",
        ] {
            assert!(dev.contains(h), "{h:?} tidak ada di {dev:?}");
        }
        assert!(dev.ends_with(&"\u{7}".repeat(30)));
        let api = raw(b"POST /api/x HTTP/1.0\r\nContent-Length: 0\r\n\r\n").await;
        assert!(api.contains("\r\ncontent-length: 30\r\n"), "{api:?}");
    }
}
