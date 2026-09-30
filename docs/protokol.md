# Spesifikasi Protokol FkWeb: Fingerspot Revo WF-206BNC (mode Internet)

Dokumen ini netral bahasa pemrograman. Semua format ditulis sebagai tabel byte, contoh asli dari
mesin, dan pseudocode, jadi implementasi bisa ditulis di bahasa apa pun. Di **mode Internet**
mesin menjadi klien HTTP yang mengirim absen, data user, dan hasil perintah ke server Anda
(FkWeb). Implementasi referensi: modul `freedom_finger_sdk::fkweb` (codec dan pesan) dan server
lengkap `crates/freedom-finger`. Latar belakang riset ada di `riset.md`.

| | |
|---|---|
| Versi dokumen | 2.0, 1 Oktober 2026 (hanya FkWeb; protokol mode Lokal TCP 5005 dihapus, kecuali handshake untuk pencarian mesin di bagian 9) |
| Mesin | Fingerspot Revo WF-206BNC, produksi 17-01-2022 |
| Platform | SmackBio keluarga FK, kelas SDK `CFKAttend_CIF13_1` |
| Sumber | Uji langsung ke mesin, relay ke server resmi, dan kode server FkWeb resmi (bagian 10) |

**Tanda status** (dipakai di seluruh dokumen):

| Tanda | Arti |
|---|---|
| **[UJI]** | Sudah dicoba ke mesin ini dan hasilnya sesuai |
| **[KODE]** | Terbaca dari kode SDK atau server resmi, belum dicoba ke mesin |
| **[DUGA]** | Kesimpulan dari data, belum pasti |
| **[FISIK]** | Hanya bisa dipastikan di lokasi (menu mesin atau absen sungguhan) |

Semua isi bagian 1–8 [UJI] di mesin ini pada 29-09-2026, kecuali ditandai lain.

---

## Daftar isi

1. [Transport](#1-transport)
2. [Header](#2-header)
3. [Format body](#3-format-body)
4. [Request dari mesin](#4-request-dari-mesin)
5. [Perintah (server → mesin)](#5-perintah-server--mesin)
6. [Struktur data biner](#6-struktur-data-biner)
7. [Perilaku mesin dan jebakan](#7-perilaku-mesin-dan-jebakan)
8. [Contoh pertukaran (daftar jari jarak jauh)](#8-contoh-pertukaran-daftar-jari-jarak-jauh)
9. [Pencarian mesin di jaringan (TCP 5005)](#9-pencarian-mesin-di-jaringan-tcp-5005)
10. [Sumber](#10-sumber)

---

## 1. Transport

| Hal | Nilai |
|---|---|
| Mengaktifkan | Menu **Jaringan**: Mode **Internet**, Server IP, Server Port, Server Req = Ya. Mode **Lokal** mematikan FkWeb dan menghidupkan protokol TCP 5005 (tidak dipakai; lihat bagian 9). |
| Arah | **Mesin = klien HTTP.** Mesin mengirim `POST /` ke `http://<Server IP>:<Server Port>/`. Server tidak pernah memulai koneksi. |
| Gaya | HTTP/1.0, `Connection: close`, satu request per koneksi, `User-Agent: Mozilla/4.0`, `Content-Type: application/octet-stream` |
| Keamanan | Tanpa TLS dan tanpa autentikasi. Mesin dikenali dari header `dev_id` (= Cloud ID mesin). |
| Server resmi | `fdevice.com:8013` / `8014` (fingerspot.io), `fdevice.com:9004` (developer.fingerspot.io) |
| Kompresi | Mesin mengirim `Accept-Encoding: gzip, deflate`. Server cukup menjawab tanpa kompresi. |
| Huruf nama header | Mesin membaca `Content-Length` peka huruf besar-kecil: balasan harus menulis `Content-Length` (juga `Content-Type`, `Date`) persis begitu. Dengan `content-length` huruf kecil, isi perintah dianggap kosong dan perintah berparameter dijawab `ERROR_INVALID_PARAMTER`. Sebaliknya `response_code`, `trans_id`, `cmd_code` harus huruf kecil; bila ditulis `Response_code`, mesin tidak menjawab sama sekali. Diuji di mesin asli 30-09-2026. |

## 2. Header

| Header | Arah | Isi |
|---|---|---|
| `request_code` | mesin → server | `receive_cmd`, `send_cmd_result`, `realtime_glog`, `realtime_enroll_data` |
| `dev_id` | mesin → server | Cloud ID, huruf/angka ≤ 18 |
| `trans_id` | dua arah | `ReceiveCommandAction` / `RTLogSendAction` / `RTEnrollDataAction`, atau `trans_id` perintah pada `send_cmd_result` |
| `cmd_return_code` | mesin → server | Hasil perintah, misalnya `OK` (hanya `send_cmd_result`) |
| `blk_no`, `blk_len` | mesin → server | Nomor dan panjang blok. `0` = blok terakhir/tunggal. |
| `response_code` | server → mesin | `OK`, `ERROR_NO_CMD`, atau `ERROR_…` |
| `cmd_code` | server → mesin | Nama perintah (hanya jawaban `receive_cmd`) |

Body jawaban server = `cmd_param` (bagian 3), atau kosong.

## 3. Format body

```
u32 LE  panjang JSON termasuk NUL
bytes   JSON UTF-8, diakhiri 00
lalu, untuk tiap data biner yang dirujuk JSON sebagai "BIN_1", "BIN_2", … (berurutan):
u32 LE  panjang
bytes   data
```

- `cmd_param` tanpa parameter = body kosong (0 byte).
- Test vector `SET_TIME {"time":"20260929020000"}`:
  `1a000000 7b2274696d65223a223230323630393239303230303030227d 00`
  (26 = 25 byte JSON + NUL).
- Data besar boleh dipecah per blok (`blk_no` 1, 2, …, lalu 0 = terakhir). Server
  menggabungkan blok per `dev_id` dan menjawab `OK` untuk setiap blok [KODE, InjesApp].
  Mesin ini mengirim body 26 KB dalam satu request (`blk_no: 0`).

## 4. Request dari mesin

| `request_code` | Body JSON | Jawaban server |
|---|---|---|
| `receive_cmd` | `{"fk_name":"Fingerspot","fk_time":"YYYYMMDDhhmmss","fk_info":{"face_data_ver":528,"firmware":"A102D2S2K1Wfs01 v1.14","firmware_filename":"A102D2S2K1Wfs01_um","fk_bin_data_lib":"FKDataHS103","fp_data_ver":128,"supported_enroll_data":["PASSWORD","IDCARD","FACE","FP"]}}` | `ERROR_NO_CMD`, atau `OK` + `trans_id` + `cmd_code` + `cmd_param` |
| `send_cmd_result` | Hasil perintah (bagian 5); kosong bila hanya `OK` | `OK` |
| `realtime_glog` | `{"fk_bin_data_lib":"FKDataHS103","io_mode":N,"io_time":"YYYYMMDDhhmmss","log_image":null,"user_id":"13","verify_mode":N}` | `OK` (mesin lalu menandai log terkirim) |
| `realtime_enroll_data` | `{"enroll_data_array":[{"backup_number":0,"enroll_data":"BIN_2"},{"backup_number":12,"enroll_data":"BIN_3"}],"user_id":"13","user_name":"Andi","user_photo":"BIN_1","user_privilege":"USER"}` + foto, jari (800 byte), wajah (20.000 byte) | `OK` |

**Log:** `io_mode` dan `verify_mode` sama dengan byte 40–43 dan 44–47 record 48 byte
(bagian 6.1).
- `io_mode >>> 24` = aksi: 1 masuk, 2 pulang.
- `verify_mode >>> 28` = cara verifikasi: 1 jari, 2 password, 3 kartu, 4 wajah.

Contoh: `io_mode 33554432` = pulang, `verify_mode 268435456` = jari,
`1073741824` = wajah. Foto absen = `log_image: "BIN_1"`; di mesin ini selalu `null`.

## 5. Perintah (server → mesin)

| `cmd_code` | `cmd_param` | Hasil (`send_cmd_result`) |
|---|---|---|
| `GET_USER_ID_LIST` | – | `{"one_user_id_size":36,"user_id_array":"BIN_1","user_id_count":11}` + record 36 byte (bagian 6.3) |
| `GET_USER_INFO` | `{"user_id":"2"}` | `{"enable_flag":"ON","enroll_data_array":[{"backup_number":0,"enroll_data":"BIN_1"}],"user_id":"2","user_name":"Budi Santoso","user_privilege":"MANAGER"}` + biner. `enroll_data_array` = `null` bila belum ada kredensial. |
| `SET_USER_INFO` | JSON seperti hasil `GET_USER_INFO` (+ opsional `user_photo`) + biner | `OK`. **Mengganti seluruh data user**: kredensial yang tidak dikirim ikut terhapus. |
| `DELETE_USER` | `{"user_id":"99999"}` | `OK` |
| `SET_COMMAND` | `{"cmd":"enter_enroll","param":{"user_id":"2","backup_number":0}}` | `OK` langsung. Mesin menampilkan layar daftar; setelah berhasil, datanya dikirim sebagai `realtime_enroll_data`. |
| `SET_TIME` | `{"time":"20260929131140"}` (jam dinding lokal) | `OK` |
| `RESET_FK` | – | Tidak ada; mesin langsung restart. Jam tetap benar. |
| `GET_LOG_DATA` | – | `{"log_count":1697,"one_log_size":48}` + semua log, record 48 byte (bagian 6.1) |

- `backup_number`: 0–9 jari, 10 password, 11 kartu, 12 wajah (bagian 6.4).
- Password = teks ASCII tanpa NUL (`"1234"` = `31323334`).
- `user_privilege`: `USER`, `MANAGER`, `OPERATOR` (ketiganya diterima mesin), dan
  `REGISTER` [KODE].
- Template jari FkWeb = 800 byte, versi `0x80`. Setelah `SET_USER_INFO` ulang, byte
  676–798 berubah, 676 byte pertama tetap, dan jari tetap dikenali.
- Tidak dipakai (destruktif) [KODE]: `CLEAR_ENROLL_DATA`, `CLEAR_LOG_DATA`,
  `CLEAR_MANAGER`, `SET_WEB_SERVER_INFO`, `UPDATE_FIRMWARE`.

## 6. Struktur data biner

Hasil `GET_LOG_DATA` dan `GET_USER_ID_LIST` berisi record biner berukuran tetap. Semua bilangan
little-endian.

### 6.1 Record log absensi (48 byte) [UJI]

| Offset | Isi |
|---|---|
| 0–31 | PIN, ASCII diakhiri NUL |
| 32–34 | Selalu `01 00 00` (tidak dipakai) |
| 35 | Detik |
| 36–39 | u32 tanggal dan waktu: bit 2–11 = tahun − 1900, bit 12–15 = bulan, bit 16–20 = tanggal, bit 21–25 = jam, bit 26–31 = menit |
| 40–42 | Mode pintu (selalu 0 di mesin ini) |
| 43 | Aksi: `1` = masuk, `2` = pulang (lihat status otomatis di bagian 7) |
| 44–47 | Kode verifikasi (u32). Lihat di bawah. |

**Kode verifikasi** [KODE, data cocok]:
- Baca nibble dari byte 47 turun ke byte 44 (nibble atas dulu). Berhenti di nibble 0.
- Arti nibble: `1` = sidik jari, `2` = password, `3` = kartu, `4` = wajah.
- Contoh:
  - `00 00 00 10` → sidik jari;
  - `00 00 00 40` → wajah (SDK `LOG_FACEVERIFY`);
  - `00 00 00 12` → sidik jari + password.
- Isi mesin ini: 1.230 log sidik jari, 458 log wajah.

```
w      = u32le(record[36..39])
year   = ((w >> 2) & 0x3FF) + 1900
month  = (w >> 12) & 0x0F
day    = (w >> 16) & 0x1F
hour   = (w >> 21) & 0x1F
minute = (w >> 26) & 0x3F
second = record[35]
// hasilnya jam dinding WIB
```

### 6.2 Kode verifikasi

Berlaku untuk byte 44–47 record log dan untuk `verify_mode` di `realtime_glog`.

```
kinds = []
for byte_index in 47 down to 44:
    for nibble in [record[byte_index] >> 4, record[byte_index] & 0x0F]:
        if nibble == 0: return kinds
        kinds.append({1: "sidik jari", 2: "password", 3: "kartu", 4: "wajah"}[nibble])
return kinds
```

### 6.3 Daftar user (record 36 byte) [UJI]

| Offset | Isi |
|---|---|
| 0–23 | PIN, ASCII diakhiri NUL |
| 24–31 | 0 |
| 32 | `1` = manager |
| 33 | `1` = aktif |
| 34 | Data terdaftar: bit 0 = password, `0x0c` = sidik jari + wajah, `00` = belum ada |
| 35 | 0 |

Contoh:
- PIN 1: `31 00…00 | 00 01 00 00` → user, aktif, belum ada data.
- PIN 5: `…| 01 01 0d 00` → manager, aktif, password + sidik jari + wajah.

PIN maksimal 22 digit (spesifikasi resmi); field menyediakan ruang 23 karakter + NUL.

### 6.4 Backup number (kredensial)

| Nilai | Arti | Status |
|---|---|---|
| 0–9 | Sidik jari ke-0 sampai ke-9 | [KODE] |
| 10 | Password | [KODE] |
| 11 | Kartu | [KODE] |
| 12 | Wajah | [UJI] |
| 13–16 | Palm vein | [KODE] |
| 20 | Vein | [KODE] |
| 30 | Foto user | [KODE] |

## 7. Perilaku mesin dan jebakan

- **Satu perintah per `receive_cmd`.** Setelah menjawab `send_cmd_result`, mesin
  langsung bertanya lagi. Saat diam, mesin bertanya setiap ±20 detik sampai ±2 menit.
- **Perintah atau `user_id` yang tidak dikenal tidak dijawab.** Tidak ada
  `send_cmd_result`, jadi server butuh batas waktu (`freedom-finger`: 5 menit).
- **Menu terbuka = mesin diam.** Tidak ada request selama menu mesin dibuka.
- **Antrean log lama:** saat pertama tersambung ke server baru, mesin mengirim semua log
  yang belum pernah dijawab `OK`, satu per request (±1.656 log, beberapa per menit).
  Log yang dijawab `OK` dianggap terkirim dan tidak dikirim ulang.
- **Jam:** setelah listrik mati, jam kembali ke `20150101…`. Periksa `fk_time` di setiap
  `receive_cmd`, lalu kirim `SET_TIME` bila meleset.
- `trans_id` perintah boleh string apa pun. Cloud memakai angka 7 digit; `freedom-finger`
  memakai huruf/angka/`-` sampai 32 karakter.
- **Zona waktu.** Jam mesin adalah jam dinding WIB. Jangan memakai fungsi tanggal "lokal"
  milik proses: uji otomatis, launchd, Docker, atau server bisa berjalan di UTC. Salah zona
  membuat `SET_TIME` menggeser mesin 7 jam. Selalu pakai offset UTC+7 eksplisit. [UJI, bug nyata
  yang tertangkap]
- **Status masuk/pulang diganti otomatis oleh jam** [DUGA kuat dari data]: dari 1.688 log, tidak
  ada "masuk" sebelum 09:01, dan tidak ada "pulang" antara 08:57 dan 15:40; orang yang datang jam
  08:30 tercatat "pulang". Setting ini tidak terbaca dari luar [FISIK]. Tentukan masuk/pulang
  sendiri dari jam dan urutan absen.
- **Nama** maksimal 15 karakter di mesin. Simpan nama lengkap di aplikasi.

## 8. Contoh pertukaran (daftar jari jarak jauh)

```
mesin  → POST /   request_code: receive_cmd   dev_id: <cloud_id>   trans_id: ReceiveCommandAction
                  body: {"fk_name":"Fingerspot","fk_time":"20260929131417","fk_info":{…}}
server ← 200      response_code: OK   trans_id: 454215   cmd_code: SET_COMMAND
                  body: 41000000 {"cmd":"enter_enroll","param":{"user_id":"2","backup_number":0}} 00
mesin  → POST /   request_code: send_cmd_result   trans_id: 454215   cmd_return_code: OK   (body kosong)
server ← 200      response_code: OK
   … layar daftar muncul, jari ditempel 3× …
mesin  → POST /   request_code: realtime_enroll_data   trans_id: RTEnrollDataAction
                  body: {"enroll_data_array":[{"backup_number":0,"enroll_data":"BIN_1"}],"user_id":"2",
                         "user_name":"Budi Santoso","user_privilege":"USER"} + 800 byte template
server ← 200      response_code: OK
```

## 9. Pencarian mesin di jaringan (TCP 5005)

Server FkWeb tidak perlu tahu IP mesin, karena mesinlah yang menghubungi server. Pencarian ini
hanya untuk menemukan mesin yang **belum** terhubung dan mengetahui modenya (`freedom-finger cari`,
`/api/scan_devices`). Caranya: setiap alamat di jaringan lokal dicoba di TCP 5005, lalu dikirim
satu handshake. Protokol mode Lokal selebihnya tidak dipakai.

**Handshake** (perintah `80`), 16 byte, little-endian [UJI]:

| Offset | Ukuran | Isi |
|---|---|---|
| 0 | 2 | `55 AA` |
| 2 | 1 | `01` (nomor mesin) |
| 3 | 1 | `80` (perintah handshake) |
| 4 | 4 | Password komunikasi (u32 mentah). Bawaan mesin `0`. |
| 8 | 4 | Nonce bebas; `FFFF0001` diterima |
| 12 | 2 | `00 00` (tanpa data) |
| 14 | 2 | Nomor urut `01 00` |

Contoh: `55aa0180 00000000 0100ffff 0000 0100`.

**Ack** dari mesin, 10 byte: `AA 55 | 01 | result | status u32 | seq u16`. `result` = `01` bila
diterima, `00` bila password salah.

| Hasil | Arti |
|---|---|
| Ack `01` | Mesin di **mode Lokal**. Ubah ke Mode Internet agar mengirim ke server. |
| Ack `00` | Mode Lokal, tetapi password komunikasi berbeda. |
| Port terbuka, tidak ada ack (±3 detik) | Kemungkinan mesin di **mode Internet**. Selama mode Internet, port 5005 menerima koneksi tetapi tidak menjawab handshake. [UJI] |
| Port tertutup | Bukan mesin, atau mesin mati. |

WiFi mesin lambat (ping 250–1.200 ms): pakai batas waktu koneksi minimal 1,5 detik.

## 10. Sumber

- Uji langsung dan relay `fdevice.com:9004` ↔ mesin, 29 September 2026
- [InjesApp: server FkWeb resmi](https://github.com/GhazanfarKhan/InjesApp)
  (`FKWebCmdTrans.cs`, `Default.aspx.cs`, `ControlFK/UserManage.aspx.cs`): format body,
  header, blok, `SET_USER_INFO`
- [developer.fingerspot.io/docs](https://developer.fingerspot.io/docs/en/getting-started):
  bentuk API dan webhook yang ditiru `freedom-finger`
- [fingerspot.io/device](https://fingerspot.io/device): port 8013/8014
- [arivin29/finger](https://github.com/arivin29/finger/blob/master/data1): rekaman
  request FkWeb mesin lain (2019)
- Handshake bagian 9: dekompilasi `FKAttend.dll` dan `FKViaDev.dll` (Ghidra 12.1.4) dari paket
  SDK FK di [biomax_security](https://github.com/Yaswanth-Vempuluru-7916/biomax_security), dan uji
  langsung ke mesin, 28 September 2026
- [Spesifikasi Revo WF-206BNC di Fingerspot.io](https://fingerspot.io/detail-product/mesin-absensi-sidik-jari-wajah-revo-wf-206bnc):
  kapasitas, PIN 22 digit
