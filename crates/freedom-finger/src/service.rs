//! Logika server tanpa HTTP: request mesin (FkWeb, `docs/protokol.md` bagian 14) dan endpoint API
//! bergaya developer.fingerspot.io. Pemetaan API -> perintah FkWeb disadap lewat relay pada
//! 29-09-2026 (`docs/riset.md` bagian 10).
//!
//! | Endpoint | Perintah mesin | Catatan |
//! |---|---|---|
//! | `get_attlog {start_date, end_date}` | - | dari database, tanpa batas 2 hari; `photo` = path file |
//! | `get_device` | - | firmware, jam mesin, aktivitas terakhir |
//! | `get_all_pin` | `GET_USER_ID_LIST` | |
//! | `get_userinfo {pin}` | `GET_USER_INFO` | `template` = body FkWeb base64, bisa dipakai lagi di `set_userinfo` |
//! | `set_userinfo {data:{pin,name,privilege,password,rfid,template}}` | `SET_USER_INFO` | mengganti **seluruh** data user |
//! | `delete_userinfo {pin}` | `DELETE_USER` | |
//! | `reg_online {pin, verification}` | `SET_COMMAND enter_enroll` | 0-9 jari, 12 wajah |
//! | `set_time {timezone}` | `SET_TIME` | jam dihitung saat perintah dikirim |
//! | `restart_device` | `RESET_FK` | mesin tidak membalas |
//! | `sync_attlog` | `GET_LOG_DATA` | tambahan: semua log mesin masuk database |
//! | `get_backup {pin}` | - | tambahan: cadangan terakhir user, `template` untuk memulihkan |
//! | `get_result {trans_id}` | - | `pending`/`sent`/`done`/`timeout` + data hasil |
//! | `get_devices` | - | tambahan: semua mesin yang pernah terhubung, IP, dan status terhubung |
//! | `scan_devices {password?}` | - | tambahan: cari mesin di jaringan lokal (lapisan `http`, modul `net`) |
//!
//! `cloud_id` boleh kosong bila baru satu mesin yang terhubung. `trans_id` perintah async boleh
//! kosong: server membuatnya. Perintah async membalas `{success, trans_id}`; hasilnya lewat
//! `get_result` dan webhook.

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use freedom_finger_sdk::fkweb::{
    Body, Command, Enroll, LogData, Poll, RealtimeLog, UserIdList, UserInfo, backup_number, privilege, request_code, response_code,
};
use freedom_finger_sdk::tcp::record::USER_SIZE;
use freedom_finger_sdk::time::WallTime;
use jiff::Timestamp;
use jiff::tz::TimeZone;
use serde_json::{Value, json};

use crate::config::{Config, ENV_FILE};
use crate::net::{Found, Mode};
use crate::store::{Log, Store};

/// Mesin diam saja untuk perintah/PIN yang tidak dikenal: perintah terkirim tanpa hasil selama ini = timeout.
const TIMEOUT_SECS: i64 = 5 * 60;
/// Mesin bertanya setiap ±20 detik sampai 2 menit; lebih lama dari ini tanpa kabar = terputus.
const CONNECTED_SECS: i64 = 3 * 60;
/// Jam mesin kembali ke 2015 bila listrik mati (baterai RTC): disetel ulang bila selisihnya lebih dari ini.
const MAX_DRIFT_SECS: i64 = 120;
/// Hak akses API <-> FkWeb. "3" = subadmin [DUGA].
const PRIVILEGES: [(&str, &str); 3] = [("1", privilege::USER), ("2", privilege::MANAGER), ("3", privilege::OPERATOR)];

#[derive(Debug)]
pub enum Error {
    /// Input salah (HTTP 400).
    Invalid(String),
    /// Endpoint tidak ada (HTTP 404).
    NotFound,
    /// Database atau berkas (HTTP 500).
    Internal(String),
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Self::Invalid(format!("JSON: {e}"))
    }
}

fn bad(m: impl Into<String>) -> Error {
    Error::Invalid(m.into())
}

/// Request dari mesin: header yang dipakai + body.
#[derive(Debug, Default)]
pub struct DeviceRequest<'a> {
    pub request_code: &'a str,
    pub dev_id: &'a str,
    pub trans_id: &'a str,
    /// Data besar (> ~5 KB) dikirim per blok: 1, 2, … lalu 0 = blok terakhir.
    pub blk_no: u32,
    pub cmd_return_code: &'a str,
    pub body: &'a [u8],
    /// Alamat mesin (dari koneksi TCP), untuk daftar mesin.
    pub remote: Option<IpAddr>,
}

/// Jawaban ke mesin: header `response_code`/`trans_id`/`cmd_code` + body.
#[derive(Debug, Default)]
pub struct DeviceReply {
    pub code: &'static str,
    pub trans_id: String,
    pub cmd_code: String,
    pub body: Vec<u8>,
    /// Callback bergaya developer.fingerspot.io untuk `FKWEB_WEBHOOK`.
    pub hook: Option<Value>,
}

impl DeviceReply {
    fn ok(trans: &str) -> Self {
        Self { code: response_code::OK, trans_id: trans.into(), ..Self::default() }
    }
}

pub struct Service {
    store: Store,
    tz: TimeZone,
    webhook: Option<String>,
    devices: Option<Vec<String>>,
    photos: PathBuf,
    /// dev_id -> blok 1..n yang belum ditutup blok 0
    blocks: HashMap<String, Vec<u8>>,
    /// dev_id -> IP terakhir (hanya di memori; mesin bertanya lagi dalam 2 menit setelah server hidup)
    ips: HashMap<String, IpAddr>,
    port: u16,
    env_file: PathBuf,
    /// Penomoran `trans_id` buatan server.
    seq: u32,
}

impl Service {
    pub fn new(store: Store, cfg: &Config) -> Self {
        Self {
            store,
            tz: cfg.tz.clone(),
            webhook: cfg.webhook.clone(),
            devices: cfg.devices.clone(),
            photos: cfg.photos.clone(),
            blocks: HashMap::new(),
            ips: HashMap::new(),
            port: cfg.port,
            env_file: cfg.dir.join(ENV_FILE),
            seq: 0,
        }
    }

    /// Semua mesin yang pernah terhubung: Cloud ID, nama, IP, aktivitas terakhir, terhubung atau tidak.
    pub fn devices(&self) -> Result<Vec<Value>, Error> {
        let now = wall(&self.tz).to_unix(0);
        Ok(self
            .store
            .device_list()?
            .into_iter()
            .map(|(id, d)| {
                // last_activity = jam dinding "YYYY-MM-DD hh:mm:ss" di zona server
                let seen = d.last_activity.as_deref().and_then(|t| WallTime::parse_fk14(&t.replace(['-', ' ', ':'], "")));
                let connected = seen.is_some_and(|t| now - t.to_unix(0) <= CONNECTED_SECS);
                json!({ "cloud_id": id, "device_name": d.name, "ip": self.ips.get(&id), "last_activity": d.last_activity,
                        "connected": connected })
            })
            .collect())
    }

    /// Ringkasan untuk halaman status (tanpa PIN atau data pribadi).
    pub fn status(&self) -> Result<Value, Error> {
        let today = format!("{} 00:00:00", &self.now()[..10]);
        Ok(json!({
            "version": env!("CARGO_PKG_VERSION"), "server_ip": crate::net::lan_ip(), "port": self.port,
            "env_file": self.env_file, "devices": self.devices()?,
            "logs_today": self.store.count_logs(&today)?, "logs_total": self.store.count_logs("")?,
        }))
    }

    /// Hasil pencarian jaringan + keterangan untuk tiap alamat.
    pub fn describe(&self, found: &[Found]) -> Vec<Value> {
        let server = crate::net::lan_ip().map_or_else(|| "IP komputer ini".to_owned(), |ip| ip.to_string());
        let setting = format!("Mode Internet, Server IP {server}, Server Port {}, Server Req Ya", self.port);
        found
            .iter()
            .map(|f| {
                let id = self.ips.iter().find(|(_, ip)| **ip == IpAddr::V4(f.ip)).map(|(id, _)| id.clone());
                let note = match (f.mode, &id) {
                    (_, Some(_)) => "terhubung ke server ini".to_owned(),
                    (Mode::Diam, None) => {
                        format!("kemungkinan mesin di mode Internet yang belum mengirim ke server ini; atur menu Jaringan: {setting}")
                    }
                    (Mode::Lokal, None) => format!("mesin di mode Lokal; untuk server ini atur menu Jaringan: {setting}"),
                    (Mode::Ditolak, None) => "mesin di mode Lokal, password komunikasi berbeda (FK_PASSWORD)".to_owned(),
                };
                json!({ "ip": f.ip, "mode": f.mode, "cloud_id": id, "note": note })
            })
            .collect()
    }

    pub fn webhook(&self) -> Option<&str> {
        self.webhook.as_deref()
    }

    fn now(&self) -> String {
        wall(&self.tz).to_string()
    }

    fn tz_name(&self) -> &str {
        self.tz.iana_name().unwrap_or("UTC")
    }

    // --- mesin -------------------------------------------------------------------------------

    pub fn device(&mut self, r: &DeviceRequest<'_>) -> Result<DeviceReply, Error> {
        let dev = r.dev_id;
        if let Some(ip) = r.remote.filter(|_| ident(dev, 18, "")) {
            self.ips.insert(dev.into(), ip);
        }
        if !ident(r.request_code, 32, "") || !ident(dev, 18, "") || self.devices.as_ref().is_some_and(|d| !d.iter().any(|x| x == dev)) {
            return Err(bad("request mesin tidak valid"));
        }
        let prev = self.blocks.remove(dev).unwrap_or_default();
        if r.blk_no > 0 {
            self.blocks.insert(dev.into(), if r.blk_no == 1 { r.body.to_vec() } else { [prev.as_slice(), r.body].concat() });
            return Ok(DeviceReply::ok(r.trans_id));
        }
        let raw = [prev.as_slice(), r.body].concat();
        let body = Body::decode(&raw);
        let now = self.now();
        self.store.touch_device(dev, &now)?;
        match r.request_code {
            request_code::REALTIME_GLOG => self.realtime_log(dev, r.trans_id, &body),
            request_code::REALTIME_ENROLL_DATA => {
                // mesin mengirim ini setiap user/jari/wajah didaftarkan atau diubah
                let u: UserInfo = body.parse()?;
                self.store.save_backup(dev, &u.user_id, &u.user_name, &u.user_privilege, &raw, &now)?;
                Ok(DeviceReply::ok(r.trans_id))
            }
            request_code::SEND_CMD_RESULT => self.cmd_result(dev, r, &body, &raw),
            request_code::RECEIVE_CMD => self.poll(dev, &body),
            _ => Ok(DeviceReply::ok(r.trans_id)),
        }
    }

    fn realtime_log(&mut self, dev: &str, trans: &str, body: &Body) -> Result<DeviceReply, Error> {
        let l: RealtimeLog = body.parse()?;
        let scan = l.time().ok_or_else(|| bad(format!("io_time tidak valid: {}", l.io_time)))?.to_string();
        // foto absen (bila fitur foto mesin aktif; di Revo ini log_image selalu null sejauh ini)
        let img = l.log_image.as_deref().and_then(|n| body.bin(n));
        let photo = img.map(|_| {
            let pin: String = l.user_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
            self.photos.join(format!("{dev}_{pin}_{}.jpg", l.io_time)).to_string_lossy().into_owned()
        });
        if let (Some(img), Some(path)) = (img, &photo) {
            // berkas dulu: bila gagal, log tidak tercatat dan mesin mengirim ulang
            std::fs::create_dir_all(&self.photos)?;
            std::fs::write(path, img)?;
        }
        let log = Log { pin: &l.user_id, scan_date: &scan, io_mode: l.io_mode, verify_mode: l.verify_mode, photo: photo.as_deref() };
        let mut reply = DeviceReply::ok(trans);
        if self.store.insert_log(dev, &log)? {
            let mut data = json!({
                "pin": l.user_id, "scan": scan[..16], "verify": (l.verify_mode >> 28).to_string(),
                "status_scan": (i64::from(l.action()) - 1).to_string(),
            });
            if let Some(p) = photo {
                data["photo"] = p.into();
            }
            reply.hook = Some(json!({ "type": "attlog", "cloud_id": dev, "data": data }));
        }
        Ok(reply)
    }

    fn cmd_result(&mut self, dev: &str, r: &DeviceRequest<'_>, body: &Body, raw: &[u8]) -> Result<DeviceReply, Error> {
        let mut reply = DeviceReply::ok(r.trans_id);
        let Some(kind) = self.store.cmd_kind(dev, r.trans_id)? else { return Ok(reply) };
        let data = if r.cmd_return_code == response_code::OK { self.shape(dev, &kind, body, raw)? } else { json!({ "status": "2" }) };
        self.store.mark_done(r.trans_id, r.cmd_return_code, &data, &self.now())?;
        reply.hook = Some(json!({ "type": kind, "cloud_id": dev, "trans_id": r.trans_id, "data": data }));
        Ok(reply)
    }

    /// Hasil mesin -> bentuk data callback developer.fingerspot.io.
    fn shape(&self, dev: &str, kind: &str, body: &Body, raw: &[u8]) -> Result<Value, Error> {
        Ok(match kind {
            "sync_attlog" => {
                let ld = body.parse::<LogData>().ok();
                let recs = ld.as_ref().map(|l| l.logs(body)).unwrap_or_default();
                let scans: Vec<String> = recs.iter().map(|r| r.time.to_string()).collect();
                let added = self.store.insert_logs(
                    dev,
                    recs.iter().zip(&scans).map(|(r, s)| Log {
                        pin: &r.pin,
                        scan_date: s,
                        io_mode: r.io_mode,
                        verify_mode: r.verify_mode,
                        photo: None,
                    }),
                )?;
                json!({ "log_count": ld.as_ref().map(|l| l.log_count), "one_log_size": ld.map(|l| l.one_log_size), "added": added })
            }
            "get_all_pin" => {
                let list = body.parse().unwrap_or(UserIdList { one_user_id_size: USER_SIZE, user_id_count: 0 });
                let pins: Vec<String> = list.users(body).into_iter().map(|u| u.pin).collect();
                json!({ "total": pins.len(), "pin_arr": pins })
            }
            "get_userinfo" => {
                let u: UserInfo = body.parse()?;
                self.store.save_backup(dev, &u.user_id, &u.user_name, &u.user_privilege, raw, &self.now())?;
                let cred = |n| u.credential(body, n).map(|b| String::from_utf8_lossy(b).into_owned()).unwrap_or_default();
                json!({
                    "pin": u.user_id, "name": u.user_name, "privilege": api_privilege(&u.user_privilege),
                    "finger": u.finger_count().to_string(), "face": u.face_count().to_string(),
                    "password": cred(backup_number::PASSWORD), "rfid": cred(backup_number::CARD), "vein": "0",
                    "template": B64.encode(raw),
                })
            }
            _ => json!({ "status": "1" }),
        })
    }

    fn poll(&mut self, dev: &str, body: &Body) -> Result<DeviceReply, Error> {
        let p: Poll = body.parse()?;
        let now = self.now();
        self.store.update_poll(dev, p.fk_name.as_deref(), p.fk_info.as_ref().unwrap_or(&Value::Null), p.fk_time.as_deref())?;
        if let Some(t) = p.time() {
            let drift = (t.to_unix(0) - wall(&self.tz).to_unix(0)).abs();
            if drift > MAX_DRIFT_SECS && !self.store.set_time_in_flight(dev)? {
                println!("jam mesin {dev} = {}, disetel ulang", t.fk14());
                let trans = format!("auto{}", SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis()));
                self.store.enqueue(dev, &trans, "set_time", "SET_TIME", &zone_param(self.tz_name()), &now)?;
            }
        }
        let Some(c) = self.store.next_pending(dev)? else {
            return Ok(DeviceReply { code: response_code::NO_CMD, ..DeviceReply::default() });
        };
        let param = if c.cmd_code == "SET_TIME" {
            // jam dihitung saat dikirim, bukan saat diminta
            let zone = Body::decode(&c.param).parse::<Value>()?["timezone"].as_str().map(TimeZone::get);
            Command::SetTime(wall(&zone.and_then(Result::ok).unwrap_or_else(|| self.tz.clone()))).body().encode()
        } else {
            c.param
        };
        if c.cmd_code == "RESET_FK" {
            self.store.mark_done(&c.trans_id, "NO_REPLY", &Value::Null, &now)?; // mesin langsung restart tanpa membalas
        } else {
            self.store.mark_sent(&c.trans_id, &now)?;
        }
        println!(">> {dev} {} {} trans_id={}", c.cmd_code, Body::decode(&param).json, c.trans_id);
        Ok(DeviceReply { code: response_code::OK, trans_id: c.trans_id, cmd_code: c.cmd_code, body: param, hook: None })
    }

    // --- API ---------------------------------------------------------------------------------

    /// Endpoint `/api/<ep>`; body JSON selalu berisi `cloud_id`.
    pub fn api(&mut self, ep: &str, b: &Value) -> Result<Value, Error> {
        if ep == "get_devices" {
            return Ok(json!({ "success": true, "data": self.devices()? }));
        }
        let dev = match text(&b["cloud_id"]) {
            d if d.is_empty() => self.only_device()?,
            d if ident(&d, 18, "") => d,
            _ => return Err(bad("cloud_id tidak valid")),
        };
        let pin = || {
            let p = text(if b["pin"].is_null() { &b["data"]["pin"] } else { &b["pin"] });
            if (1..=22).contains(&p.len()) && digits(&p) { Ok(p) } else { Err(bad("pin harus angka 1-22 digit")) }
        };
        let with_data = |data: Value| {
            let mut r = json!({ "success": true, "data": data });
            if !b["trans_id"].is_null() {
                r["trans_id"] = b["trans_id"].clone();
            }
            r
        };
        match ep {
            "get_attlog" => {
                let (start, end) = (text(&b["start_date"]), text(&b["end_date"]));
                if !is_date(&start) || !is_date(&end) {
                    return Err(bad("start_date/end_date YYYY-MM-DD"));
                }
                return Ok(with_data(self.store.logs(&dev, &start, &end)?.into()));
            }
            "get_backup" => {
                let pin = pin()?;
                let u = self.store.backup(&dev, &pin)?.ok_or_else(|| bad("belum ada cadangan untuk pin ini"))?;
                return Ok(with_data(json!({
                    "pin": pin, "name": u.name, "privilege": api_privilege(&u.privilege), "updated": u.updated,
                    "template": B64.encode(u.data),
                })));
            }
            "get_device" => {
                let d = self.store.device(&dev)?.ok_or_else(|| bad("mesin belum pernah terhubung"))?;
                let fk_time = d.fk_time.map(|t| WallTime::parse_fk14(&t).map_or(t, |w| w.to_string()));
                let info: Value = serde_json::from_str(d.info.as_deref().unwrap_or("null"))?;
                return Ok(with_data(json!({
                    "cloud_id": dev, "device_name": d.name, "last_activity": d.last_activity, "fk_time": fk_time, "info": info,
                    "webhook_url": self.webhook,
                })));
            }
            "get_result" => {
                let now = wall(&self.tz);
                self.store.expire_sent(&WallTime::from_unix(now.to_unix(0) - TIMEOUT_SECS, 0).to_string())?;
                return self.store.result(&dev, &text(&b["trans_id"]))?.ok_or_else(|| bad("trans_id tidak dikenal"));
            }
            _ => {}
        }
        let trans = match text(&b["trans_id"]) {
            t if t.is_empty() => self.new_trans(),
            t => t,
        };
        if !ident(&trans, 32, "-") {
            return Err(bad("trans_id huruf/angka/-, maks 32"));
        }
        let (code, param) = match ep {
            "get_all_pin" => cmd(&Command::GetUserIdList),
            "get_userinfo" => cmd(&Command::GetUserInfo { user_id: pin()? }),
            "delete_userinfo" => cmd(&Command::DeleteUser { user_id: pin()? }),
            "set_userinfo" => cmd(&set_user(pin()?, &b["data"])?),
            "reg_online" => {
                let no = match &b["verification"] {
                    Value::Number(n) => n.as_u64(),
                    Value::String(s) => s.trim().parse().ok(),
                    _ => None,
                };
                let no = no.filter(|n| *n <= 12).ok_or_else(|| bad("verification 0-9 jari, 10 password, 11 kartu, 12 wajah"))?;
                cmd(&Command::EnterEnroll { user_id: pin()?, backup_number: no as u8 })
            }
            "set_time" => {
                let zone = Some(text(&b["timezone"])).filter(|z| !z.is_empty()).unwrap_or_else(|| self.tz_name().into());
                TimeZone::get(&zone).map_err(|_| bad(format!("timezone tidak dikenal: {zone}")))?;
                ("SET_TIME", zone_param(&zone))
            }
            "restart_device" => cmd(&Command::Restart),
            "sync_attlog" => cmd(&Command::GetLogData), // tambahan (tidak ada di API Fingerspot)
            _ => return Err(Error::NotFound),
        };
        if !self.store.enqueue(&dev, &trans, ep, code, &param, &self.now())? {
            return Err(bad("trans_id sudah dipakai"));
        }
        Ok(json!({ "success": true, "trans_id": trans }))
    }

    /// Cloud ID bila baru satu mesin yang pernah terhubung.
    fn only_device(&self) -> Result<String, Error> {
        let ids: Vec<String> = self.store.device_list()?.into_iter().map(|(id, _)| id).collect();
        match ids.as_slice() {
            [id] => Ok(id.clone()),
            [] => Err(bad("belum ada mesin yang terhubung ke server ini (lihat halaman status)")),
            _ => Err(bad(format!("ada {} mesin, isi cloud_id: {}", ids.len(), ids.join(", ")))),
        }
    }

    fn new_trans(&mut self) -> String {
        self.seq = self.seq.wrapping_add(1);
        format!("ff{}{}", SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis()), self.seq)
    }
}

fn cmd(c: &Command) -> (&'static str, Vec<u8>) {
    (c.code(), c.body().encode())
}

/// `SET_TIME` disimpan sebagai zona; jam dihitung saat dikirim ke mesin.
fn zone_param(zone: &str) -> Vec<u8> {
    Body::from_json(&json!({ "timezone": zone }), vec![]).encode()
}

/// `set_userinfo`: mengganti SELURUH data user. Tanpa template, jari/wajah user itu ikut terhapus
/// (sama seperti Fingerspot). Dengan template dari `get_userinfo`/`get_backup`, kredensial ikut apa adanya.
fn set_user(pin: String, d: &Value) -> Result<Command, Error> {
    let prv = text(&d["privilege"]);
    let fk_prv = if prv.is_empty() { privilege::USER } else { fk_privilege(&prv).ok_or_else(|| bad("privilege 1, 2 atau 3"))? };
    let (password, rfid) = (text(&d["password"]), text(&d["rfid"]));
    if password.len() > 10 || !digits(&password) || rfid.len() > 20 || !digits(&rfid) {
        return Err(bad("password/rfid harus angka"));
    }
    let name = d["name"].as_str().map(str::to_owned);
    let mut info =
        UserInfo { user_id: pin, user_name: name.clone().unwrap_or_default(), user_privilege: fk_prv.into(), ..UserInfo::default() };
    let mut bins = Vec::new();
    let template = text(&d["template"]);
    if template.is_empty() {
        for (no, v) in [(backup_number::PASSWORD, password), (backup_number::CARD, rfid)] {
            if !v.is_empty() {
                bins.push(v.into_bytes()); // ASCII tanpa NUL, sama seperti cloud
                info.enroll_data_array.push(Enroll { backup_number: no, enroll_data: format!("BIN_{}", bins.len()) });
            }
        }
    } else {
        let t = Body::decode(&B64.decode(template.trim()).map_err(|_| bad("template bukan base64"))?);
        let tu: UserInfo = t.parse()?;
        info.user_name = name.unwrap_or(tu.user_name);
        if prv.is_empty() && !tu.user_privilege.is_empty() {
            info.user_privilege = tu.user_privilege; // pulihkan admin tetap admin
        }
        info.enroll_data_array = tu.enroll_data_array;
        info.user_photo = tu.user_photo;
        bins = t.bins;
    }
    Ok(Command::SetUserInfo { info, bins })
}

/// Jam dinding sekarang di zona itu.
fn wall(tz: &TimeZone) -> WallTime {
    WallTime::now(i64::from(tz.to_offset(Timestamp::now()).seconds()))
}

/// Nilai JSON sebagai teks, seperti `String(x ?? "")` di JavaScript.
fn text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        v => v.to_string(),
    }
}

/// `^[\w<extra>]{1,max}$` (ASCII).
fn ident(s: &str, max: usize, extra: &str) -> bool {
    (1..=max).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || extra.as_bytes().contains(&b))
}

fn digits(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_digit())
}

/// `YYYY-MM-DD`
fn is_date(s: &str) -> bool {
    s.len() == 10 && s.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() })
}

fn fk_privilege(api: &str) -> Option<&'static str> {
    PRIVILEGES.iter().find(|p| p.0 == api).map(|p| p.1)
}

fn api_privilege(fk: &str) -> String {
    PRIVILEGES.iter().find(|p| p.1 == fk).map_or(fk, |p| p.0).to_owned()
}
