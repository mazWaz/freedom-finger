# API

Aplikasi apa pun (web, desktop, mobile, backend; bahasa apa pun) memakai Freedom Finger lewat
HTTP biasa. Tidak ada pustaka khusus. Bentuk endpoint mengikuti
[developer.fingerspot.io](https://developer.fingerspot.io/docs/en/getting-started), ditambah
beberapa endpoint yang ditandai **tambahan**. Spesifikasi mesin-bacanya ada di
[`openapi.yaml`](openapi.yaml), bisa dibuka dengan Swagger UI atau dipakai generator klien.

## Basics

| Hal | Isi |
|---|---|
| Alamat | `http://<IP server>:8013` (port: `FKWEB_PORT`) |
| Token | `FKWEB_TOKEN` di `freedom-finger.env`, dibuat otomatis. Kirim sebagai header `Authorization: Bearer <token>` |
| Request | `POST /api/<endpoint>`, body JSON (boleh `{}`) |
| Berhasil | HTTP 200, `{"success": true, …}` |
| Gagal | HTTP 400 (input salah), 401 (token salah), 404 (endpoint tidak ada), 500; body `{"success": false, "message": "…"}` |
| `cloud_id` | Cloud ID mesin. Boleh kosong selama baru satu mesin yang terhubung; bila lebih, isi dari `get_devices` |
| CORS | `/api/*` boleh dipanggil dari origin lain (browser, webview Tauri/Electron); tetap wajib token |

```sh
TOKEN=<isi FKWEB_TOKEN>
curl -s http://localhost:8013/api/get_devices -H "Authorization: Bearer $TOKEN" -d '{}'
```

Tidak ada TLS. Pakai di jaringan kantor yang tepercaya, dan jangan buka port 8013 ke internet.

## Endpoints

Endpoint **baca** langsung menjawab dari database. Endpoint **perintah** mengantrekan perintah
untuk mesin: balasannya hanya `trans_id`, dan hasilnya datang belakangan (lihat
[Commands](#commands)).

| Endpoint | Jenis | Body | Hasil (`data`) |
|---|---|---|---|
| `get_devices` | baca, tambahan | `{}` | Daftar mesin |
| `scan_devices` | baca, tambahan | `{password?}` | Mesin di jaringan lokal (sampai 10 detik) |
| `get_attlog` | baca | `{start_date, end_date}` | Log absen |
| `get_device` | baca | `{}` | Info satu mesin |
| `get_backup` | baca, tambahan | `{pin}` | Cadangan terakhir satu user |
| `get_users` | baca, tambahan | `{cloud_id?}` | User yang tercatat di database |
| `get_result` | baca | `{trans_id}` | Status dan hasil perintah |
| `get_all_pin` | perintah | `{}` | `{total, pin_arr}` |
| `get_userinfo` | perintah | `{pin}` | Data user + `template` |
| `set_userinfo` | perintah | `{data: {pin, name, privilege, password, rfid, template}}` | `{status: "1"}` |
| `delete_userinfo` | perintah | `{pin}` | `{status: "1"}` |
| `reg_online` | perintah | `{pin, verification}` | `{status: "1"}` |
| `set_time` | perintah | `{timezone?}` | `{status: "1"}` |
| `restart_device` | perintah | `{}` | `null` |
| `sync_attlog` | perintah, tambahan | `{}` | `{log_count, one_log_size, added}` |

Semua body boleh berisi `cloud_id`. Perintah juga boleh berisi `trans_id` sendiri (huruf,
angka, `_`, `-`, maksimal 32); bila kosong, server membuatnya.

### get_devices

Semua mesin yang pernah terhubung. `connected` bernilai benar bila mesin bertanya dalam 3 menit
terakhir. `ip` diketahui setelah mesin bertanya sejak server terakhir dinyalakan.

```json
{"success": true, "data": [
  {"cloud_id": "MESIN01", "device_name": "Fingerspot", "ip": "192.168.1.201",
   "last_activity": "2026-09-29 08:01:12", "connected": true}
]}
```

### scan_devices

Mencari mesin di jaringan lokal lewat TCP 5005. `password` adalah password komunikasi mesin di
mode Lokal (bawaan 0). `mode` bernilai `lokal`, `ditolak` (password berbeda), atau `diam`
(kemungkinan mode Internet). `note` berisi petunjuk untuk pengguna.

```json
{"success": true, "data": [
  {"ip": "192.168.1.201", "mode": "diam", "cloud_id": "MESIN01", "note": "terhubung ke server ini"}
]}
```

### get_attlog

Log absen dari database, urut waktu, tanpa batas 2 hari seperti di cloud.

```jsonc
// body
{"start_date": "2026-09-29", "end_date": "2026-09-29"}
// balasan
{"success": true, "data": [
  {"pin": "2", "scan_date": "2026-09-29 08:00:05", "verify": 1, "status_scan": 0}
]}
```

| Kolom | Isi |
|---|---|
| `verify` | 1 jari, 2 password, 3 kartu, 4 wajah |
| `status_scan` | 0 masuk, 1 pulang |
| `photo` | Hanya ada bila mesin mengirim foto: path file di server |

### get_device

```json
{"success": true, "data": {
  "cloud_id": "MESIN01", "device_name": "Fingerspot", "last_activity": "2026-09-29 08:01:12",
  "fk_time": "2026-09-29 08:01:10", "clock_offset": -2, "info": {"firmware": "…"}, "webhook_url": null
}}
```

`fk_time` adalah jam mesin saat terakhir bertanya. `clock_offset` adalah jam mesin dikurangi jam
server dalam detik, diukur saat itu juga (negatif = mesin lebih lambat); `null` sampai mesin
bertanya sejak server terakhir dinyalakan. `info` berisi firmware dan data yang didukung mesin,
sesuai laporan mesin.

### get_backup

Cadangan terakhir satu user. Server menyimpannya setiap mesin mengirim data user (daftar atau
ubah jari/wajah) dan setiap `get_userinfo`. `template` dipakai di `set_userinfo` untuk
memulihkan user yang terhapus, termasuk jari, wajah, dan hak aksesnya.

```json
{"success": true, "data": {"pin": "2", "name": "Budi Santoso", "privilege": "1",
  "updated": "2026-09-29 07:55:00", "template": "<base64>"}}
```

### get_users

User yang tercatat di database server, tanpa perintah ke mesin: nama di mesin (maksimal 15
karakter), hak akses, dan kapan terakhir diterima. Server mencatat user setiap mesin mengirim
data user (daftar atau ubah jari/wajah) dan setiap `get_userinfo`. User yang belum pernah
terkirim belum ada di sini: ambil daftar PIN dengan `get_all_pin`, lalu `get_userinfo` per PIN.
Tanpa `cloud_id`, hasilnya user semua mesin; PIN yang sama di dua mesin muncul dua kali.

```json
{"success": true, "data": [
  {"cloud_id": "MESIN01", "pin": "2", "name": "Budi Santoso", "privilege": "1", "updated": "2026-09-29 07:55:00"}
]}
```

### get_result

```jsonc
// body
{"trans_id": "ff17591234567891"}
// balasan
{"success": true, "trans_id": "ff17591234567891", "type": "get_all_pin", "cmd_code": "GET_USER_ID_LIST",
 "status": "done", "result_code": "OK", "data": {"total": 2, "pin_arr": ["1", "2"]},
 "created": "2026-09-29 08:00:00", "sent": "2026-09-29 08:00:21", "done": "2026-09-29 08:00:22"}
```

| `status` | Arti |
|---|---|
| `pending` | Menunggu mesin bertanya |
| `sent` | Sudah dikirim ke mesin |
| `done` | Mesin menjawab; `result_code` `OK` = berhasil. Kode lain = ditolak mesin, dengan `data` `{status: "2"}` |
| `timeout` | Terkirim tapi tidak dijawab 5 menit (misalnya PIN tidak ada di mesin) |

### get_userinfo

```jsonc
// body
{"pin": "2"}
// hasil (get_result.data)
{"pin": "2", "name": "Budi Santoso", "privilege": "1", "finger": "2", "face": "0",
 "password": "", "rfid": "", "vein": "0", "template": "<base64>"}
```

`privilege`: 1 user, 2 admin, 3 subadmin. `template` berisi data user lengkap, termasuk jari
dan wajah.

### set_userinfo

Menulis user ke mesin dan **mengganti seluruh data user itu**.

```json
{"data": {"pin": "20", "name": "Siti", "privilege": "1", "password": "", "rfid": "", "template": ""}}
```

- Tanpa `template`, jari dan wajah user itu terhapus dari mesin. Untuk mengganti nama atau hak
  akses saja, ambil `template` dari `get_userinfo` atau `get_backup`, lalu kirim bersama `name`
  atau `privilege` baru.
- `password` maksimal 10 angka, `rfid` maksimal 20 angka.

### delete_userinfo

`{"pin": "20"}`. Cadangannya tetap ada di database (`get_backup`).

### reg_online

Membuka layar pendaftaran di mesin untuk satu user, tanpa menu admin. Orangnya harus berdiri di
depan mesin. Layar muncul saat mesin bertanya berikutnya.

```json
{"pin": "20", "verification": 0}
```

`verification`: 0–9 jari (nomor jari), 10 password, 11 kartu, 12 wajah.

### set_time

`{"timezone": "Asia/Jakarta"}` (bawaan `FKWEB_TZ`). Jam dihitung saat perintah dikirim ke mesin,
bukan saat diminta. Server juga menyetel jam otomatis bila jam mesin meleset lebih dari 2
menit.

### restart_device

Mesin langsung restart tanpa menjawab. Status langsung `done`, dengan `result_code` `NO_REPLY`.

### sync_attlog

Menarik semua log dari memori mesin ke database. Log yang sudah ada diabaikan, dan `added`
menunjukkan jumlah log baru.

## Commands

Mesin tidak bisa dihubungi server. Mesin yang bertanya ke server setiap ±20 detik sampai 2
menit, lalu mengambil perintah yang mengantre. Alurnya:

1. `POST /api/get_userinfo {"pin":"2"}` → `{"success": true, "trans_id": "ff1759…"}`
2. Hasilnya diambil lewat salah satu cara berikut:
   - `get_result {trans_id}` berulang tiap beberapa detik sampai `status` menjadi `done` atau `timeout`
   - event `/api/events` dengan `trans_id` yang sama
   - webhook `FKWEB_WEBHOOK`

Satu perintah dikirim sekali. Perintah yang belum diambil tetap mengantre, termasuk setelah
server restart.

## Realtime events

`GET /api/events` adalah aliran [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)
yang mengirim satu event per absen baru dan per hasil perintah. Isinya sama dengan callback webhook.

```sh
curl -N http://localhost:8013/api/events -H "Authorization: Bearer $TOKEN"
```

```text
data: {"type":"attlog","cloud_id":"MESIN01","data":{"pin":"2","scan":"2026-09-29 08:00","verify":"1","status_scan":"0"}}

data: {"type":"get_all_pin","cloud_id":"MESIN01","trans_id":"ff1759…","data":{"total":2,"pin_arr":["1","2"]}}

```

| `type` | Isi |
|---|---|
| `attlog` | Absen baru: `pin`, `scan` (`YYYY-MM-DD hh:mm`), `verify`, `status_scan` (teks), `photo` bila ada |
| nama endpoint perintah | Hasil perintah: `trans_id`, `data` sama dengan `get_result.data` |
| `lagged` | Klien terlalu lambat sehingga `missed` event terlewat; ambil ulang lewat `get_attlog` |

- Baris `:` tiap 15 detik hanya menjaga koneksi; abaikan.
- Event selama koneksi putus tidak dikirim ulang. Setelah tersambung lagi, ambil yang
  terlewat lewat `get_attlog`.
- `EventSource` di browser tidak bisa mengirim header `Authorization`, jadi pakai `fetch` seperti
  contoh di bawah.

## Webhook

Isi `FKWEB_WEBHOOK=https://…` di `freedom-finger.env`. Setiap event di atas juga dikirim sebagai
`POST` JSON ke alamat itu. Server tidak menunggu penerima dan tidak mengulang pengiriman yang
gagal.

## Status page

Tanpa token, tanpa PIN atau data pribadi:

| Request | Isi |
|---|---|
| `GET /` | Halaman status untuk manusia |
| `GET /status.json` | `{version, server_ip, port, env_file, devices, logs_today, logs_total}` |
| `GET /scan.json` | Sama dengan `scan_devices`, hanya dari komputer server sendiri |

## JavaScript example

Tanpa pustaka. Jalan di browser, Node 18+, Electron, dan Tauri.

```js
const URL = 'http://localhost:8013';
const headers = { authorization: 'Bearer <FKWEB_TOKEN>' };

async function api(endpoint, body = {}) {
  const r = await fetch(`${URL}/api/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.success) throw new Error(j.message);
  return j;
}

/** Perintah ke mesin: kirim, lalu tunggu hasilnya. */
async function command(endpoint, body = {}) {
  const { trans_id } = await api(endpoint, body);
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 2000));
    const r = await api('get_result', { cloud_id: body.cloud_id, trans_id });
    if (r.status === 'done') return r.data;
    if (r.status === 'timeout') throw new Error(`mesin tidak menjawab ${endpoint}`);
  }
}

/** Event realtime; tersambung ulang sendiri bila server restart. */
async function listen(onEvent) {
  for (;;) {
    try {
      const r = await fetch(`${URL}/api/events`, { headers });
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (let c; !(c = await reader.read()).done; ) {
        buf += c.value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
          buf = buf.slice(i + 2);
          if (line) onEvent(JSON.parse(line.slice(5)));
        }
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 1000));
  }
}

const today = new Date().toLocaleDateString('sv');
console.log((await api('get_attlog', { start_date: today, end_date: today })).data);
console.log(await command('get_all_pin'));
listen((e) => e.type === 'attlog' && console.log('absen', e.data.pin, e.data.scan));
```

Contoh lengkap dengan tampilan ada di [`examples/tauri-dashboard`](../examples/tauri-dashboard).
