# Riset Integrasi Mesin Absensi Fingerspot Revo WF-206BNC

Tanggal: 29 September 2026 (revisi 6); diringkas 1 Oktober 2026
Mesin: Fingerspot Revo WF-206BNC, produksi 17-01-2022
Tujuan: aplikasi absensi yang memakai mesin **secara lokal saja**, tanpa cloud fingerspot.io.

> Spesifikasi protokol yang dipakai (FkWeb, mode Internet) ada di **`protokol.md`**. Dokumen ini
> laporan riset: bagaimana protokol itu ditemukan dan apa yang teramati di mesin. Riset protokol
> mode Lokal (TCP 5005) dihapus pada 1 Oktober 2026, karena aplikasi hanya memakai FkWeb. Yang
> tersisa dari TCP 5005 hanyalah handshake untuk mencari mesin di jaringan. Riwayat lengkapnya ada
> di git history.

## 1. Ringkasan

- Menu mesin **Jaringan → Mode Internet** membuat mesin mengirim **FkWeb** (HTTP) ke
  Server IP/Port. **Mode Lokal** hanya melayani TCP 5005. Kedua jalur tidak bisa aktif
  bersamaan: selama mode Internet, port 5005 menerima koneksi tetapi tidak menjawab handshake.
  Perbedaan ini yang dipakai pencarian mesin untuk mengenali modenya.
- Semua perintah API developer.fingerspot.io disadap lewat relay, lalu diterjemahkan ke
  perintah FkWeb (bagian 5.4). **Register Online** ternyata
  `SET_COMMAND {"cmd":"enter_enroll","param":{"user_id","backup_number"}}`, jadi jari dan wajah
  bisa didaftarkan dari aplikasi tanpa menu manager.
- Server sendiri menggantikan cloud Fingerspot. Semua endpoint REVO terbukti di mesin: daftar
  jari jarak jauh, jadikan admin, tambah/baca/hapus user, jam, restart, dan tarik 1.697 log.
- **Mesin menghubungi server**, jadi **IP komputer server wajib direservasi di router.**
- **Jam mesin kembali ke 2015 setiap listrik mati** (kemungkinan baterai RTC lemah). Server
  menyetelnya ulang otomatis.
- **Status masuk/pulang diganti otomatis oleh jam** [DUGA kuat dari data]: dari 1.688 log, tidak
  ada "masuk" sebelum 09:01 dan tidak ada "pulang" antara 08:57 dan 15:40. Aplikasi menentukan
  masuk/pulang sendiri dari jam dan urutan absen.
- **Nama di mesin maksimal 15 karakter.** Aplikasi menyimpan nama lengkap sendiri.
- **Mesin ini OEM:** platform dan protokol dari keluarga **FK SmackBio**, dipasarkan Realand,
  bermerek Fingerspot (bagian 3).

> Uji tulis hanya dilakukan dengan izin, pada user tes PIN 99999 (selalu dihapus lagi) dan jam
> mesin.

---

## 2. Hasil cek jaringan

| Cek | Hasil |
|---|---|
| Ping | 258–1.220 ms, paket pertama timeout. Normalnya di LAN < 5 ms, jadi sinyal WiFi kemungkinan lemah. |
| MAC | WiFi `f0:c8:14:00:00:00` → Shenzhen Bilian (LB-LINK). Ini pembuat **modul WiFi**, bukan pembuat mesin. Port LAN kabel punya MAC sendiri, `1a:00:00:00:00:ab` (dari `B0`). |
| TCP 5005 | **Terbuka.** Protokol mode Lokal FK "CIF13_1". Kini hanya dipakai untuk mengenali mesin (handshake, `protokol.md` bagian 9). |
| TCP 23 (telnet) | **Terbuka**, login `buildroot`. Mesin berbasis Linux Buildroot. |
| UDP 5005/5500/5010 (protokol ZD2911) | Tidak dibalas. |
| TCP 80, 443, 4370, 7005, 8080, 8081, 8090, 21, 22 | Tertutup. Tidak ada panel web, bukan ZKTeco. |

## 3. Identifikasi OEM

```
SmackBio / keluarga FK (firmware + SDK: FK623Attend, FKAttend, FKViaDev)
        └── Realand (menjual perangkat SmackBio; "Model 2960" = SmackBio SB2960)
                └── Fingerspot (Revo WF-206BNC, EasyLink, fingerspot.io)
```

Merek lain di platform yang sama (dari GitHub): Biomax, Secureye, Time Office
(India), BioTime/BioFace, Akfon (Turki), NovinPardaz (Iran).

**Bukti:**

1. Handshake mesin mengembalikan `CommunicationInterfaceId:13_1`. `FKAttend.dll`
   punya kelas **`CFKAttend_CIF13_1`**, yang dipilih berdasarkan string itu.
2. Kode `FKViaDev.dll` membangun **bingkai handshake yang persis sama** dengan yang diterima mesin.
3. Blok info mesin di offset 8 berisi **1261**, yaitu nilai license bawaan SDK FK.
   Port default SDK FK adalah **5005**.
4. SDK resmi Realand untuk wajah ternyata SDK SmackBio (`SBXPC`).
5. Tiga SDK dibongkar dan dibandingkan:

   | SDK | Bingkai | Cocok? |
   |---|---|---|
   | Realand `Riss.Devices` (ZDC2911) | UDP, 28 byte | ✗ (tidak dibalas) |
   | SmackBio `SBXPC` (lama) | TCP, `55 AA DN 79 19 cmd…` | ✗ |
   | **SmackBio `FKAttend`/`FKViaDev` (FK)** | **TCP, 16 byte** | **✓** |

## 4. Fakta mesin yang teramati

| Hal | Hasil |
|---|---|
| Handshake TCP 5005 (mode Lokal) | Diterima **tanpa password** (`p1=0`). Password salah (`p1=1234`) **ditolak** (ack `00`). |
| Kapasitas resmi | **2.000 user, 10.000 sidik jari, 2.000 password, 2.000 kartu, 2.000 wajah, 200.000 log**, sama dengan spesifikasi di situs Fingerspot |
| Kemampuan | Jari, password, kartu, wajah; `FpDataVer` 128, `FaceDataVer` 528 |
| Log | 1.688 log (26-03-2026 s/d 28-09-2026): 1.230 sidik jari, 458 wajah |
| Firmware | `A102D2S2K1Wfs01 v1.14` (dari `fk_info` FkWeb) |

## 5. FkWeb push dan server sendiri (revisi 6, 29-09-2026)

Spesifikasi protokol FkWeb ada di `protokol.md`. Panduan operasional ada di
`operasional.md`.

### 5.1 Menu Jaringan mesin [FISIK, UJI]

| Menu | Nilai sekarang | Arti |
|---|---|---|
| Mode | **Internet** | Internet = kirim FkWeb (HTTP) ke Server IP:Port. Lokal = hanya TCP 5005, tanpa kirim apa pun. |
| No Mesin | 1 | Nomor mesin (DN) |
| Ethernet | Tidak | LAN kabel mati; memakai WiFi |
| WLAN | 192.168.1.201 | IP WiFi (DHCP) |
| No Port | 5005 | Port mode Lokal (hanya menjawab handshake di mode Lokal) |
| Password | 0 | Password komunikasi |
| Server IP | **192.168.1.10** | Tujuan FkWeb (Mac) |
| Server Port | **8013** | Tersimpan di `B0` indeks `0x3c` [UJI]. `0x38` **bukan** Server IP. |
| Server Req | Ya | Belum pasti artinya; mirip "Real Time Req" di seri Vega [DUGA] |

- **Lokal ↔ Internet saling menggantikan.** Selama mode Internet, port 5005 menerima
  koneksi TCP tapi tidak menjawab handshake `0x80`.
- Selama menu mesin terbuka, mesin tidak berkomunikasi sama sekali.

### 5.2 Server cloud Fingerspot [UJI]

| Layanan | Server mesin | Catatan |
|---|---|---|
| fingerspot.io, tipe "ZK" | `fdevice.com:8013` | Hasil cek perangkat untuk mesin ini |
| fingerspot.io, panduan Revo | `fdevice.com:8014` | Halaman `fingerspot.io/device` |
| **developer.fingerspot.io (SDK Online)** | **`fdevice.com:9004`** | Tertulis di portal: Mesin Absensi → Detail |

- Ketiganya server Sails.js yang berbicara FkWeb. `fdevice.com` = `3.1.174.198`.
- Cloud ID = `dev_id`.
- Platform developer tidak melihat mesin yang terhubung ke port 8013/8014
  (`get_device` menjawab `last_activity: N/A`), sehingga perintah API-nya hanya tertunda.

### 5.3 Cara menyadap [UJI]

1. Mesin diarahkan ke `192.168.1.10:8013`, tempat alat relay `fkweb.ts` meneruskan semua
   request ke `fdevice.com:9004`.
2. Setiap endpoint developer.fingerspot.io dipanggil satu kali dengan token akun developer.
3. Relay mencatat perintah yang dikirim cloud ke mesin beserta jawabannya
   (`fkweb.log`, body mentah base64).
4. Tulis hanya dilakukan ke user uji PIN 99999, yang selalu dihapus lagi.
5. Setelah riset selesai, `fkweb.ts` dan `fkweb.log` dihapus, karena log itu berisi
   template biometrik mentah. `server.ts` menggantikan alat relay itu, dan hasilnya
   tercatat di bagian ini.

### 5.4 Peta API developer.fingerspot.io → FkWeb [UJI]

| API | `cmd_code` | `cmd_param` | Jawaban mesin |
|---|---|---|---|
| `get_all_pin` | `GET_USER_ID_LIST` | – | `{"one_user_id_size":36,"user_id_array":"BIN_1","user_id_count":N}` + record 36 byte |
| `get_userinfo` | `GET_USER_INFO` | `{"user_id"}` | `{"enable_flag","enroll_data_array":[{"backup_number","enroll_data":"BIN_n"}],"user_id","user_name","user_privilege"}` + biner |
| `set_userinfo` | `SET_USER_INFO` | JSON seperti di atas + biner | `OK`. Mengganti seluruh data user. |
| `delete_userinfo` | `DELETE_USER` | `{"user_id"}` | `OK` |
| `reg_online` | `SET_COMMAND` | `{"cmd":"enter_enroll","param":{"user_id","backup_number"}}` | `OK` langsung. Layar daftar muncul; hasil daftar datang sebagai `realtime_enroll_data`. |
| `set_time` (zona) | `SET_TIME` | `{"time":"YYYYMMDDhhmmss"}` | `OK`. Zona tidak disimpan di mesin, hanya jamnya. |
| `restart_device` | `RESET_FK` | – | Tidak ada jawaban; mesin langsung restart |
| `get_attlog`, `get_device`, webhook attlog | – | – | Dilayani dari database cloud, yang diisi `realtime_glog` |
| (di luar API) | `GET_LOG_DATA` | – | `{"log_count","one_log_size":48}` + semua log, record 48 byte |

Password = `backup_number` 10 dengan biner ASCII tanpa NUL. Hak akses API
`1`/`2`/`3` = FkWeb `USER`/`MANAGER`/`OPERATOR`. `OPERATOR` diterima dan disimpan mesin.

### 5.5 Perilaku mesin yang teramati [UJI]

- **Poll `receive_cmd`:** setiap ±20 detik saat aktif, sampai ±2 menit saat diam.
  Setelah menjalankan perintah, mesin langsung bertanya lagi.
- **Perintah atau PIN yang tidak dikenal tidak dijawab sama sekali** (tidak ada
  `send_cmd_result`). Server perlu batas waktu.
- **Pertama kali tersambung,** mesin mengirim seluruh log yang belum pernah terkirim
  (±1.656), satu log per request, beberapa per menit.
- **`realtime_enroll_data`** dikirim setiap user/jari/wajah didaftarkan atau diubah.
  Isinya nama, hak akses, foto profil, template jari (800 byte), dan wajah (20.000 byte).
- **Log realtime:** `{"io_time":"YYYYMMDDhhmmss","io_mode","verify_mode","user_id","log_image":null}`.
  - `io_mode` dan `verify_mode` sama dengan byte 40–47 record 48 byte (`io_mode` =
    aksi << 24; nibble teratas `verify_mode` = cara verifikasi).
  - `log_image` selalu null: mesin ini tidak mengirim foto absen.
- **Template jari yang dibaca ulang setelah `SET_USER_INFO`:** 676 byte pertama
  identik; byte 676–798 berubah. Absen dan login admin tetap berhasil.
- **Jam kembali ke 2015 setelah mati listrik;** tidak setelah `RESET_FK`.

### 5.6 Server pertama (`server.ts`, kini crate `freedom-finger`) [UJI]

- API berbentuk sama dengan developer.fingerspot.io; daftar endpoint ada di kepala
  `server.ts`. Tambahannya:
  - `sync_attlog` (GET_LOG_DATA);
  - `get_backup` (cadangan user untuk dipulihkan);
  - `get_result` (hasil perintah async).
- Webhook opsional (`FKWEB_WEBHOOK`) dengan bentuk callback yang sama.
- SQLite `absensi.db`, dengan tabel:
  - `logs`;
  - `users` (cadangan body FkWeb utuh);
  - `cmds` (antrean perintah);
  - `devices`.
- Terbukti di mesin (29-09-2026):
  - `get_device`, `get_all_pin`, dan `get_userinfo`;
  - `set_userinfo` dan `delete_userinfo` (PIN 99999, termasuk password dan privilege 3);
  - `set_time`;
  - `sync_attlog` (1.697 log dalam 1 detik);
  - cadangan 11 user;
  - webhook ke penerima HTTP lokal;
  - **log realtime:** absen PIN 2 pukul 14:21:23 masuk database 3 detik kemudian, dan
    webhook `attlog` terkirim 2 detik setelah absen.
  - Sebelumnya lewat relay: `reg_online` dan `SET_USER_INFO` admin untuk PIN 2.

## 6. Risiko dan keamanan

1. **Port 5005 tanpa password.** Di mode Lokal, siapa pun di LAN bisa membaca atau menghapus log
   dan user lewat port ini. Di mode Internet port ini tidak menjawab handshake. Tetap sarankan
   password komunikasi di mesin dan VLAN/SSID khusus untuk mesin.
2. **Telnet terbuka** dengan login root Buildroot. Isolasi jaringan.
3. **WiFi lemah.** Ping mesin sampai 1,2 detik. Pakai kabel LAN atau perkuat WiFi. Dengan FkWeb, yang wajib
   tetap adalah IP **komputer server** (reservasi DHCP di router), bukan IP mesin.
4. **Jam mesin** adalah sumber waktu log. Jam kembali ke **01-01-2015** setiap listrik mati (restart
   lewat `RESET_FK` tidak). Server mengirim `SET_TIME` otomatis bila selisih lebih dari 2 menit.
5. **FkWeb tanpa TLS dan tanpa autentikasi mesin (revisi 6).** Siapa pun di LAN bisa
   mengirim log palsu ke port 8013. `dev_id` tidak rahasia, jadi `FKWEB_DEVICES` hanya
   penyaring ringan. API `/api/*` dilindungi token Bearer di `freedom-finger.env`.
6. **Data biometrik di komputer server.** Template jari/wajah, password, dan foto
   tersimpan di `absensi.db`. Backup database harus diperlakukan sama rahasianya.

## 7. Pilihan akses

| Opsi | Lokal? | Ubah mesin? | Realtime? | Status |
|---|---|---|---|---|
| A. TCP 5005 langsung (mode Lokal) | ✓ | Tidak | Hampir (polling) | Dihapus 01-10-2026; tinggal handshake untuk pencarian mesin |
| **B. FkWeb push (HTTP) ke server lokal** | ✓ | Ya (menu Jaringan) | Ya | **Dipakai sejak revisi 6** |
| C. SDK resmi (FKAttend / EasyLink) | ✓ | Tidak | – | Hanya Windows |
| D. Cloud fingerspot.io | ✗ | – | – | Tidak sesuai kebutuhan |

Opsi B dipakai karena log masuk realtime tanpa polling, dan daftar jari/wajah jarak jauh serta
semua fitur developer.fingerspot.io hanya ada di FkWeb.

## Sumber

**FkWeb:**
- [GhazanfarKhan/InjesApp: server FkWeb resmi](https://github.com/GhazanfarKhan/InjesApp/blob/master/fkwebserver_src/App_Code/FKWebCmdTrans.cs)
- [imodoiepale/citywalk-attendance – varian FkWeb](https://github.com/imodoiepale/citywalk-attendance)
- [PangeranSilaen/fingerspot-simulator](https://github.com/PangeranSilaen/fingerspot-simulator)
- [andreracodex/fingerspot](https://github.com/andreracodex/fingerspot)
- [La-DevHouse/biometric-server](https://github.com/La-DevHouse/biometric-server)
- [developer.fingerspot.io](https://developer.fingerspot.io/)

**Identitas mesin dan handshake:**
- SDK FK (`FK623Attend.dll`, `FKAttend.dll`, `FKViaDev.dll`, `FKModelDic.ini`) dari
  [biomax_security](https://github.com/Yaswanth-Vempuluru-7916/biomax_security),
  [NovinPardaz_Device_Connector](https://github.com/AliRezaKhazaeiNezhad/NovinPardaz_Device_Connector),
  dan [UTAS](https://github.com/TahaImran1/UTAS)
- [Ab0umar/selrs.cc – catatan FK DLL (port 5005, license 1261)](https://github.com/Ab0umar/selrs.cc)
- [Realand – info perusahaan](https://www.realandtec.com/info/4.html)
- [Fingerspot Revo WF-206BNC](https://fingerspot.com/product/mesin-absensi-sidik-jari-wajah-revo-wf-206bnc)
