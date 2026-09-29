# Operations guide

Mesin Fingerspot Revo WF-206BNC mengirim data ke `freedom-finger` di komputer Anda, bukan
ke cloud Fingerspot. Latar belakang: `riset.md` bagian 10. Protokol: `protokol.md` bagian 14.

> Pemasangan otomatis sebagai layanan (`freedom-finger install`) sedang dikerjakan. Sampai
> itu, server dijalankan manual (bagian 2).

## 1. Settings that must stay fixed

| Tempat | Setting |
|---|---|
| Menu mesin → Jaringan | Mode **Internet**, Server IP = **IP komputer server**, Server Port **`8013`**, Server Req **Ya** |
| Router | **IP tetap (reservasi DHCP)** untuk komputer server dan mesin. Kalau IP server berubah, mesin tidak punya tujuan kirim. |
| Komputer server | Menyala terus. Selama server mati, mesin menyimpan log dan mengirimnya setelah server hidup lagi. |
| `.env` (hanya bisa dibaca akun server) | `FKWEB_TOKEN` (token API), opsional `FKWEB_DEVICES` dan `FKWEB_WEBHOOK`; daftar lengkap di `README.md` |

Mode **Lokal** hanya perlu untuk CLI `fk` (port 5005: kunci keypad, jadwal shift).
Selama mode Lokal, server tidak menerima apa pun. Kembalikan ke Internet setelah selesai.

## 2. Running the server

```sh
freedom-finger            # membaca .env di direktori kerja, mendengarkan port 8013
```

Server mencatat ke layar setiap perintah yang dikirim ke mesin (`>> …`) dan setiap kali jam
mesin disetel ulang. Firewall komputer server harus mengizinkan koneksi masuk ke port 8013
dari jaringan lokal.

## 3. Using the API

Semua endpoint: `POST http://<IP server>:8013/api/<endpoint>`, dengan header
`Authorization: Bearer <FKWEB_TOKEN>` dan body JSON berisi `cloud_id`. Bentuknya sama
dengan [developer.fingerspot.io](https://developer.fingerspot.io/docs/en/getting-started).
Daftar lengkap ada di dokumentasi modul `crates/freedom-finger/src/service.rs`.

```sh
source .env
api() { curl -s http://localhost:8013/api/$1 -H "Authorization: Bearer $FKWEB_TOKEN" \
  -H "Content-Type: application/json" -d "{\"cloud_id\":\"<Cloud ID mesin>\",$2}"; echo; }

api get_attlog '"start_date":"2026-09-29","end_date":"2026-09-29"'   # log dari database
api get_device '"trans_id":"x"'                                      # status mesin
api get_userinfo '"trans_id":"u1","pin":"2"'                          # async, lihat hasilnya:
api get_result '"trans_id":"u1"'                                     # status pending/sent/done/timeout
```

Cloud ID tertera di menu mesin, dan juga di log server saat mesin pertama kali terhubung.
Perintah async langsung membalas `{"success":true,"trans_id":…}`. Mesin mengambil
perintah saat bertanya berikutnya (±20 detik sampai 2 menit). Hasilnya diambil lewat
`get_result`, atau dikirim ke `FKWEB_WEBHOOK`. `trans_id` harus unik.

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
| `get_device.last_activity` tidak bergerak | Menu mesin sedang terbuka; keluar ke layar utama. Cek Mode = Internet dan Server IP = IP server. Cek server hidup dan port 8013 tidak diblok firewall. |
| Perintah `status: timeout` | Mesin tidak menjawab perintah atau PIN yang tidak dikenal (misalnya PIN tidak ada). |
| Jam log 2015 | Mesin sempat mati listrik. Server menyetel jam otomatis; log yang terlanjur tercatat bertanggal 2015 perlu dikoreksi manual. |
| "gambar sidik jari tidak cukup" saat daftar | Tempel bantalan jari rata, diam sampai bunyi, angkat penuh; jari jangan terlalu kering. |
| `fk`: mesin tidak menjawab handshake | Mesin sedang di mode Internet. Pindah ke mode Lokal di menu Jaringan. |

## 6. Security

- `absensi.db` dan `photos/` berisi **data biometrik**. Simpan di folder yang hanya bisa
  dibaca akun server. Backup juga harus disimpan rahasia.
- Token API ada di `.env`. Jangan dibagikan, dan buat ulang bila bocor
  (`openssl rand -hex 24`), lalu jalankan ulang server.
- Port 8013 tanpa TLS dan terbuka di LAN. Letakkan mesin dan server di jaringan kantor
  yang tepercaya.
