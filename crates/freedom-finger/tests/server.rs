//! Uji server: mesin disimulasikan dengan format yang disadap dari mesin asli (29-09-2026),
//! lewat router langsung (tanpa jaringan). Hanya webhook yang memakai penerima HTTP di 127.0.0.1.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::Body as HttpBody;
use axum::http::{Request, Response};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use freedom_finger::config::Config;
use freedom_finger::http::router;
use freedom_finger::service::Service;
use freedom_finger::store::Store;
use freedom_finger_sdk::fkweb::Body;
use freedom_finger_sdk::time::{WIB, WallTime};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

const TOKEN: &str = "tttttttttttttttt";

struct Sim {
    app: Router,
    hooks: Arc<Mutex<Vec<Value>>>,
    photos: std::path::PathBuf,
}

impl Drop for Sim {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.photos);
    }
}

async fn sim(name: &str) -> Sim {
    let hooks = Arc::new(Mutex::new(Vec::new()));
    let h = hooks.clone();
    let receiver = Router::new().fallback(move |axum::Json(v): axum::Json<Value>| async move { h.lock().unwrap().push(v) });
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", l.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(l, receiver).await });
    let photos = std::env::temp_dir().join(format!("absensi-{}-{name}", std::process::id()));
    let cfg = Config {
        dir: photos.clone(),
        port: 0,
        token: TOKEN.into(),
        db: ":memory:".into(),
        tz: jiff::tz::TimeZone::get("Asia/Jakarta").unwrap(),
        webhook: Some(url),
        devices: None,
        photos: photos.clone(),
    };
    Sim { app: router(Service::new(Store::open(":memory:").unwrap(), &cfg), TOKEN.into()), hooks, photos }
}

fn enc(json: Value, bins: Vec<Vec<u8>>) -> Vec<u8> {
    Body::new(json.to_string(), bins).encode()
}

fn now14() -> String {
    WallTime::now(WIB).fk14()
}

impl Sim {
    async fn send(&self, req: Request<HttpBody>) -> Response<HttpBody> {
        self.app.clone().oneshot(req).await.unwrap()
    }

    async fn api(&self, ep: &str, mut body: Value) -> Value {
        if body["cloud_id"].is_null() {
            body["cloud_id"] = "MESIN01".into();
        }
        let req = Request::post(format!("/api/{ep}"))
            .header("authorization", format!("Bearer {TOKEN}"))
            .body(HttpBody::from(body.to_string()))
            .unwrap();
        serde_json::from_slice(&self.send(req).await.into_body().collect().await.unwrap().to_bytes()).unwrap()
    }

    async fn dev(&self, code: &str, body: Vec<u8>, extra: &[(&str, &str)]) -> Response<HttpBody> {
        let mut req = Request::post("/").header("request_code", code).header("dev_id", "MESIN01");
        for (k, v) in extra {
            req = req.header(*k, *v);
        }
        self.send(req.body(HttpBody::from(body)).unwrap()).await
    }

    /// `receive_cmd` -> (response_code, cmd_code, body perintah)
    async fn poll(&self, fk_time: &str) -> (String, String, Body) {
        let r = self.dev("receive_cmd", enc(json!({ "fk_name": "Fingerspot", "fk_time": fk_time, "fk_info": {} }), vec![]), &[]).await;
        let h = |k| r.headers()[k].to_str().unwrap().to_owned();
        let (code, cmd) = (h("response_code"), h("cmd_code"));
        (code, cmd, Body::decode(&r.into_body().collect().await.unwrap().to_bytes()))
    }

    async fn result(&self, trans: &str, body: Vec<u8>) {
        self.dev("send_cmd_result", body, &[("trans_id", trans), ("cmd_return_code", "OK")]).await;
    }

    /// Webhook dikirim tanpa ditunggu: tunggu sampai `n` callback masuk.
    async fn hooks(&self, n: usize) -> Vec<Value> {
        for _ in 0..200 {
            if self.hooks.lock().unwrap().len() >= n {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        self.hooks.lock().unwrap().clone()
    }
}

fn parsed(b: &Body) -> Value {
    serde_json::from_str(&b.json).unwrap()
}

#[tokio::test]
async fn set_userinfo_password_ascii_di_backup_10() {
    let s = sim("pw").await;
    let data = json!({ "pin": "99999", "name": "Tes Relay", "privilege": "1", "password": "1234", "rfid": "", "template": "" });
    assert_eq!(s.api("set_userinfo", json!({ "trans_id": "1", "data": data })).await, json!({ "success": true, "trans_id": "1" }));
    let (_, cmd, b) = s.poll(&now14()).await;
    assert_eq!(cmd, "SET_USER_INFO");
    assert_eq!(
        parsed(&b),
        json!({ "user_id": "99999", "user_name": "Tes Relay", "user_privilege": "USER",
                "enroll_data_array": [{ "backup_number": 10, "enroll_data": "BIN_1" }] })
    );
    assert_eq!(b.bins, [b"1234".to_vec()]);
    assert_eq!(s.poll(&now14()).await.0, "ERROR_NO_CMD"); // satu perintah satu kali
    s.result("1", vec![]).await;
    assert_eq!(s.api("get_result", json!({ "trans_id": "1" })).await["data"], json!({ "status": "1" }));
    let hooks = s.hooks(1).await;
    assert_eq!(hooks, [json!({ "type": "set_userinfo", "cloud_id": "MESIN01", "trans_id": "1", "data": { "status": "1" } })]);
}

#[tokio::test]
async fn get_userinfo_template_dipakai_ulang_jadi_admin_tanpa_kehilangan_jari() {
    let s = sim("tpl").await;
    s.api("get_userinfo", json!({ "trans_id": "2", "pin": "2" })).await;
    assert_eq!(parsed(&s.poll(&now14()).await.2), json!({ "user_id": "2" }));
    let tpl = vec![7u8; 800];
    let user = json!({ "enable_flag": "ON", "enroll_data_array": [{ "backup_number": 0, "enroll_data": "BIN_1" }],
                       "user_id": "2", "user_name": "Budi Santoso", "user_privilege": "USER" });
    s.result("2", enc(user, vec![tpl.clone()])).await;
    let info = s.api("get_result", json!({ "trans_id": "2" })).await["data"].clone();
    for (k, v) in [("pin", "2"), ("name", "Budi Santoso"), ("privilege", "1"), ("finger", "1"), ("face", "0"), ("password", "")] {
        assert_eq!(info[k], v, "{k}");
    }
    s.api("set_userinfo", json!({ "trans_id": "3", "data": { "pin": "2", "privilege": "2", "template": info["template"] } })).await;
    let (_, _, q) = s.poll(&now14()).await;
    assert_eq!(
        parsed(&q),
        json!({ "user_id": "2", "user_name": "Budi Santoso", "user_privilege": "MANAGER",
                "enroll_data_array": [{ "backup_number": 0, "enroll_data": "BIN_1" }] })
    );
    assert_eq!(q.bins, [tpl]);
}

#[tokio::test]
async fn realtime_glog_ke_get_attlog_log_ganda_diabaikan() {
    let s = sim("glog").await;
    let g = enc(
        json!({ "fk_bin_data_lib": "FKDataHS103", "io_mode": 33554432, "io_time": "20260331180326", "log_image": null,
                "user_id": "13", "verify_mode": 268435456 }),
        vec![],
    );
    s.dev("realtime_glog", g.clone(), &[("trans_id", "RTLogSendAction")]).await;
    s.dev("realtime_glog", g, &[("trans_id", "RTLogSendAction")]).await;
    let r = s.api("get_attlog", json!({ "trans_id": "4", "start_date": "2026-03-31", "end_date": "2026-03-31" })).await;
    assert_eq!(r["data"], json!([{ "pin": "13", "scan_date": "2026-03-31 18:03:26", "verify": 1, "status_scan": 1 }]));
    assert_eq!(s.hooks(1).await.len(), 1); // webhook hanya untuk log baru
}

#[tokio::test]
async fn jam_2015_set_time_otomatis_reg_online_get_all_pin_token_salah() {
    let s = sim("jam").await;
    let (_, cmd, p) = s.poll("20150101001922").await;
    assert_eq!(cmd, "SET_TIME");
    assert_eq!(parsed(&p)["time"].as_str().unwrap()[..8], now14()[..8]);
    s.api("reg_online", json!({ "trans_id": "5", "pin": "2", "verification": 0 })).await;
    assert_eq!(parsed(&s.poll(&now14()).await.2), json!({ "cmd": "enter_enroll", "param": { "user_id": "2", "backup_number": 0 } }));
    s.api("get_all_pin", json!({ "trans_id": "6" })).await;
    assert_eq!(s.poll(&now14()).await.1, "GET_USER_ID_LIST");
    let rec = |pin: &str| [pin.as_bytes(), &vec![0; 36 - pin.len()]].concat();
    s.result(
        "6",
        enc(json!({ "one_user_id_size": 36, "user_id_array": "BIN_1", "user_id_count": 2 }), vec![[rec("1"), rec("2")].concat()]),
    )
    .await;
    assert_eq!(s.api("get_result", json!({ "trans_id": "6" })).await["data"], json!({ "total": 2, "pin_arr": ["1", "2"] }));
    let bad = Request::post("/api/get_all_pin").header("authorization", "Bearer salah").body(HttpBody::from("{}")).unwrap();
    assert_eq!(s.send(bad).await.status(), 401);
    // validasi input
    assert_eq!(s.api("get_all_pin", json!({ "trans_id": "6" })).await["message"], "trans_id sudah dipakai");
    assert_eq!(s.api("get_userinfo", json!({ "trans_id": "x1", "pin": "12a" })).await["message"], "pin harus angka 1-22 digit");
    assert_eq!(s.api("tidak_ada", json!({ "trans_id": "x2" })).await["message"], "endpoint tidak ada");
}

#[tokio::test]
async fn sync_attlog_record_48_byte_masuk_get_attlog() {
    let s = sim("sync").await;
    s.api("sync_attlog", json!({ "trans_id": "7" })).await;
    assert_eq!(s.poll(&now14()).await.1, "GET_LOG_DATA");
    // record asli dari mesin (sama dengan uji `record_log_asli` di SDK)
    let rec = [b"7".as_slice(), &[0; 31], &[1, 0, 0, 0x0a, 0xfa, 0x31, 0x3a, 0x92, 0, 0, 0, 2, 0, 0, 0, 0x10]].concat();
    s.result("7", enc(json!({ "log_count": 1, "one_log_size": 48 }), vec![rec])).await;
    assert_eq!(s.api("get_result", json!({ "trans_id": "7" })).await["data"], json!({ "log_count": 1, "one_log_size": 48, "added": 1 }));
    let r = s.api("get_attlog", json!({ "trans_id": "8", "start_date": "2026-03-26", "end_date": "2026-03-26" })).await;
    assert_eq!(r["data"], json!([{ "pin": "7", "scan_date": "2026-03-26 17:36:10", "verify": 1, "status_scan": 1 }]));
}

#[tokio::test]
async fn realtime_enroll_data_get_backup_set_userinfo_memulihkan_user() {
    let s = sim("backup").await;
    let (photo, fp) = (vec![1u8; 100], vec![2u8; 800]);
    let user = json!({ "enroll_data_array": [{ "backup_number": 0, "enroll_data": "BIN_2" }], "user_id": "13",
                       "user_name": "Andi", "user_photo": "BIN_1", "user_privilege": "MANAGER" });
    s.dev("realtime_enroll_data", enc(user, vec![photo.clone(), fp.clone()]), &[("trans_id", "RTEnrollDataAction")]).await;
    let bk = s.api("get_backup", json!({ "pin": "13" })).await["data"].clone();
    assert_eq!((&bk["pin"], &bk["name"], &bk["privilege"]), (&json!("13"), &json!("Andi"), &json!("2")));
    s.api("set_userinfo", json!({ "trans_id": "9", "data": { "pin": "13", "template": bk["template"] } })).await;
    let (_, _, q) = s.poll(&now14()).await;
    assert_eq!(
        parsed(&q),
        json!({ "user_id": "13", "user_name": "Andi", "user_privilege": "MANAGER", "user_photo": "BIN_1",
                "enroll_data_array": [{ "backup_number": 0, "enroll_data": "BIN_2" }] })
    );
    assert_eq!(q.bins, [photo, fp]);
    assert!(B64.decode(bk["template"].as_str().unwrap()).is_ok());
    // get_users: tanpa template, hak akses kode API; cloud_id kosong = semua mesin
    let users = s.api("get_users", json!({ "cloud_id": "" })).await["data"].clone();
    assert_eq!(users.as_array().unwrap().len(), 1);
    assert_eq!((&users[0]["cloud_id"], &users[0]["pin"], &users[0]["name"]), (&json!("MESIN01"), &json!("13"), &json!("Andi")));
    assert_eq!((&users[0]["privilege"], users[0].get("template")), (&json!("2"), None));
    assert_eq!(s.api("get_users", json!({ "cloud_id": "MESIN02" })).await["data"], json!([]));
}

#[tokio::test]
async fn realtime_glog_dengan_foto_ke_file_dan_webhook_attlog() {
    let s = sim("foto").await;
    let jpg = vec![0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
    let g = json!({ "fk_bin_data_lib": "FKDataHS103", "io_mode": 16777216, "io_time": "20260929140000", "log_image": "BIN_1",
                    "user_id": "2", "verify_mode": 1073741824 });
    s.dev("realtime_glog", enc(g, vec![jpg.clone()]), &[("trans_id", "RTLogSendAction")]).await;
    let r = s.api("get_attlog", json!({ "trans_id": "10", "start_date": "2026-09-29", "end_date": "2026-09-29" })).await;
    let row = &r["data"][0];
    assert_eq!(
        (&row["pin"], &row["scan_date"], &row["verify"], &row["status_scan"]),
        (&json!("2"), &json!("2026-09-29 14:00:00"), &json!(4), &json!(0))
    );
    assert_eq!(std::fs::read(row["photo"].as_str().unwrap()).unwrap(), jpg);
    assert_eq!(
        s.hooks(1).await,
        [json!({ "type": "attlog", "cloud_id": "MESIN01",
                 "data": { "pin": "2", "scan": "2026-09-29 14:00", "verify": "4", "status_scan": "0", "photo": row["photo"] } })]
    );
}

#[tokio::test]
async fn data_besar_per_blok_digabung() {
    let s = sim("blok").await;
    let user = enc(json!({ "user_id": "5", "user_name": "Siti", "user_privilege": "USER" }), vec![vec![9u8; 12_000]]);
    let (a, b) = user.split_at(5000);
    s.dev("realtime_enroll_data", a.to_vec(), &[("blk_no", "1")]).await;
    s.dev("realtime_enroll_data", b.to_vec(), &[("blk_no", "0")]).await;
    let bk = s.api("get_backup", json!({ "pin": "5" })).await["data"].clone();
    assert_eq!(B64.decode(bk["template"].as_str().unwrap()).unwrap(), user);
}

/// Satu event SSE `data: <json>`; kriteria PRD 6.7: tiba kurang dari 1 detik.
async fn event(body: &mut HttpBody) -> Value {
    let f = tokio::time::timeout(Duration::from_secs(1), body.frame()).await.expect("event < 1 detik").unwrap().unwrap();
    let text = String::from_utf8(f.into_data().unwrap().to_vec()).unwrap();
    serde_json::from_str(text.strip_prefix("data: ").unwrap().trim_end()).unwrap()
}

#[tokio::test]
async fn events_sse_absen_baru_dan_hasil_perintah() {
    let s = sim("sse").await;
    let req = |auth: String| Request::get("/api/events").header("authorization", auth).body(HttpBody::empty()).unwrap();
    assert_eq!(s.send(req("Bearer salah".into())).await.status(), 401);
    let r = s.send(req(format!("Bearer {TOKEN}"))).await;
    assert_eq!(r.headers()["content-type"], "text/event-stream");
    assert_eq!(r.headers()["access-control-allow-origin"], "*");
    let pre = s.send(Request::options("/api/events").body(HttpBody::empty()).unwrap()).await;
    assert_eq!(
        (pre.status().as_u16(), &pre.headers()["access-control-allow-headers"]),
        (204, &"authorization, content-type".parse().unwrap())
    );
    let mut body = r.into_body();
    let g = json!({ "fk_bin_data_lib": "FKDataHS103", "io_mode": 16777216, "io_time": "20260929080000", "log_image": null,
                    "user_id": "7", "verify_mode": 268435456 });
    s.dev("realtime_glog", enc(g, vec![]), &[("trans_id", "RTLogSendAction")]).await;
    assert_eq!(
        event(&mut body).await,
        json!({ "type": "attlog", "cloud_id": "MESIN01", "data": { "pin": "7", "scan": "2026-09-29 08:00", "verify": "1", "status_scan": "0" } })
    );
    s.api("get_all_pin", json!({ "trans_id": "11" })).await;
    s.poll(&now14()).await;
    s.result("11", enc(json!({ "one_user_id_size": 36, "user_id_count": 0 }), vec![])).await;
    assert_eq!(
        event(&mut body).await,
        json!({ "type": "get_all_pin", "cloud_id": "MESIN01", "trans_id": "11", "data": { "total": 0, "pin_arr": [] } })
    );
}

#[test]
fn backup_to_salinan_utuh_dan_tidak_menimpa() {
    let dir = std::env::temp_dir().join(format!("ff-backup-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let db = Store::open(dir.join("absensi.db")).unwrap();
    let log = |scan_date| freedom_finger::store::Log { pin: "2", scan_date, io_mode: 1 << 24, verify_mode: 1 << 28, photo: None };
    db.insert_logs("MESIN01", [log("2026-09-29 08:00:00"), log("2026-09-29 17:00:00")]).unwrap();
    let copy = dir.join("salinan.db");
    db.backup_to(&copy).unwrap();
    assert_eq!(Store::open(&copy).unwrap().count_logs("").unwrap(), 2);
    assert!(db.backup_to(&copy).is_err()); // file tujuan sudah ada
    std::fs::remove_dir_all(&dir).unwrap();
}
