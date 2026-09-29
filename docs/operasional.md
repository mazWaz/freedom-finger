# Operations guide

Mesin Fingerspot Revo WF-206BNC mengirim data ke `freedom-finger` di komputer Anda, bukan
ke cloud Fingerspot. Latar belakang: `riset.md` bagian 10. Protokol: `protokol.md` bagian 14.


## 1. Settings that must stay fixed

| Tempat | Setting |
|---|---|
| Menu mesin → Jaringan | Mode **Internet**, Server IP = **IP komputer server**, Server Port **`8013`**, Server Req **Ya** |
| Router | **IP tetap (reservasi DHCP)** untuk komputer server dan mesin. Kalau IP server berubah, mesin tidak punya tujuan kirim. |
| Komputer server | Menyala terus. Selama server mati, mesin menyimpan log dan mengirimnya setelah server hidup lagi. |
| `freedom-finger.env` di folder data | Dibuat otomatis berisi `FKWEB_TOKEN` (token API); opsional `FKWEB_DEVICES`, `FKWEB_WEBHOOK`; daftar lengkap di `README.md` |

Mode **Lokal** hanya perlu untuk `freedom-finger mesin …` (port 5005: kunci keypad, jadwal shift).
Selama mode Lokal, server tidak menerima apa pun. Kembalikan ke Internet setelah selesai.

## 2. Running the server

```sh
sudo freedom-finger install     # layanan: jalan sendiri saat komputer menyala (Windows: Run as administrator)
freedom-finger status           # server berjalan? mesin terhubung?
freedom-finger cari             # cari mesin di jaringan lokal
freedom-finger                  # atau jalankan di terminal saja
sudo freedom-finger uninstall   # lepas layanan; data tetap ada
```

| OS | Folder data | Layanan | Log |
|---|---|---|---|
| Windows | `C:\FreedomFinger` | `FreedomFinger` (services.msc) | - |
| Linux | `/opt/freedom-finger` | `systemctl status freedom-finger` | `journalctl -u freedom-finger` |
| macOS | `/opt/freedom-finger` | `launchctl print system/com.github.mazwaz.freedom-finger` | `/opt/freedom-finger/freedom-finger.log` |

`install` membuka port 8013 di firewall Windows, ufw, atau firewalld. Server mencatat setiap
perintah yang dikirim ke mesin (`>> …`) dan setiap kali jam mesin disetel ulang. Halaman
`http://localhost:8013` menunjukkan mesin yang terhubung, jumlah absen, dan tombol cari mesin.

## 3. Using the API

Semua endpoint: `POST http://<IP server>:8013/api/<endpoint>`, dengan header
`Authorization: Bearer <FKWEB_TOKEN>` dan body JSON berisi `cloud_id`. Bentuknya sama
dengan [developer.fingerspot.io](https://developer.fingerspot.io/docs/en/getting-started).
Daftar lengkap, contoh balasan, dan event realtime ada di `docs/api.md`.

```sh
source freedom-finger.env
api() { curl -s http://localhost:8013/api/$1 -H "Authorization: Bearer $FKWEB_TOKEN" -d "{$2}"; echo; }

api get_devices                                                   # mesin yang terhubung
api get_attlog '"start_date":"2026-09-29","end_date":"2026-09-29"'  # log dari database
api get_userinfo '"pin":"2"'                                       # async: balasannya berisi trans_id
api get_result '"trans_id":"<trans_id dari balasan>"'              # pending/sent/done/timeout
```

`cloud_id` boleh kosong selama baru satu mesin yang terhubung; bila lebih, isi dengan Cloud
ID dari `get_devices`. Perintah async langsung membalas `{"success":true,"trans_id":…}`;
`trans_id` dibuat server bila tidak diisi. Mesin mengambil perintah saat bertanya
berikutnya (±20 detik sampai 2 menit). Hasilnya diambil lewat `get_result`, dikirim ke
`FKWEB_WEBHOOK`, dan muncul di `/api/events`.

Absen baru dan hasil perintah bisa diterima langsung tanpa webhook, lewat Server-Sent Events:

```sh
curl -N http://localhost:8013/api/events -H "Authorization: Bearer $FKWEB_TOKEN"
# data: {"type":"attlog","cloud_id":"<cloud_id>","data":{"pin":"2","scan":"2026-09-29 08:00","verify":"1","status_scan":"0"}}
```

Isi tiap event sama dengan callback webhook. Event yang terlewat saat koneksi putus tidak
dikirim ulang; ambil lewat `get_attlog` atau `get_result`.

## 4. Everyday tasks

| Tugas | Cara |
|---|---|
| **Karyawan baru** | `set_userinfo` `{"data":{"pin":"20","name":"Nama","privilege":"1","password":"","rfid":"","template":""}}`, lalu daftar jari (baris berikut) |
| **Daftar jari/wajah tanpa menu manager** | `reg_online` `{"trans_id":…,"pin":"20","verification":0}` (0–9 jari, 12 wajah). Orangnya berdiri di mesin; layar daftar muncul dalam ±2 menit, tempel jari 3×. |
| **Jadikan admin / ganti nama** | Ambil `template` dari `get_userinfo`, lalu `set_userinfo` dengan `template` itu dan `privilege":"2"` / `name` baru. **Tanpa template, jari dan wajahnya terhapus.** |
| **Hapus karyawan** | `delete_userinfo` `{"pin":…}`. Cadangannya tetap ada di database. |
| **Pulihkan karyawan terhapus** | `get_backup` `{"pin":…}`, lalu `set_userinfo` dengan `template` dari cadangan (hak akses ikut) |
| **Tarik semua log dari mesin** | `sync_attlog`. Log ganda diabaikan. |
| **Setel jam** | Otomatis bila selisih lebih dari 2 menit. Manual: `set_time` `{"timezone":"Asia/Jakarta"}`. |
| **Restart mesin** | `restart_device` |

Hak akses: `1` user, `2` admin (MANAGER), `3` subadmin (OPERATOR).

## 5. Common problems

| Gejala | Penyebab dan solusi |
|---|---|
| Mesin tidak muncul di halaman status | Menu mesin sedang terbuka; keluar ke layar utama. `freedom-finger cari` menunjukkan mesin dan isian menu yang benar. Cek port 8013 tidak diblok firewall. |
| Perintah `status: timeout` | Mesin tidak menjawab perintah atau PIN yang tidak dikenal (misalnya PIN tidak ada). |
| Jam log 2015 | Mesin sempat mati listrik. Server menyetel jam otomatis; log yang terlanjur tercatat bertanggal 2015 perlu dikoreksi manual. |
| "gambar sidik jari tidak cukup" saat daftar | Tempel bantalan jari rata, diam sampai bunyi, angkat penuh; jari jangan terlalu kering. |
| `mesin …`: mesin tidak menjawab handshake | Mesin sedang di mode Internet. Pindah ke mode Lokal di menu Jaringan. |
| Windows: "Windows protected your PC" | Program belum bertanda tangan. Klik **More info → Run anyway**. |
| macOS: "cannot be opened because the developer cannot be verified" | Program belum bertanda tangan. Jalankan `xattr -d com.apple.quarantine freedom-finger` di folder program. |

## 6. Security

- `absensi.db` dan `photos/` berisi **data biometrik**. Simpan di folder yang hanya bisa
  dibaca akun server. Backup juga harus disimpan rahasia.
- Token API ada di `freedom-finger.env`. Jangan dibagikan. Bila bocor, hapus baris
  `FKWEB_TOKEN` (token baru dibuat otomatis), lalu jalankan ulang server.
- Port 8013 tanpa TLS dan terbuka di LAN. Letakkan mesin dan server di jaringan kantor
  yang tepercaya.
