# Riset Integrasi Mesin Absensi Fingerspot Revo WF-206BNC

Tanggal: 29 September 2026 (revisi 6)
Mesin: Fingerspot Revo WF-206BNC, IP `192.168.1.201`, port `5005`
Serial `Fio00000000000000`, produksi 17-01-2022.
Server: Mac ini, `192.168.1.10` (subnet `192.168.1.0/24`, satu jaringan dengan mesin)
Tujuan: aplikasi absensi yang mengakses mesin **secara lokal saja**, tanpa cloud fingerspot.io.

> **Spesifikasi protokol lengkap yang netral bahasa** (bingkai, semua perintah, contoh
> response hex, test vector, status uji) ada di **`protokol.md`**. Dokumen ini adalah
> laporan riset.
>
> **Catatan 29-09-2026:** kode Bun/TypeScript yang disebut di sini (`fk.ts`, `server.ts`,
> dan uji-ujinya) sedang digantikan workspace Rust. Susunan kode sekarang ada di
> `arsitektur.md`. Nama file lama dibiarkan sebagai catatan riwayat riset.

## Ringkasan

**Revisi 6 (29-09-2026): mesin kini memakai server sendiri lewat FkWeb push. Detail di bagian 10.**
- Menu mesin **Jaringan → Mode Internet** membuat mesin mengirim **FkWeb** (HTTP) ke
  Server IP/Port. **Mode Lokal** hanya melayani TCP 5005. Kedua jalur tidak bisa aktif
  bersamaan: selama mode Internet, port 5005 tidak menjawab handshake.
- Semua perintah API developer.fingerspot.io disadap lewat relay, lalu diterjemahkan
  ke perintah FkWeb. **Register Online** ternyata
  `SET_COMMAND {"cmd":"enter_enroll","param":{"user_id","backup_number"}}`.
- **`server.ts`** menggantikan cloud Fingerspot. Semua endpoint REVO terbukti di mesin:
  - daftar jari jarak jauh;
  - jadikan admin;
  - tambah, baca, dan hapus user;
  - jam;
  - restart;
  - tarik 1.697 log.
- Server berjalan lewat launchd dan Mac ditahan agar tidak tidur. Mesin sekarang
  mengarah ke `192.168.1.10:8013`, **jadi IP Mac wajib direservasi di router.**
- **Jam mesin kembali ke 2015 setiap listrik mati** (kemungkinan baterai RTC lemah).
  Server menyetelnya ulang otomatis.

- **Mesin ini OEM.** Rantainya:
  - **Platform dan protokol:** keluarga **FK dari SmackBio**. Mesin melapor
    `CommunicationInterfaceId:13_1`, dan kelas yang menanganinya di SDK resmi
    bernama `CFKAttend_CIF13_1`.
  - **Pemasaran:** Realand (Guangzhou) menjual perangkat SmackBio.
  - **Merek akhir:** Fingerspot.
- **Port 5005 bisa diakses langsung** dari Mac/Python tanpa DLL, EasyLink, atau cloud.
  Protokolnya dibongkar dari DLL resmi (`FKAttend.dll` / `FKViaDev.dll`).
- **Semua fungsi baca sudah terbukti di mesin ini:**
  - jam mesin;
  - status dan kapasitas;
  - data produk dan serial;
  - **seluruh 1.688 log** (3,2 detik);
  - daftar 11 user beserta namanya.
  - Format kirim data dari host ke mesin juga sudah tervalidasi.
- **Setting mesin tidak perlu diubah.**
- **Kelola user sudah terbukti di mesin** (revisi 5, memakai user tes PIN 99999
  yang sudah dihapus lagi): tambah, ganti nama, hak akses, aktif / nonaktif, dan hapus.
  Script-nya ada di `fk.ts` (Bun).
- **Sinkron jam sudah terbukti** (`bun fk.ts jam --sinkron`). Selisih +19 detik menjadi 0.
- **Kunci / buka keypad sudah terbukti.**
- **Semua temuan diuji ulang secara otomatis** di `fk.mesin.test.ts`:
  - 25 uji ke mesin lulus (16 baca, 9 tulis dengan PIN 99999);
  - 6 uji offline lulus.
  - Cara menjalankan ada di bagian 9.
- **Koreksi dari revisi sebelumnya:**
  - Label "Realand ZDC2911" dari proyek Rate-My-Staff kurang tepat.
  - Revisi 3 terlalu cepat menandai daftar user dan nama sebagai "sudah diuji".
    Sekarang benar-benar sudah diuji.
  - Revisi 5:
    - offset flag daftar user bergeser satu byte (sekarang [32]/[33]/[34]);
    - blok info [164] ternyata **bukan** flag aktif (bagian 4.4);
    - IP/MAC di `B0` adalah setting LAN kabel, bukan WiFi.

> **Uji baca** tidak menulis, mengubah, menghapus, atau menandai log. **Uji tulis**
> hanya dilakukan dengan izin, pada user tes PIN 99999 (selalu dihapus lagi),
> keypad (dibuka lagi), dan jam mesin. DLL hanya dibongkar secara offline di Docker.

---

## 1. Hasil cek jaringan

| Cek | Hasil |
|---|---|
| Ping | 258–1.220 ms, paket pertama timeout. Normalnya di LAN < 5 ms, jadi sinyal WiFi kemungkinan lemah. |
| MAC | WiFi `f0:c8:14:00:00:00` → Shenzhen Bilian (LB-LINK). Ini pembuat **modul WiFi**, bukan pembuat mesin. Port LAN kabel punya MAC sendiri, `1a:00:00:00:00:ab` (dari `B0`). |
| TCP 5005 | **Terbuka.** Protokol FK "CIF13_1" (bagian 4). |
| TCP 23 (telnet) | **Terbuka**, login `buildroot`. Mesin berbasis Linux Buildroot. |
| UDP 5005/5500/5010 (protokol ZD2911) | Tidak dibalas. |
| TCP 80, 443, 4370, 7005, 8080, 8081, 8090, 21, 22 | Tertutup. Tidak ada panel web, bukan ZKTeco. |

## 2. Identifikasi OEM

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
2. Kode `FKViaDev.dll` membangun **bingkai yang persis sama** dengan yang diterima mesin.
3. Blok info mesin di offset 8 berisi **1261**, yaitu nilai license bawaan SDK FK.
   Port default SDK FK adalah **5005**.
4. SDK resmi Realand untuk wajah ternyata SDK SmackBio (`SBXPC`).
5. Tiga SDK dibongkar dan dibandingkan:

   | SDK | Bingkai | Cocok? |
   |---|---|---|
   | Realand `Riss.Devices` (ZDC2911) | UDP, 28 byte | ✗ (tidak dibalas) |
   | SmackBio `SBXPC` (lama) | TCP, `55 AA DN 79 19 cmd…` | ✗ |
   | **SmackBio `FKAttend`/`FKViaDev` (FK)** | **TCP, 16 byte** | **✓** |

## 3. Hasil uji langsung ke mesin (baca saja)

| Perintah | Hasil |
|---|---|
| Handshake `0x80` + `0x13` ×3 | Diterima **tanpa password** (`p1=0`). Password salah (`p1=1234`) **ditolak**. Kemampuan: `fp, pwd, idcard, face`; FpDataVer 128; FaceDataVer 528. |
| `0x13` blok info 48 byte | license 1261; lima angka kapasitas 10.000 / 2.000 / 2.000 / 1.000 / 200.000 (urutan field tidak pasti) |
| `0xB4` 200–207 kapasitas resmi | **2.000 user, 10.000 sidik jari, 2.000 password, 2.000 kartu, 2.000 wajah, 200.000 log**. Sama dengan spesifikasi di situs Fingerspot. |
| `0xC3` data produk | `Revo WF-206BNC` / `Fingerspot` / serial `Fio00000000000000` / 17-01-2022 |
| `0x79` versi firmware | Ditolak mesin (tidak didukung) |
| `0xB2` baca jam | `2026-09-28 21:34:44` (Senin), **+20 detik** dibanding jam Mac |
| `0xB4` status | 1 = manager **2** · 2 = user **9** · 3 = sidik jari **8** · 4 = password **1** · 5 = log admin baru 0 · 6 = log belum dibaca **1.650** · 7 = total log admin 0 · 8 = total log **1.688** · 9 = kartu 0 · 10 = wajah **8** · 11 = total user **11** (nama sesuai enum SDK) |
| `0xB0` info | [2] nomor mesin = 1; [0x28] port = 5005. Setting **LAN kabel**: [0x20] IP 192.168.0.10, [0x30] subnet 255.255.255.0, [0x34] gateway 192.168.0.1, [0x2a–0x2f] MAC `1a:00:00:00:00:ab`. WiFi memakai DHCP (192.168.1.201). |
| `0xA4` tarik semua log | **1.688 record, 80 halaman, 3,2 detik**. Tidak ada record rusak atau duplikat. Rentang 26-03-2026 s/d 28-09-2026. Aksi 886× masuk, 802× pulang. |
| `0x97` daftar user | 11 user (PIN 1, 2, 5, 6, 7, 8, 9, 11, 12, 13, 17) |
| `0xE8` nama user | 11 nama terbaca. Mesin menyimpan maksimal **15 karakter**. PIN yang tidak ada: baca ditolak dengan status 3. |
| Format kirim data host (lewat query `0xE8`) | Format dari kode terbukti benar: ack, seq, dan data cocok. |

Catatan:
- **38 log sudah ditandai "dibaca"** (1.688 − 1.650). Artinya pernah ada software
  lain (EasyLink atau cloud Fingerspot) yang menarik data dari mesin ini.
- **Pemakaian kapasitas log baru 0,8%** (1.688 dari 200.000).

## 4. Protokol TCP 5005 (FK "CIF13_1")

Sumber: dekompilasi `FKViaDev.dll` (bingkai dan socket) dan `FKAttend.dll`
(`CFKAttend_CIF13_1`), dengan Ghidra 12.1.4. Tanda:
- **[UJI]** = sudah dicoba ke mesin;
- **[KODE]** = terbaca langsung dari kode SDK, belum dicoba;
- **[DUGA]** = kesimpulan yang belum pasti.

### 4.1 Bingkai [UJI]

Semua angka little-endian kecuali disebut lain.

```
Perintah:  55 AA | DN (u8, =1) | cmd (u8) | p1 (u32) | p2 (u32) | len (u16) | seq (u16)   ← 16 byte
           + bila host mengirim data: 55 AA + data(len) + 00 00
Ack:       AA 55 | 01 | 01 (OK) / 00 atau FD (error) | status (u32) | seq (u16)          ← 10 byte
           + bila ada data balasan: 55 AA + data(len) + 4 byte penutup (abaikan)
```

- **`seq`**: penghitung per koneksi, 1, 2, 3, ...
- **Penutup dari mesin adalah checksum:** jumlah byte `55 AA` + data (u32). Cocok pada 90
  dari 92 balasan; tidak cocok hanya pada halaman 2–3 dari `E2`. SDK mengabaikannya, jadi
  pemeriksaannya opsional. Host cukup mengirim `00 00` [UJI].
- **Data besar** dikirim per halaman ≤ 1024 byte. Baca pertama: `p2 = jumlah`.
  Berikutnya: `p2 = halaman << 16`.
- **Nilai tunggal** (jumlah, info) dikembalikan di field `status`.

### 4.2 Handshake dan password

1. `0x80`: `p1` = **password komunikasi**, u32 mentah tanpa enkripsi [KODE].
   - Mesin ini belum punya password, jadi `p1=0` diterima dan `p1=1234` ditolak [UJI].
   - `p2 = 0xFFFF0000 | nonce acak` diterima [UJI]. Kode tidak memvalidasinya [KODE].
   - License 1261 **tidak dikirim** lewat jaringan; SDK hanya memeriksanya di sisi PC [KODE].
2. `0x13` p1=0 len=0x30: blok info biner, berisi versi, license, dan kapasitas [UJI].
3. `0x13` p1=1 len=0x400: string kemampuan, yang menentukan kelas protokol [UJI].
4. `0x13` p1=0 len=0x30: diulang [UJI].

### 4.3 Daftar perintah

| Fungsi | cmd | p1 | p2 | len | Status |
|---|---|---|---|---|---|
| Status (jumlah) | `B4` | indeks (tabel di bagian 3) | `FFFF0000` | 0 | [UJI] |
| Info / setting | `B0` | indeks (2 = nomor mesin, 0x28 = port; LAN kabel: 0x20 = IP, 0x30 = subnet, 0x34 = gateway, 0x2a–0x2f = MAC) | 0 | 0 | [UJI] |
| Data produk | `C3` | 0x100 | 0 | 256 | [UJI] |
| Baca jam | `B2` | 0 | 0 | 8 | [UJI] |
| **Set jam** | `B3` | 0 | 0 | 8 (kirim) | [UJI] |
| **Kunci / buka keypad** | `81` | 0 = kunci, 1 = buka | 0 | 0 | [UJI] |
| Baca **semua** log | `A4` | 0 | jumlah → hal<<16 | ≤1024 | [UJI] |
| Baca log **baru** | `A1` | 0 | jumlah → hal<<16 | ≤1024 | [KODE], sengaja tidak diuji (cukup `A4`) |
| Tandai log sudah dibaca | `A2` | 2 | 0 | 0 | [KODE] ⚠ lihat 7.3 |
| Jadwal bel | `C5` | 0 | 0 | 72 (24 × aktif/jam/menit) | [UJI] semua kosong |
| Jabatan & shift | `E2` | 0 | 0 → hal<<16 | 2.476 | [UJI] lihat 4.4 |
| Blok setting mesin | `0B` | 0 | 0 | 120 | [UJI] sumber `B0` indeks 0x0c–0x5d; tidak ada jam masuk/pulang |
| Zona waktu akses | `EC` | 0 | indeks | 32 | ditolak (status 16), tidak didukung |
| Hapus semua log | `C1` | 0 | 0 | 0 | [KODE] ⛔ DESTRUKTIF |
| Hapus semua user/biometrik | `C1` | 1 | 0 | 0 | [KODE] ⛔ DESTRUKTIF |
| Daftar user | `97` | total byte | total → idx<<16 | ≤1024 | [UJI] |
| Baca nama/info user | `E8` | 0 (kirim 48 B: PIN) → 1 (baca 204 B) | selektor bulan* | 48 / 204 | [UJI] |
| **Tulis nama / buat user baru** | `E9` | **0x15** | selektor bulan* | 204 (kirim) | [UJI] |
| Tulis jabatan (PostId 1-16) | `E9` | **0x16** | selektor bulan* | 204 (kirim) | [UJI] |
| Tulis jadwal shift bulan itu | `E9` | **0x17** | selektor bulan* | 204 (kirim) | [UJI] |
| **Hapus satu user** (semua data) | `93` | 1 | **12** | 48 (kirim: PIN) | [UJI] |
| Aktifkan / nonaktifkan user | `94` / `95` | 1 | 0 | 48 (kirim: PIN) | [UJI] |
| Ubah hak akses | `96` | 1 | 0 = user, 1 = manager | 48 (kirim: PIN) | [UJI] |

\* `p2` untuk `E8`/`E9` = selektor (tahun, bulan) dari blok 204 byte:
`((tahun + 0x30) << 9 | bulan << 5 | 0x14) & 0xFFFF`, jadi 2026-09 = `0x3534` [UJI].
`E8` dengan selektor Oktober mengembalikan kalender Oktober.
Nilai ini diterima untuk `E8` dan `E9` [UJI].

**Hasil uji tulis user (PIN 99999):**
- `E9` 0x15 untuk PIN baru langsung membuat user: aktif, hak akses user, nama terbaca kembali.
  Tapi user itu tanpa jabatan (PostId 0) dan tanpa shift.
- `bun fk.ts add` meniru SDK `SetUserInfoEx`: 0x15 (nama), lalu 0x16 (jabatan) dan 0x17
  (jadwal bulan ini) dengan blok bawaan mesin (PostId 1, shift 1 Senin–Jumat). Hasilnya
  byte-identik dengan user buatan mesin, **termasuk bulan-bulan berikutnya**: mesin mengisi
  sendiri jadwal bulan lain dari jabatannya.
- `93` p2=0–11 ditolak dengan status 4 kalau kredensial itu tidak ada. p2=12 menghapus
  user seluruhnya. Pada enum SDK FK, 12 adalah `BACKUP_FACE`, tapi mesin ini
  memperlakukannya sebagai "hapus semua".
- Tulis user tidak perlu mengunci keypad (`81`) lebih dulu.

**Format jam 8 byte:**

```
[0..1] tahun (u16) | [2] bulan | [3] tanggal | [4] hari (Minggu = 0, Senin = 1) | [5] jam | [6] menit | [7] detik
contoh: ea07 09 1c 01 15 22 2c = 2026-09-28 (Senin) 21:34:44
```

**Membuat dan mengubah user dengan aman:**
- Aman: baca blok 204 byte (`E8`), ubah bagian nama saja, lalu tulis kembali (`E9`).
- Membuat user baru: cukup `E9` p1=0x15 berisi PIN dan nama (sisa blok nol).
  Tidak ada checksum.
- Sidik jari/wajah tetap didaftarkan langsung di mesin.

### 4.4 Susunan record [UJI, kecuali ditandai]

**Log absensi, 48 byte:**

```
[0..31]   PIN, ASCII diakhiri NUL
[32..34]  selalu 01 00 00 (tidak dipakai)
[35]      detik
[36..39]  u32: bit 2-11 = tahun - 1900, bit 12-15 = bulan, bit 16-20 = tanggal,
          bit 21-25 = jam, bit 26-31 = menit
[40..42]  mode pintu
[43]      aksi: 1 = masuk, 2 = pulang
[44..47]  kode verifikasi: tiap nibble dari byte [47] ke [44] = satu jenis
          (1 = sidik jari, 2 = password, 3 = kartu, 4 = wajah), berhenti di nibble 0.
          0x10 = sidik jari, 0x40 = wajah [KODE: SDK GetStringVerifyMode, LOG_FACEVERIFY = 20]
```

1024 bukan kelipatan 48, jadi gabungkan semua halaman dulu, baru terjemahkan.

**Daftar user, 36 byte:**

```
[0..23]  PIN, ASCII diakhiri NUL
[32]     1 = manager (PIN 5 dan 6; cocok dengan jumlah manager = 2)
[33]     1 = aktif
[34]     data terdaftar: bit 0 = password, 0x0c = sidik jari + wajah, 00 = belum ada [UJI: cocok dengan status 4 dan 10]
[35]     0
```

**Blok info user, 204 byte:**

```
Sama dengan struct SDK USER_INFO_STRING_ID_13_1 tanpa header 8 byte:
[0..31]    UserId: PIN, ASCII
[32..35]   Reserved
[36..163]  UserName: nama UTF-16LE (buffer 128 byte, mesin menyimpan 15 karakter)
[164..167] PostId: jabatan/bagian untuk fitur shift bawaan mesin. 1 pada semua user
           buatan mesin (termasuk PIN 1, 2, 11 yang belum punya jari/wajah), 0 pada user
           buatan E9 0x15. BUKAN flag aktif; flag aktif hanya di daftar user [33] [UJI].
[168..169] YearAssigned  ┐ bulan yang dipilih lewat p2 (selektor bulan) [UJI]
[170..171] MonthAssigned │
[172]      StartWeekdayOfMonth: hari tanggal 1 (Minggu = 0) [UJI]
[173..203] ShiftId[31]: nomor shift per tanggal, 0 = tanpa shift/libur
           (saat ini shift 1 pada Senin-Jumat) [UJI]
```

**Jabatan dan shift bawaan mesin (`E2`, baca 2.476 byte = struct POST_SHIFT_INFO)** [UJI baca]:
- **24 slot shift** (jam pagi/siang/lembur). Terisi di mesin ini:
  - shift 1: 10:00–12:00, 12:00–18:00, 18:00–10:00;
  - shift 2: 08:00–12:00.
- **16 nama jabatan** dan **nama perusahaan**: semuanya kosong.
- **Fungsinya hanya untuk laporan bawaan mesin.** Aplikasi menghitung kehadiran dari
  log mentah, jadi fitur ini tidak dipakai. Tulisnya (`FK_SetPostShiftInfo`) tidak diuji.

## 5. Apa yang masih kurang

### 5.1 Perlu uji tulis terkontrol ke mesin (butuh izin)

Format semuanya sudah ada di kode. Tinggal dibuktikan di mesin:

| No | Uji | Risiko |
|---|---|---|
| 1 | ~~Set jam `B3` (koreksi +20 detik)~~ | **Selesai (revisi 5)** |
| 2 | ~~Kunci lalu buka keypad `81`~~ | **Selesai (revisi 5)** |
| 3 | ~~Buat, ganti nama, lalu hapus user tes PIN 99999~~ | **Selesai (revisi 5)** |
| 4 | ~~Aktif/nonaktif dan hak akses pada user tes~~ | **Selesai (revisi 5)** |
| 5 | Password komunikasi: setelah diaktifkan di menu mesin, cek `0x80` dengan `p1` = password (password salah sudah terbukti ditolak) | Rendah |
| 6 | User buatan script sudah identik dengan user buatan mesin (`E9` 0x16/0x17, revisi 5). Sisa uji fisik: daftarkan sidik jari ke user buatan script, lalu coba absen. | Rendah; pakai PIN tes |

### 5.2 Perlu pengecekan fisik atau info dari lapangan

6. ~~Arti kode verifikasi 0x40~~: wajah, dari kode SDK. Dari 1.688 log, 1.230
   memakai sidik jari dan 458 memakai wajah. Bisa dipastikan lagi dengan satu absen wajah.
7. **Arti aksi 1/2.** Data 1.688 log menunjukkan status **diganti otomatis oleh jam**:
   - tidak ada "masuk" sebelum 09:01; semua absen 00:00–08:57 tercatat "pulang";
   - tidak ada "pulang" antara 08:57 dan 15:40.

   "Masuk" setelah jam 15 hampir semuanya dari satu PIN (28 kali), kemungkinan tombol
   yang ditekan manual. Setting jam pergantian ini **tidak ada** di perintah SDK yang
   bisa dibaca (`E2`, `C5`, `0B`, `EC` sudah dicek), jadi kemungkinan menu di mesin
   ("auto shift" / status otomatis). Perlu foto menu.

   **Untuk aplikasi:** jangan bergantung pada status mesin. Hitung masuk/pulang di
   server dari jam dan urutan absen.
8. ~~**Menu mesin.** Apakah ada setting password komunikasi dan mode push/server?~~
   **Terjawab (revisi 6):** menu Jaringan berisi Mode (Lokal/Internet), No Mesin,
   Ethernet, WLAN, No Port (5005), Password (0), Server IP, Server Port, dan Server Req.
   Lihat bagian 10.1.
9. ~~**Software lain.**~~ **Terjawab (revisi 6):** cloud fingerspot.io tidak dipakai
   lagi. Mesin sekarang mengirim ke `server.ts`.

### 5.3 Batasan mesin (bukan kekurangan riset, tapi harus diakali di aplikasi)

10. Nama di mesin maksimal 15 karakter, jadi aplikasi menyimpan nama lengkap sendiri.
11. ~~Tidak ada push lewat port 5005.~~ **Revisi 6:** push realtime ada lewat FkWeb
    (mode Internet). Log masuk ke server saat orang absen (bagian 10).
12. Versi firmware tidak bisa dibaca (`0x79` ditolak).
13. Transfer template sidik jari/wajah antar mesin belum dipetakan. Baru perlu
    kalau nanti ada lebih dari satu mesin.
14. **Terjawab (revisi 6): daftar jari/wajah jarak jauh berhasil tanpa menu manager.**
    Perintahnya FkWeb
    `SET_COMMAND {"cmd":"enter_enroll","param":{"user_id":"2","backup_number":0}}`.
    Nama ini disadap dari `reg_online` developer.fingerspot.io, lalu dikirim langsung
    dari Mac. PIN 2 terdaftar pada 29-09-2026 pukul 13:15. Catatan di bawah
    ini adalah riwayat pencarian sebelum terjawab.
    **Sidik jari dan wajah hanya bisa direkam oleh sensor mesin.** Jalur lokal (TCP 5005)
    tidak punya perintah daftar jarak jauh. Fingerspot.io punya "Register Online" (mesin
    menampilkan layar daftar untuk satu PIN), tapi lewat cloud. Sementara ini: buat user
    dengan `bun fk.ts add`, lalu manager mendaftarkan jari/wajah di menu mesin.
    **Jalur alternatif (29-09-2026, belum diuji):** rekam jari di **scanner USB**, lalu
    unggah templatenya ke mesin. Petunjuknya dari `FpDataConv.dll` (keluarga FK, ada di
    repo [vt-SmartPark](https://github.com/vt-jack/vt-SmartPark)), yang sudah didekompilasi:
    - Versi template = **byte pertama**. Mesin ini `FpDataVer 128` = `0x80`, jadi
      template **612 byte** (`0x264`).
    - Ukuran per versi: `0x40–41` = 1224, `0x60–61` = 560, `0x62` = 1232,
      `0x70–72` = 492, `0x80–82` = 612, `0x85–87` = 1388, `0x89` = 912,
      `0x30`/`0x56` = 400, `0x0C` = 768.
    - `FPCONV_ISOToPEFIS(iso, isoLen, out, &outLen)` mengubah **ISO/IEC 19794-2:2005**
      (magic `FMR\0`, panjang harus sama dengan `isoLen`) menjadi versi `0x89`.
    - `FPCONV_Convert(src, buf, dst, out)` tidak punya jalur langsung `0x89` → `0x80`.
      Rantainya: ISO → `0x89` → `0x85` → `0x80`.
    - Scanner USB keluarga ini, `Ast2600N.dll` (API `pis*`), membuat template `0x85`
      dari 3 kali tempel jari. Hasilnya dikonversi ke versi mesin (`0x85` → `0x80` ada).
    - Scanner lain juga bisa, asal SDK-nya bisa menghasilkan ISO 19794-2:2005
      (SecuGen, DigitalPersona, SourceAFIS dari gambar jari). Akurasi lintas vendor
      belum diketahui.
    - DLL-nya Windows x86 32-bit. Pilihannya: jalankan di Windows atau Wine, atau port
      fungsinya ke TypeScript.
    - Unggah ke mesin memakai `F1`/`F5`–`F8` (PutEnrollData), yang belum dipetakan
      (lihat no. 13).
    **Perintah langsung ke mesin, tanpa scanner (29-09-2026):** server cloud fingerspot.io
    adalah `fdevice.com:8013` (`3.1.174.198`). Isinya HTTP (Sails.js) yang menjawab
    dengan header `response_code`, `trans_id`, `cmd_code` [UJI, lewat `curl`]. Jadi
    mesin bicara ke cloud dengan **protokol FkWeb push** (mesin polling `receive_cmd`,
    server membalas `cmd_code`). "Register Online" hanyalah **satu `cmd_code`** di
    protokol itu, dan bisa dikirim server lokal kalau namanya diketahui.
    - Nama dan parameter `cmd_code`-nya **tidak ada** di katalog FkWeb publik mana pun:
      FKWebTrans, ebkn, Pryce, F80, InjesApp.
    - Cara mendapatkannya: arahkan server cloud mesin ke Mac, Mac meneruskan (relay +
      log) ke `fdevice.com:8013`, lalu jalankan Register Online dari akun fingerspot.io.
      Alternatifnya membaca string firmware lewat telnet 23 (port terbuka), tapi itu
      butuh login.
    - Hasil pencarian GitHub, forum dan web (29-09-2026): nama `cmd_code`-nya **tidak ada
      di sumber publik**. Yang sudah diperiksa: manual OEM "BS SDK" (Hysoon/浩顺, 2019),
      demo FkWeb resmi Des 2024, dan installer Fingerspot.io Desktop.
      - API resmi [`reg_online`](https://developer.fingerspot.io/docs/api/register-online):
        `{"trans_id","cloud_id","pin","verification"}` (semua string). Nilai `verification`:
        0–9 = jari (0 = telunjuk), 12 = wajah, 13 = vein. Webhook
        `{"type":"register_online",…,"data":{"status":"1"}}` (1 = sukses, 2 = gagal).
        WF-206BNC tercantum sebagai model yang didukung.
      - Nilai `verification` sama persis dengan `backup_number` FK (`FKWebDB.cs`: 0–9 jari,
        10 password, 11 kartu, 12 wajah, 13 vein). Jadi `cmd_param` di sisi mesin
        kemungkinan `{"user_id":"<pin>","backup_number":N}` [DUGA].
      - Tebakan nama perintah (belum ada sumber): `ENROLL_USER`, `START_ENROLL`,
        `REMOTE_ENROLL`, `REGISTER_ONLINE`/`REG_ONLINE`, `ONLINE_ENROLL`.
      - Firmware Fingerspot lain (Vega, R6) menjawab perintah yang tidak dikenal dengan
        `cmd_return_code` `NOT SUPPORT CMD`, dan menjawab `BUSY` saat menu mesin terbuka.
        Kalau CIF13_1 juga begitu, setiap tebakan bisa diuji ya/tidak. Yang tidak boleh
        ikut ditebak: `CLEAR_*`, `DELETE_*`, `RESET_FK`, `SET_WEB_SERVER_INFO`,
        `UPDATE_FIRMWARE`.
    - Kanal `FC` (JSON): baca `p1=1` setelah status 16 hanya mengembalikan 16 byte
      pertama yang kita kirim (echo), baik untuk `cs_serverinfo_get` maupun nama palsu
      [UJI]. Belum ada bukti perintah JSON dieksekusi.

### 5.4 Kebutuhan aplikasi (perlu jawaban Anda)

14. **Aturan kerja:** jam masuk/pulang, shift (ada shift malam?), hari kerja,
    toleransi telat, istirahat, dan lembur.
15. **Hari libur dan jenis izin:** cuti, sakit, izin, dinas luar.
16. **Data karyawan:** nama lengkap, departemen, jabatan. Saat ini ada 11 user di mesin.
17. **Laporan:** harian, rekap bulanan, rekap untuk payroll; Excel atau PDF.
18. **Pengguna aplikasi:** admin saja atau juga karyawan? Diakses dari komputer lain di kantor?
19. **Jumlah mesin:** hanya satu, atau nanti ada mesin/cabang lain?
20. **Data lama:** 1.688 log sejak Maret 2026 bisa langsung diimpor.

### 5.5 Operasional

21. ~~Mac tidak boleh tidur; aplikasi berjalan otomatis saat Mac menyala (launchd).~~
    **Selesai (revisi 6):**
    - `absensi.plist` dipasang sebagai `~/Library/LaunchAgents/com.example.absensi.plist`,
      dengan `KeepAlive` dan `caffeinate -is`.
    - Server jalan saat **login**. Tanpa login, server tidak jalan; untuk itu perlu
      LaunchDaemon dan sudo.
    - Menutup lid laptop tetap membuat Mac tidur.
22. Backup database berkala. Belum dibuat. `absensi.db` sekarang berisi log **dan
    template biometrik** (tabel `users`).
23. Keamanan jaringan: password komunikasi, VLAN, dan telnet (bagian 7).

## 6. Pilihan akses dan rekomendasi

| Opsi | Lokal? | Ubah mesin? | Realtime? | Status |
|---|---|---|---|---|
| **A. TCP 5005 langsung (FK CIF13_1)** | ✓ | Tidak | Hampir (polling) | **Semua baca terverifikasi; tulis dari kode** |
| **B. FkWeb push (HTTP) ke server lokal** | ✓ | Ya (menu Jaringan) | Ya | **Dipakai sejak revisi 6 (`server.ts`)** |
| C. SDK resmi (FKAttend / EasyLink) | ✓ | Tidak | – | Hanya Windows |
| D. Cloud fingerspot.io | ✗ | – | – | Tidak sesuai kebutuhan |

**Revisi 6: opsi B dipakai.** Alasannya:
- log realtime tanpa polling;
- daftar jari/wajah jarak jauh dan semua fitur developer.fingerspot.io hanya ada di FkWeb.

Opsi A tetap berguna untuk hal yang tidak ada di FkWeb, misalnya kunci keypad dan jadwal
shift. Syaratnya mesin dipindah ke mode Lokal.

Rekomendasi lama (revisi 5): opsi A. Server Python di Mac ini:
- cek jumlah log tiap 15–60 detik;
- tarik semua log (`A4`) bila bertambah, buang duplikat di SQLite;
- tarik user dan nama;
- sinkronkan jam secara berkala.

Mode push (opsi B) tergantung varian firmware dan perlu dicoba di menu mesin:
- HTTP `realtime_glog` (BS / RealSvr);
- JSON di TCP 5005 (FkWeb);
- XML (SbLogServer, mode "TCP active").

## 7. Risiko dan keamanan

1. **Port 5005 tanpa password.** Siapa pun di LAN bisa membaca log, dan juga bisa
   menghapus log atau user (`C1`, `93`). Saran:
   - aktifkan password komunikasi di mesin;
   - pisahkan mesin ke VLAN/SSID khusus.
2. **Telnet terbuka** dengan login root Buildroot. Isolasi jaringan.
3. **Hati-hati dengan "tandai log sudah dibaca" (`A2`).** Penanda ini dipakai bersama
   oleh semua software yang membaca mesin. **Aman: baca semua (`A4`) dan buang
   duplikat di server.**
4. **Perintah destruktif** (`C1`, `93`) jangan dipakai tanpa backup dan konfirmasi.
5. **WiFi lemah dan IP mesin.** Pakai kabel LAN atau perkuat WiFi, dan reservasi
   DHCP untuk `192.168.1.201`.
6. **Jam mesin** adalah sumber waktu log. Sudah disinkronkan pada 28-09-2026, dan perlu
   disinkronkan berkala dengan `bun fk.ts jam --sinkron`. **Revisi 6:**
   - Jam kembali ke **01-01-2015** setiap listrik mati. Restart lewat `RESET_FK` tidak.
   - `server.ts` mengirim `SET_TIME` otomatis bila selisih lebih dari 2 menit.
7. **FkWeb tanpa TLS dan tanpa autentikasi mesin (revisi 6).** Siapa pun di LAN bisa
   mengirim log palsu ke port 8013. `dev_id` tidak rahasia, jadi `FKWEB_DEVICES` hanya
   penyaring ringan. API `/api/*` dilindungi token Bearer di `.env` (mode 600).
8. **Data biometrik di Mac (revisi 6).** Template jari/wajah, password, dan foto
   tersimpan di `absensi.db`. Server jalan dengan umask 077, jadi file hanya bisa dibaca
   akun ini. Backup database harus diperlakukan sama rahasianya.

## 8. Catatan server (Mac ini)

- **IP dari DHCP** (`192.168.1.10`), lewat WiFi. Pada opsi A, Mac yang menghubungi
  mesin, jadi hanya IP mesin yang wajib tetap.
- **Mac adalah laptop.** Saat tidur, penarikan data berhenti. Log tetap aman di
  mesin dan otomatis tersusul saat Mac aktif lagi.
- **Revisi 6: mesin yang menghubungi Mac** (Server IP `192.168.1.10`, port 8013).
  **IP Mac wajib direservasi di router.** Kalau IP berubah, mesin tidak punya tujuan kirim.
  - Log tetap tersimpan di mesin dan terkirim ulang setelah tersambung. Pada 29-09-2026
    mesin mengirim seluruh antrean lamanya saat pertama kali tersambung.
  - Launchd pertama kali memunculkan dialog izin macOS, karena `bun` membaca folder
    Documents. Izin sudah diberikan (Privacy & Security → Files and Folders).

## 9. Script dan uji otomatis (Bun)

Spesifikasi untuk bahasa lain: `protokol.md` (test vector di bagian 12).

```bash
bun fk.ts log > absensi.csv       # tarik semua log (baca saja)
bun fk.ts jam [--sinkron]         # cek / samakan jam mesin
bun fk.ts list | add | edit | delete
bun test                          # uji offline (bingkai, parser, jam)
FK_LIVE=baca  bun test fk.mesin   # uji semua temuan baca ke mesin, aman kapan saja
FK_LIVE=tulis bun test fk.mesin   # + siklus user tes PIN 99999, keypad, sinkron jam
```

Revisi 6 (FkWeb, mesin mode Internet):

```bash
bun server.ts                     # server sendiri; biasanya lewat launchd (absensi.plist)
bun test server.test.ts           # 8 uji: codec FkWeb + mesin disimulasikan dengan format hasil sadapan
```

Jam mesin adalah jam dinding **WIB**. `fk.ts` memakai offset UTC+7 secara eksplisit
(`FK_UTC_OFFSET`), karena `bun test`, launchd, atau Docker bisa berjalan dengan zona UTC.
Tanpa offset eksplisit, sinkron jam akan menggeser jam mesin 7 jam. Bug ini tertangkap
oleh uji baca.

## 10. Revisi 6: FkWeb push dan server sendiri (29-09-2026)

Spesifikasi protokol FkWeb ada di `protokol.md` bagian 14. Panduan operasional ada di
`operasional.md`.

### 10.1 Menu Jaringan mesin [FISIK, UJI]

| Menu | Nilai sekarang | Arti |
|---|---|---|
| Mode | **Internet** | Internet = kirim FkWeb (HTTP) ke Server IP:Port. Lokal = hanya TCP 5005, tanpa kirim apa pun. |
| No Mesin | 1 | Nomor mesin (DN) |
| Ethernet | Tidak | LAN kabel mati; memakai WiFi |
| WLAN | 192.168.1.201 | IP WiFi (DHCP) |
| No Port | 5005 | Port SDK (hanya menjawab di mode Lokal) |
| Password | 0 | Password komunikasi |
| Server IP | **192.168.1.10** | Tujuan FkWeb (Mac) |
| Server Port | **8013** | Tersimpan di `B0` indeks `0x3c` [UJI]. `0x38` **bukan** Server IP. |
| Server Req | Ya | Belum pasti artinya; mirip "Real Time Req" di seri Vega [DUGA] |

- **Lokal ↔ Internet saling menggantikan.** Selama mode Internet, port 5005 menerima
  koneksi TCP tapi tidak menjawab handshake `0x80`.
- Selama menu mesin terbuka, mesin tidak berkomunikasi sama sekali.

### 10.2 Server cloud Fingerspot [UJI]

| Layanan | Server mesin | Catatan |
|---|---|---|
| fingerspot.io, tipe "ZK" | `fdevice.com:8013` | Hasil cek perangkat untuk mesin ini |
| fingerspot.io, panduan Revo | `fdevice.com:8014` | Halaman `fingerspot.io/device` |
| **developer.fingerspot.io (SDK Online)** | **`fdevice.com:9004`** | Tertulis di portal: Mesin Absensi → Detail |

- Ketiganya server Sails.js yang berbicara FkWeb. `fdevice.com` = `3.1.174.198`.
- Cloud ID = `dev_id` = `C2610000000000AB`.
- Platform developer tidak melihat mesin yang terhubung ke port 8013/8014
  (`get_device` menjawab `last_activity: N/A`), sehingga perintah API-nya hanya tertunda.

### 10.3 Cara menyadap [UJI]

1. Mesin diarahkan ke `192.168.1.10:8013`, tempat alat relay `fkweb.ts` meneruskan semua
   request ke `fdevice.com:9004`.
2. Setiap endpoint developer.fingerspot.io dipanggil satu kali dengan token akun developer.
3. Relay mencatat perintah yang dikirim cloud ke mesin beserta jawabannya
   (`fkweb.log`, body mentah base64).
4. Tulis hanya dilakukan ke user uji PIN 99999, yang selalu dihapus lagi.
5. Setelah riset selesai, `fkweb.ts` dan `fkweb.log` dihapus, karena log itu berisi
   template biometrik mentah. `server.ts` menggantikan alat relay itu, dan hasilnya
   tercatat di bagian ini.

### 10.4 Peta API developer.fingerspot.io → FkWeb [UJI]

| API | `cmd_code` | `cmd_param` | Jawaban mesin |
|---|---|---|---|
| `get_all_pin` | `GET_USER_ID_LIST` | – | `{"one_user_id_size":36,"user_id_array":"BIN_1","user_id_count":N}` + record 36 byte (sama dengan `97`) |
| `get_userinfo` | `GET_USER_INFO` | `{"user_id"}` | `{"enable_flag","enroll_data_array":[{"backup_number","enroll_data":"BIN_n"}],"user_id","user_name","user_privilege"}` + biner |
| `set_userinfo` | `SET_USER_INFO` | JSON seperti di atas + biner | `OK`. Mengganti seluruh data user. |
| `delete_userinfo` | `DELETE_USER` | `{"user_id"}` | `OK` |
| `reg_online` | `SET_COMMAND` | `{"cmd":"enter_enroll","param":{"user_id","backup_number"}}` | `OK` langsung. Layar daftar muncul; hasil daftar datang sebagai `realtime_enroll_data`. |
| `set_time` (zona) | `SET_TIME` | `{"time":"YYYYMMDDhhmmss"}` | `OK`. Zona tidak disimpan di mesin, hanya jamnya. |
| `restart_device` | `RESET_FK` | – | Tidak ada jawaban; mesin langsung restart |
| `get_attlog`, `get_device`, webhook attlog | – | – | Dilayani dari database cloud, yang diisi `realtime_glog` |
| (di luar API) | `GET_LOG_DATA` | – | `{"log_count","one_log_size":48}` + semua log, record 48 byte seperti `A4` |

Password = `backup_number` 10 dengan biner ASCII tanpa NUL. Hak akses API
`1`/`2`/`3` = FkWeb `USER`/`MANAGER`/`OPERATOR`. `OPERATOR` diterima dan disimpan mesin.

### 10.5 Perilaku mesin yang teramati [UJI]

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

### 10.6 Server sendiri (`server.ts`) [UJI]

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

## Sumber

**Bukti dan protokol:**
- SDK FK (`FK623Attend.dll`, `FKAttend.dll`, `FKViaDev.dll`, `FKModelDic.ini`) dari
  [biomax_security](https://github.com/Yaswanth-Vempuluru-7916/biomax_security),
  [NovinPardaz_Device_Connector](https://github.com/AliRezaKhazaeiNezhad/NovinPardaz_Device_Connector),
  dan [UTAS](https://github.com/TahaImran1/UTAS)
- [Ab0umar/selrs.cc – catatan FK DLL (port 5005, license 1261)](https://github.com/Ab0umar/selrs.cc)
- [Realand – unduh SDK (Face CS = SmackBio SBXPC, Model 2960)](https://realandtec.com/download/sdk-download_c0005)
- SBXPC OCX Reference Manual v3.12 (SmackBio), di dalam paket SDK Realand
- [tsunosora/Rate-My-Staff – klien TCP 5005 untuk Revo W-230N](https://github.com/tsunosora/Rate-My-Staff/blob/main/lib/services/fingerspot/device.ts)
- [tsunosora/Rate-My-Staff – dokumentasi integrasi](https://github.com/tsunosora/Rate-My-Staff/blob/main/docs/fingerspot-integration.md)
- [hoangh-e/ZDC2911_Demo – SDK Realand ZDC2911 (pembanding, tidak cocok)](https://github.com/hoangh-e/ZDC2911_Demo)
- [imodoiepale/citywalk-attendance – varian FkWeb](https://github.com/imodoiepale/citywalk-attendance)
- [Realand – info perusahaan](https://www.realandtec.com/info/4.html)
- IEEE OUI `F0-C8-14` → Shenzhen Bilian (LB-LINK)
- [vt-jack/vt-SmartPark: `FpDataConv.dll`, `Ast2600N.dll`, contoh enroll lewat scanner USB dan konversi versi](https://github.com/vt-jack/vt-SmartPark/blob/master/vt-door/src/main/java/com/snk/door/api/finger/yz/FingerReaderYzService.java)
- [GhazanfarKhan/InjesApp: FkWeb `ConvertFpDataForDestFK` (FPCONV saat `SET_ENROLL_DATA`)](https://github.com/GhazanfarKhan/InjesApp/blob/master/fkwebserver_src/App_Code/FKWebCmdTrans.cs)
- [SourceAFIS FingerprintCompatibility (ekspor ISO 19794-2)](https://sourceafis.machinezoo.com/javadoc/com/machinezoo/sourceafis/FingerprintCompatibility.html)

**Mode push dan lain-lain:**
- [PangeranSilaen/fingerspot-simulator](https://github.com/PangeranSilaen/fingerspot-simulator)
- [andreracodex/fingerspot](https://github.com/andreracodex/fingerspot)
- [La-DevHouse/biometric-server](https://github.com/La-DevHouse/biometric-server)
- [Fingerspot Revo WF-206BNC](https://fingerspot.com/product/mesin-absensi-sidik-jari-wajah-revo-wf-206bnc) ·
  [EasyLink SDK](https://fingerspot.com/product/12482-fingerprint-sdk-easylink) ·
  [developer.fingerspot.io](https://developer.fingerspot.io/)
