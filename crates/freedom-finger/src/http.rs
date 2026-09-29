//! Lapisan HTTP (axum): menerjemahkan request ke [`Service`] dan hasilnya ke response.
//! `POST /api/<endpoint>` = aplikasi (token Bearer); path lain = mesin (FkWeb, `POST /`).

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use crate::service::{DeviceRequest, Error, Service};

/// Data user lengkap (foto + jari + wajah) dikirim mesin per blok; batas ini untuk satu request.
const BODY_LIMIT: usize = 32 << 20;

struct App {
    // ponytail: satu kunci untuk semua request (SQLite juga satu penulis); cukup untuk satu mesin + aplikasi.
    svc: Mutex<Service>,
    token: String,
    agent: ureq::Agent,
}

pub fn router(svc: Service, token: String) -> Router {
    let agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).build().into();
    Router::new().fallback(handle).layer(DefaultBodyLimit::max(BODY_LIMIT)).with_state(Arc::new(App { svc: Mutex::new(svc), token, agent }))
}

async fn handle(State(app): State<Arc<App>>, uri: Uri, headers: HeaderMap, body: Bytes) -> Response {
    match uri.path().strip_prefix("/api/") {
        Some(ep) => api(&app, ep, &headers, &body),
        None => device(&app, &headers, &body),
    }
}

fn api(app: &App, ep: &str, h: &HeaderMap, body: &[u8]) -> Response {
    let auth = h.get(header::AUTHORIZATION).map_or(&[][..], |v| v.as_bytes());
    if !same(auth, format!("Bearer {}", app.token).as_bytes()) {
        return fail(StatusCode::UNAUTHORIZED, "token salah");
    }
    let Some(b) = serde_json::from_slice::<Value>(body).ok().filter(Value::is_object) else {
        return fail(StatusCode::BAD_REQUEST, "body harus JSON");
    };
    let r = app.svc.lock().unwrap_or_else(PoisonError::into_inner).api(ep, &b);
    match r {
        Ok(v) => axum::Json(v).into_response(),
        Err(Error::Invalid(m)) => fail(StatusCode::BAD_REQUEST, &m),
        Err(Error::NotFound) => fail(StatusCode::NOT_FOUND, "endpoint tidak ada"),
        Err(Error::Internal(m)) => {
            eprintln!("gagal /api/{ep}: {m}");
            fail(StatusCode::INTERNAL_SERVER_ERROR, &m)
        }
    }
}

fn device(app: &App, h: &HeaderMap, body: &[u8]) -> Response {
    let hv = |k: &str| h.get(k).and_then(|v| v.to_str().ok()).unwrap_or("");
    let req = DeviceRequest {
        request_code: hv("request_code"),
        dev_id: hv("dev_id"),
        trans_id: hv("trans_id"),
        blk_no: hv("blk_no").parse().unwrap_or(0),
        cmd_return_code: hv("cmd_return_code"),
        body,
    };
    let (r, webhook) = {
        let mut svc = app.svc.lock().unwrap_or_else(PoisonError::into_inner);
        (svc.device(&req), svc.webhook().map(str::to_owned))
    };
    match r {
        Ok(r) => {
            if let (Some(hook), Some(url)) = (r.hook, webhook) {
                let agent = app.agent.clone();
                // dikirim tanpa ditunggu: mesin tidak boleh menunggu penerima webhook
                tokio::task::spawn_blocking(move || {
                    let res = agent.post(&url).header("Content-Type", "application/json").send(hook.to_string());
                    if let Err(e) = res {
                        eprintln!("webhook gagal: {e}");
                    }
                });
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

fn fail(status: StatusCode, message: &str) -> Response {
    (status, axum::Json(json!({ "success": false, "message": message }))).into_response()
}

/// Bandingkan token dengan waktu tetap (tidak bocor lewat lama respons).
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}
