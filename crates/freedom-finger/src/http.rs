//! Lapisan HTTP (axum): menerjemahkan request ke [`Service`] dan hasilnya ke response.
//!
//! | Request | Untuk |
//! |---|---|
//! | `GET /` | halaman status (mesin, jumlah absen, cara memakai API) |
//! | `GET /status.json` | isi halaman status sebagai JSON, tanpa token (tanpa PIN atau data pribadi) |
//! | `GET /scan.json` | cari mesin di jaringan; hanya dari komputer server sendiri |
//! | `POST /api/<endpoint>` | aplikasi, dengan token Bearer |
//! | `GET /api/events` | aplikasi, token Bearer: absen baru dan hasil perintah sebagai SSE (isi sama dengan webhook) |
//! | `OPTIONS /api/*` | preflight CORS: `/api/*` boleh dipanggil dari origin lain (webview Tauri, browser) |
//! | `POST` path lain | mesin (FkWeb, `POST /`) |

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, State};
use axum::http::{Extensions, HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use serde_json::{Value, json};
use tokio::sync::broadcast::{self, error::RecvError};

use crate::net;
use crate::service::{DeviceRequest, Error, Service};

/// Data user lengkap (foto + jari + wajah) dikirim mesin per blok; batas ini untuk satu request.
const BODY_LIMIT: usize = 32 << 20;

struct App {
    // ponytail: satu kunci untuk semua request (SQLite juga satu penulis); cukup untuk beberapa mesin + aplikasi.
    svc: Mutex<Service>,
    token: String,
    agent: ureq::Agent,
    /// Callback (JSON) untuk semua pendengar `/api/events`.
    events: broadcast::Sender<String>,
}

impl App {
    fn svc(&self) -> std::sync::MutexGuard<'_, Service> {
        self.svc.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub fn router(svc: Service, token: String) -> Router {
    let agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).build().into();
    let events = broadcast::channel(256).0;
    let app = App { svc: Mutex::new(svc), token, agent, events };
    Router::new().fallback(handle).layer(DefaultBodyLimit::max(BODY_LIMIT)).with_state(Arc::new(app))
}

async fn handle(State(app): State<Arc<App>>, method: Method, uri: Uri, ext: Extensions, headers: HeaderMap, body: Bytes) -> Response {
    // tanpa ConnectInfo (uji lewat router langsung) alamat pengirim tidak diketahui
    let remote = ext.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
    match (method, uri.path()) {
        (Method::GET, "/") => respond(app.svc().status(), |s| Html(page(&s)).into_response()),
        (Method::GET, "/status.json") => respond(app.svc().status(), |s| axum::Json(s).into_response()),
        (Method::GET, "/scan.json") if remote.is_some_and(|ip| ip.is_loopback()) => scan(&app, 0).await,
        (Method::GET, "/scan.json") => fail(StatusCode::FORBIDDEN, "pencarian hanya dari komputer server; pakai /api/scan_devices"),
        (method, path) => match path.strip_prefix("/api/") {
            Some(ep) => {
                let mut r = match (method, ep) {
                    (Method::OPTIONS, _) => StatusCode::NO_CONTENT.into_response(),
                    (Method::GET, "events") if authorized(&app, &headers) => events(&app),
                    _ => api(&app, ep, &headers, &body).await,
                };
                // aplikasi web/Tauri memanggil dari origin lain; aksesnya tetap dijaga token
                r.headers_mut().extend([
                    (header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*")),
                    (header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("authorization, content-type")),
                    (header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST")),
                ]);
                r
            }
            None => device(&app, &headers, remote, &body),
        },
    }
}

fn authorized(app: &App, h: &HeaderMap) -> bool {
    let auth = h.get(header::AUTHORIZATION).map_or(&[][..], |v| v.as_bytes());
    same(auth, format!("Bearer {}", app.token).as_bytes())
}

async fn api(app: &App, ep: &str, h: &HeaderMap, body: &[u8]) -> Response {
    if !authorized(app, h) {
        return fail(StatusCode::UNAUTHORIZED, "token salah");
    }
    let Some(b) = serde_json::from_slice::<Value>(body).ok().filter(Value::is_object) else {
        return fail(StatusCode::BAD_REQUEST, "body harus JSON");
    };
    if ep == "scan_devices" {
        let password = b["password"].as_u64().and_then(|p| u32::try_from(p).ok()).unwrap_or(0);
        return scan(app, password).await;
    }
    let r = app.svc().api(ep, &b);
    respond(r, |v| axum::Json(v).into_response())
}

/// SSE: satu event `data: <JSON callback>` per absen baru atau hasil perintah. Tanpa riwayat: yang
/// terlewat saat terputus diambil lewat `get_attlog`/`get_result`.
fn events(app: &App) -> Response {
    let stream = futures_util::stream::unfold(app.events.subscribe(), |mut rx| async move {
        let data = match rx.recv().await {
            Ok(v) => v,
            // pendengar terlalu lambat (256 event tertinggal): beri tahu supaya mengejar lewat get_attlog
            Err(RecvError::Lagged(n)) => json!({ "type": "lagged", "missed": n }).to_string(),
            Err(RecvError::Closed) => return None,
        };
        Some((Ok::<_, Infallible>(Event::default().data(data)), rx))
    });
    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

/// Cari mesin di jaringan lokal (beberapa detik, di luar kunci `Service`).
async fn scan(app: &App, password: u32) -> Response {
    let found = net::scan(password).await;
    axum::Json(json!({ "success": true, "data": app.svc().describe(&found) })).into_response()
}

fn device(app: &App, h: &HeaderMap, remote: Option<std::net::IpAddr>, body: &[u8]) -> Response {
    let hv = |k: &str| h.get(k).and_then(|v| v.to_str().ok()).unwrap_or("");
    let req = DeviceRequest {
        request_code: hv("request_code"),
        dev_id: hv("dev_id"),
        trans_id: hv("trans_id"),
        blk_no: hv("blk_no").parse().unwrap_or(0),
        cmd_return_code: hv("cmd_return_code"),
        body,
        remote,
    };
    let (r, webhook) = {
        let mut svc = app.svc();
        (svc.device(&req), svc.webhook().map(str::to_owned))
    };
    match r {
        Ok(r) => {
            if let Some(hook) = r.hook.map(|h| h.to_string()) {
                let _ = app.events.send(hook.clone()); // gagal = belum ada pendengar
                if let Some(url) = webhook {
                    let agent = app.agent.clone();
                    // dikirim tanpa ditunggu: mesin tidak boleh menunggu penerima webhook
                    tokio::task::spawn_blocking(move || {
                        if let Err(e) = agent.post(&url).header("Content-Type", "application/json").send(hook) {
                            eprintln!("webhook gagal: {e}");
                        }
                    });
                }
            }
            let headers = [
                ("response_code", r.code.to_owned()),
                ("trans_id", r.trans_id),
                ("cmd_code", r.cmd_code),
                ("content-type", "application/octet-stream".to_owned()),
            ];
            (headers, r.body).into_response()
        }
        Err(Error::Internal(m)) => {
            eprintln!("gagal {}: {m}", req.request_code);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}

/// Hasil `Service` -> response: `ok` untuk nilai, JSON `{success: false}` untuk error.
fn respond(r: Result<Value, Error>, ok: impl FnOnce(Value) -> Response) -> Response {
    match r {
        Ok(v) => ok(v),
        Err(Error::Invalid(m)) => fail(StatusCode::BAD_REQUEST, &m),
        Err(Error::NotFound) => fail(StatusCode::NOT_FOUND, "endpoint tidak ada"),
        Err(Error::Internal(m)) => {
            eprintln!("gagal: {m}");
            fail(StatusCode::INTERNAL_SERVER_ERROR, &m)
        }
    }
}

fn fail(status: StatusCode, message: &str) -> Response {
    (status, axum::Json(json!({ "success": false, "message": message }))).into_response()
}

/// Bandingkan token dengan waktu tetap (tidak bocor lewat lama respons).
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Halaman status: dibaca pengguna awam, jadi isinya jawaban "sudah jalan belum?" dan "harus isi apa?".
fn page(s: &Value) -> String {
    let text = |v: &Value| esc(v.as_str().unwrap_or("-"));
    let server = s["server_ip"].as_str().map_or_else(|| "IP komputer ini".to_owned(), esc);
    let port = &s["port"];
    let devices = s["devices"].as_array().cloned().unwrap_or_default();
    let rows: String = devices
        .iter()
        .map(|d| {
            let on = d["connected"].as_bool().unwrap_or(false);
            format!(
                "<tr><td class=\"{}\">{}</td><td><code>{}</code></td><td>{}</td><td>{}</td><td>{}</td></tr>",
                if on { "ok" } else { "off" },
                if on { "● Terhubung" } else { "○ Terputus" },
                text(&d["cloud_id"]),
                text(&d["device_name"]),
                text(&d["ip"]),
                text(&d["last_activity"]),
            )
        })
        .collect();
    let setup = format!(
        "<p>Di mesin, buka <b>Menu → Jaringan</b> lalu isi: Mode <b>Internet</b>, Server IP <b>{server}</b>, Server Port \
         <b>{port}</b>, Server Req <b>Ya</b>. Mesin muncul di sini dalam ±2 menit.</p>"
    );
    let machines = if devices.is_empty() {
        format!("<p class=\"off\">Belum ada mesin yang terhubung.</p>{setup}")
    } else {
        let hint = if devices.iter().any(|d| d["connected"] == true) { String::new() } else { setup };
        format!("<table><tr><th>Status</th><th>Cloud ID</th><th>Nama</th><th>IP</th><th>Terakhir terlihat</th></tr>{rows}</table>{hint}")
    };
    format!(
        r#"<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Freedom Finger</title><style>
:root{{color-scheme:light dark;--bg:#fff;--fg:#1c1c1c;--muted:#666;--line:#ddd;--ok:#1a7f37;--off:#a65200}}
@media(prefers-color-scheme:dark){{:root{{--bg:#161616;--fg:#eee;--muted:#aaa;--line:#333;--ok:#3fb950;--off:#e3a008}}}}
body{{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:760px;margin:0 auto;padding:24px 16px}}
h1{{font-size:22px;margin:0}} h2{{font-size:16px;margin:28px 0 8px}} .muted{{color:var(--muted)}}
table{{width:100%;border-collapse:collapse}} td,th{{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}}
.ok{{color:var(--ok)}} .off{{color:var(--off)}} button{{font:inherit;padding:6px 14px;cursor:pointer}}
pre{{background:rgba(127,127,127,.12);padding:10px 12px;border-radius:6px;overflow-x:auto}}
</style></head><body>
<h1>Freedom Finger</h1>
<p class="muted">Server absensi lokal · versi {version} · http://{server}:{port}</p>
<h2>Mesin</h2>{machines}
<h2>Absen</h2><p>Hari ini <b>{today}</b> · total <b>{total}</b></p>
<h2>Cari mesin di jaringan</h2>
<p class="muted">Untuk mesin yang belum terhubung. Hanya bisa dari komputer server ini.</p>
<button id="cari">Cari mesin</button> <span id="info"></span><table id="hasil"></table>
<h2>Untuk developer</h2>
<pre>POST http://{server}:{port}/api/&lt;endpoint&gt;
Authorization: Bearer &lt;token&gt;</pre>
<p class="muted">Token ada di <code>{env_file}</code>. Daftar endpoint: README.</p>
<script>
const reload = setTimeout(() => location.reload(), 30000);
const esc = s => String(s).replace(/[&<>"]/g, c => ({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}})[c]);
document.getElementById("cari").onclick = async () => {{
  clearTimeout(reload);
  const info = document.getElementById("info");
  info.textContent = "Mencari… (sampai 10 detik)";
  try {{
    const r = await fetch("/scan.json"), j = await r.json();
    if (!r.ok) throw new Error(j.message);
    info.textContent = j.data.length ? j.data.length + " ditemukan" : "Tidak ada mesin ditemukan di jaringan ini";
    document.getElementById("hasil").innerHTML = j.data.map(d => `<tr><td><code>${{esc(d.ip)}}</code></td><td>${{esc(d.note)}}</td></tr>`).join("");
  }} catch (e) {{ info.textContent = "Gagal: " + e.message; }}
}};
</script></body></html>"#,
        version = text(&s["version"]),
        today = s["logs_today"],
        total = s["logs_total"],
        env_file = text(&s["env_file"]),
    )
}
