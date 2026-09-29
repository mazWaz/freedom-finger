# Spesifikasi Protokol TCP 5005: Fingerspot Revo WF-206BNC (FK "CIF13_1")

Dokumen ini netral bahasa pemrograman. Semua format ditulis sebagai tabel byte, contoh
hex asli dari mesin, dan pseudocode. Implementasi bisa ditulis di bahasa apa pun (Python,
Go, PHP, Java, C#, JavaScript, dan lain-lain). Implementasi referensi ada di crate Rust
`freedom-finger-sdk` (`crates/freedom-finger-sdk`); bagian 13 memetakan isi dokumen ke modulnya. Latar
belakang riset ada di `riset.md`.

| | |
|---|---|
| Versi dokumen | 1.2, 29 September 2026 (implementasi referensi pindah ke SDK Rust; 1.1: tambah bagian 14, FkWeb) |
| Mesin | Fingerspot Revo WF-206BNC, serial `Fio00000000000000`, produksi 17-01-2022 |
| Platform | SmackBio keluarga FK, kelas SDK `CFKAttend_CIF13_1` |
| Alamat | `192.168.1.201`, TCP `5005`, WiFi dengan DHCP |
| Sumber | Dekompilasi `FKAttend.dll` / `FKViaDev.dll`, sampel SDK FK, dan uji langsung ke mesin |

**Tanda status** (dipakai di seluruh dokumen):

| Tanda | Arti |
|---|---|
| **[UJI]** | Sudah dicoba ke mesin ini dan hasilnya sesuai |
| **[UJI-TOLAK]** | Sudah dicoba; mesin menolak atau tidak mendukung |
| **[KODE]** | Terbaca dari kode SDK, belum dicoba ke mesin |
| **[DUGA]** | Kesimpulan dari data, belum pasti |
| **[FISIK]** | Hanya bisa dipastikan di lokasi (menu mesin atau absen sungguhan) |
| **⛔** | Destruktif. Jangan dipakai tanpa backup dan konfirmasi |

---

## Daftar isi

1. [Transport](#1-transport)
2. [Format bingkai](#2-format-bingkai)
3. [Kode hasil dan error](#3-kode-hasil-dan-error)
4. [Membuka sesi (handshake)](#4-membuka-sesi-handshake)
5. [Ringkasan perintah](#5-ringkasan-perintah)
6. [Detail perintah dan contoh response](#6-detail-perintah-dan-contoh-response)
7. [Struktur data](#7-struktur-data)
8. [Algoritma (pseudocode)](#8-algoritma-pseudocode)
9. [Resep operasi](#9-resep-operasi)
10. [Perilaku mesin dan jebakan](#10-perilaku-mesin-dan-jebakan)
11. [Status uji lengkap](#11-status-uji-lengkap)
12. [Test vector](#12-test-vector)
13. [Implementasi referensi dan uji otomatis](#13-implementasi-referensi-dan-uji-otomatis)
14. [Protokol FkWeb (HTTP push, mode Internet)](#14-protokol-fkweb-http-push-mode-internet)
15. [Sumber](#15-sumber)

---

## 1. Transport

| Hal | Nilai | Status |
|---|---|---|
| Protokol | TCP biasa, tanpa TLS, tanpa login selain password komunikasi | [UJI] |
| Port | 5005 | [UJI] |
| Pola | Satu request, satu balasan. Kirim perintah berikutnya setelah balasan lengkap diterima. | [UJI] |
| Latensi | Ping 250–1.200 ms (WiFi lemah). Pakai timeout minimal 15 detik per perintah. | [UJI] |
| Push dari mesin | Tidak ada di port ini. Push ada di **mode Internet** lewat FkWeb (bagian 14). Selama mode Internet, port 5005 menerima koneksi tapi **tidak menjawab handshake**. | [UJI] |
| Koneksi ulang | Koneksi baru tepat setelah koneksi lain ditutup bisa ditolak sementara (`ECONNREFUSED`). Ulangi setelah 1–2 detik. | [UJI] |
| Koneksi paralel | Koneksi TCP kedua diterima tanpa memutus koneksi pertama. Dua sesi yang sama-sama aktif mengirim perintah belum diuji. Sebaiknya satu koneksi per proses. | [UJI] sebagian |
| Tutup koneksi | Selalu tutup socket, termasuk saat handshake gagal. Kalau tidak, proses bisa menggantung. | [UJI] |

Port lain: 23 (telnet, Linux Buildroot) terbuka. Port 21, 22, 80, 443, 4370, 7005, 8080,
8081, dan 8090 tertutup. UDP 5005/5500/5010 tidak dibalas. [UJI]

---

## 2. Format bingkai

Semua bilangan **little-endian** kecuali disebut lain.

### 2.1 Perintah (host → mesin), header 16 byte [UJI]

| Offset | Ukuran | Field | Isi |
|---|---|---|---|
| 0 | 2 | sync | `55 AA` |
| 2 | 1 | DN | nomor mesin, selalu `01` |
| 3 | 1 | cmd | kode perintah |
| 4 | 4 | p1 | parameter 1 (u32) |
| 8 | 4 | p2 | parameter 2 (u32). Saat paging: `halaman << 16` |
| 12 | 2 | len | **baca:** panjang data yang diminta. **Tulis:** panjang data yang dikirim. **Tanpa data:** 0 |
| 14 | 2 | seq | nomor urut per koneksi: 1, 2, 3, … (kembali ke 1 setelah 0xFFFF) |

### 2.2 Data dari host (hanya perintah tulis) [UJI]

Langsung setelah header:

```
55 AA | data (len byte) | 00 00
```

Dua byte terakhir cukup diisi `00 00`. Mesin tidak memeriksanya.

### 2.3 Ack (mesin → host), 10 byte [UJI]

| Offset | Ukuran | Field | Isi |
|---|---|---|---|
| 0 | 2 | sync | `AA 55` (kebalikan sync perintah) |
| 2 | 1 | — | `01` |
| 3 | 1 | result | `01` = OK, `00` = gagal (SDK juga menyebut `FD`, belum pernah terlihat) |
| 4 | 4 | status | u32. Hasil perintah tanpa data (jumlah, nilai setting) atau kode error |
| 8 | 2 | seq | sama dengan `seq` perintah. Pakai untuk mencocokkan balasan. |

### 2.4 Data dari mesin (perintah baca, hanya bila result = `01`) [UJI]

Langsung setelah ack:

```
55 AA | data (len byte) | checksum (u32)
```

- `checksum` = jumlah semua byte `55 AA` + data, sebagai u32 [UJI].
  - Cocok pada 90 dari 92 balasan yang diperiksa.
  - Tidak cocok hanya pada halaman ke-2 dan ke-3 dari `E2`; penyebabnya belum diketahui.
  - SDK resmi mengabaikan checksum ini, jadi pemeriksaannya **opsional**.
- Panjang total balasan: `10` (tanpa data) atau `10 + 2 + len + 4`.
- Kalau result = `00`, mesin hanya mengirim ack 10 byte, tanpa data.

### 2.5 Data besar: paging [UJI]

- Satu bingkai membawa paling banyak **1024 byte** data.
- Halaman ke-0 memakai `p2` awal khusus per perintah (lihat bagian 6). Halaman ke-k (k ≥ 1)
  memakai `p2 = k << 16`.
- `len` per halaman = `min(1024, sisa)`.
- Gabungkan semua halaman dulu, baru terjemahkan. Ukuran record (48 atau 36 byte) bukan
  pembagi 1024.
- Terbukti pada `A4` (80 halaman), `E2` (3 halaman), dan `97` (1 halaman).

### 2.6 Tipe data

| Tipe | Format |
|---|---|
| Bilangan | u8 / u16 / u32 little-endian |
| PIN | ASCII diakhiri NUL, sisa field diisi `00` |
| Nama | UTF-16LE diakhiri NUL |
| Waktu | Jam dinding WIB (UTC+7), tanpa info zona waktu (bagian 7.7) |

---

## 3. Kode hasil dan error

| result | status | Arti | Contoh yang terbukti |
|---|---|---|---|
| `01` | nilai | OK. Untuk perintah tanpa data, `status` adalah hasilnya. | `B4 8` → 1688 |
| `01` | `0` | OK (tulis atau baca data) | `E9`, `B3`, `A4` |
| `00` | `0` | Handshake ditolak: password salah | `80` dengan p1 = 1234 |
| `00` | `3` | Tidak ditemukan atau indeks tidak valid | `B4 12`; `B4 205`; baca `E8` untuk PIN yang tidak ada |
| `00` | `4` | Data atau kredensial tidak ada | `93` untuk backup number yang tidak terdaftar atau PIN yang tidak ada |
| `00` | `16` | Perintah tidak didukung mesin ini | `79`, `EC` |

Pemetaan kode error di SDK (`FUN_10031050`): `1` = memori penuh, `2` = data ganda,
`3` = parameter tidak valid, `6` = jumlah manager melebihi batas, `9` = versi data sidik
jari tidak cocok, kode lain = error tak dikenal. Kode `4` dan `16` tidak ada di pemetaan
SDK; artinya disimpulkan dari pengamatan.

---

## 4. Membuka sesi (handshake)

Urutan yang dipakai SDK resmi, dan terbukti bekerja [UJI]:

| Langkah | Perintah | Kirim (hex) | Balasan (hex) |
|---|---|---|---|
| 1 | `80` p1 = password, p2 = `FFFF0000 \| nonce` | `55aa0180 00000000 3412ffff 0000 0100` | `aa550101 00000000 0100` |
| 2 | `13` p1=0, len 48 | `55aa0113 00000000 00000000 3000 0200` | ack + `55aa` + 48 byte blok info + checksum |
| 3 | `13` p1=1, len 1024 | `55aa0113 01000000 00000000 0004 0300` | ack + `55aa` + 1024 byte JSON + checksum |
| 4 | `13` p1=0, len 48 (diulang) | `55aa0113 00000000 00000000 3000 0400` | sama dengan langkah 2 |

- **Password:** u32 mentah, tanpa enkripsi [KODE].
  - Mesin ini belum diberi password, jadi `p1 = 0` diterima [UJI].
  - `p1 = 1234` ditolak dengan ack `aa550100 00000000 0100` [UJI].
- **p2 (nonce):** bebas. Kode SDK tidak memeriksanya; `FFFF0000 | acak` diterima [UJI].
- **License 1261** tidak dikirim; SDK hanya membacanya dari blok info [KODE].
- **Wajib tidaknya langkah 2–4 belum diuji.** Jalankan saja semuanya seperti SDK.

---

## 5. Ringkasan perintah

`p2*` = paging (bagian 2.5). `sel` = selektor bulan (bagian 8.4). `PIN48` = 48 byte PIN (bagian 7.9).

| cmd | Fungsi | p1 | p2 | len | Data kirim | Balasan | Status |
|---|---|---|---|---|---|---|---|
| `80` | Handshake | password | `FFFF0000\|nonce` | 0 | – | ack | [UJI] |
| `13` | Blok info / JSON kemampuan | 0 / 1 | 0 | 48 / 1024 | – | data | [UJI] |
| `13` | p1 = 2, 3, 4 | 2–4 | 0 | 1024 | – | ack gagal | [UJI-TOLAK] |
| `C3` | Data produk | `0x100` | 0 | 256 | – | data | [UJI] |
| `79` | Versi firmware | 0 | 0 | 0 | – | gagal, kode 16 | [UJI-TOLAK] |
| `B4` | Status / jumlah | indeks | `FFFF0000` | 0 | – | status = nilai | [UJI] |
| `B0` | Baca setting | indeks | 0 | 0 | – | status = nilai | [UJI] |
| `B1` | Ubah setting | indeks | nilai | 0 | – | ack | [KODE] |
| `0B` | Blok setting 120 byte | 0 | 0 | 120 | – | data | [UJI] |
| `B2` | Baca jam | 0 | 0 | 8 | – | data 8 byte | [UJI] |
| `B3` | Set jam | 0 | 0 | 8 | jam 8 byte | ack | [UJI] |
| `81` | Kunci (0) / buka (1) keypad | 0/1 | 0 | 0 | – | ack | [UJI] |
| `A4` | Baca **semua** log | 0 | p2*: awal = jumlah log | ≤1024 | – | data | [UJI] |
| `A1` | Baca log **baru** | 0 | p2*: awal = jumlah baru | ≤1024 | – | data | [KODE] |
| `A2` | Tandai log sudah dibaca | 2 | 0 | 0 | – | ack | [KODE] ⚠ |
| `AE`+`AF` | Log per rentang tanggal | 0 | 0 | 12 / ? | rentang tanggal | status = jumlah | [KODE] |
| `A3` | Baca log admin | 0 | – | – | – | data | [KODE] |
| `C1` | Hapus semua log | 0 | 0 | 0 | – | ack | [KODE] ⛔ |
| `C1` | Hapus semua user dan biometrik | 1 | 0 | 0 | – | ack | [KODE] ⛔ |
| `97` | Daftar user | total byte | p2*: awal = total byte | ≤1024 | – | data | [UJI] |
| `E8` | Pilih user, lalu baca info user | 0, lalu 1 | sel | 48, lalu 204 | PIN48, lalu – | ack, lalu data | [UJI] |
| `E9` | Tulis nama (juga membuat user baru) | `0x15` | sel | 204 | blok user | ack | [UJI] |
| `E9` | Tulis jabatan (PostId 1–16) | `0x16` | sel | 204 | blok user | ack | [UJI] |
| `E9` | Tulis jadwal shift sebulan | `0x17` | sel | 204 | blok user | ack | [UJI] |
| `93` | Hapus satu user beserta semua datanya | 1 | 12 | 48 | PIN48 | ack | [UJI] |
| `93` | Hapus satu kredensial (0–11) | 1 | 0–11 | 48 | PIN48 | ack | [KODE] (baru terbukti menolak kredensial yang tidak ada) |
| `94` | Aktifkan user | 1 | 0 | 48 | PIN48 | ack | [UJI] |
| `95` | Nonaktifkan user | 1 | 0 | 48 | PIN48 | ack | [UJI] |
| `96` | Hak akses (0 = user, 1 = manager) | 1 | hak akses | 48 | PIN48 | ack | [UJI] |
| `98` | Tambah kredensial (template, password, kartu) | backup number | – | bervariasi | record | ack | [KODE] |
| `F1`, `F5`–`F8` | Transfer template jari/wajah | – | – | ≤1024 | – | – | [KODE] parsial |
| `E2` | Baca jabatan dan shift | 0 | p2*: awal = 0 | 2.476 | – | data | [UJI] |
| `E3` | Tulis jabatan dan shift | 0 | – | 2.476 | blok | ack | [KODE] |
| `C5` | Baca jadwal bel | 0 | 0 | 72 | – | data | [UJI] |
| `C6` | Tulis jadwal bel | 0 | 0 | 72 | blok | ack | [KODE] |
| `EC` | Zona waktu akses | indeks | 0 | 32 | – | gagal, kode 16 | [UJI-TOLAK] |
| `E0` / `E1` | Baca / ubah status pintu | – | – | 0 | – | ack | [KODE] |
| `FC` | Perintah JSON (`FK_HS_ExecJsonCmd`) | 0 kirim / 1 baca | 0 | panjang JSON + 1 | `{"cmd":…,"param":{…}}` + NUL | status = panjang jawaban (1–16 = kode error) | [UJI] jalur ada; perintah yang dicoba dijawab 16 |

---

## 6. Detail perintah dan contoh response

Setiap contoh berisi byte asli dari mesin ini. `TX` = dikirim host, `RX` = balasan mesin.
Bingkai dipisah per field agar mudah dibaca.

### 6.1 `13`: blok info dan JSON kemampuan [UJI]

```
TX  55aa 01 13 00000000 00000000 3000 0200
RX  aa55 01 01 00000000 0200 | 55aa |
    0401300000131000ed040000010100010100001210270000d0070000d0070000e8030000400d03000101000100000004
    | 85050000
```

Isi blok 48 byte: bagian 7.1.

```
TX  55aa 01 13 01000000 00000000 0004 0300
RX  aa55 01 01 00000000 0300 | 55aa | 1024 byte teks diakhiri NUL | f6420000
```

Teks JSON (persis seperti dikirim mesin, tanpa tanda kutip):

```
{CommunicationInterfaceId:13_1,CodePage:UTF-16,UDiskBackupFileFormatId:3,SupportSetupImages:OK,SetupInfoStructType:10,EnrollDataType:{fp,pwd,idcard,face},FpDataVer:128,FaceDataVer:528}
```

### 6.2 `C3`: data produk [UJI]

```
TX  55aa 01 c3 00010000 00000000 0001 0b00
RX  aa55 01 01 00000000 0b00 | 55aa | 256 byte (lihat 7.3) | f9170000
```

### 6.3 `B4`: status dan jumlah [UJI]

```
TX  55aa 01 b4 08000000 0000ffff 0000 0600        (indeks 8 = total log)
RX  aa55 01 01 98060000 0600                      (status 0x698 = 1688)

TX  55aa 01 b4 0c000000 0000ffff 0000 0700        (indeks 12, tidak valid)
RX  aa55 01 00 03000000 0700                      (gagal, kode 3)
```

Tabel indeks: bagian 7.4.

### 6.4 `B0`: baca setting [UJI]

```
TX  55aa 01 b0 28000000 00000000 0000 0800        (indeks 0x28 = port)
RX  aa55 01 01 8d130000 0800                      (status 0x138d = 5005)
```

Tabel indeks: bagian 7.5. Semua nilai `B0` sama dengan isi blok `0B` (bagian 7.6).

### 6.5 `79`: versi firmware [UJI-TOLAK]

```
TX  55aa 01 79 00000000 00000000 0000 0900
RX  aa55 01 00 10000000 0900                      (gagal, kode 16: tidak didukung)
```

### 6.6 `B2` / `B3`: baca dan set jam [UJI]

```
TX  55aa 01 b2 00000000 00000000 0800 0500
RX  aa55 01 01 00000000 0500 | 55aa | ea07 09 1c 01 17 15 29 | 6b020000
                                     = 2026-09-28 (Senin) 23:21:41 WIB

TX  55aa 01 b3 00000000 00000000 0800 0600 | 55aa | ea07 09 1c 01 16 2e 0f | 0000
                                     = set 2026-09-28 (Senin) 22:46:15 WIB
RX  aa55 01 01 00000000 0600
```

Format 8 byte: bagian 7.7. Setelah sinkron, selisihnya 0 detik [UJI].

### 6.7 `81`: kunci / buka keypad [UJI]

`p1 = 0` mengunci keypad, `p1 = 1` membuka. Keduanya dibalas OK. Selalu buka lagi
(`p1 = 1`) di blok `finally`.

### 6.8 `A4`: baca semua log [UJI]

```
TX  55aa 01 a4 00000000 98060000 0004 1200        (halaman 0: p2 = jumlah log 1688, len 1024)
RX  aa55 01 01 00000000 1200 | 55aa | 1024 byte | ea340000

TX  55aa 01 a4 00000000 00000100 0004 1300        (halaman 1: p2 = 1 << 16)
RX  aa55 01 01 00000000 1300 | 55aa | 1024 byte | 5a330000
```

- Ambil jumlah log dari `B4` indeks 8, lalu baca `jumlah × 48` byte.
- 1.688 log = 80 halaman, sekitar 2,5–3,4 detik.
- **Tidak menandai log** "sudah dibaca": `B4` indeks 6 tidak berubah [UJI].
- Record pertama (PIN 13):
  ```
  3133 00…00 | 0100000a | fa313a92 | 00000002 | 00000010
  ```
  Artinya 2026-03-26 17:36:10, pulang, sidik jari. Format lengkap di 7.8.

### 6.9 `97`: daftar user [UJI]

```
TX  55aa 01 97 8c010000 8c010000 8c01 1100        (p1 = p2 = len = 11 × 36 = 396)
RX  aa55 01 01 00000000 1100 | 55aa | 396 byte | 74040000
```

Jumlah user diambil dari `B4` indeks 11. Record 36 byte: bagian 7.9.

### 6.10 `E8`: baca info user (dua langkah) [UJI]

```
TX  55aa 01 e8 00000000 34350000 3000 0c00 | 55aa | "1" + 47 × 00 | 0000   (pilih PIN 1)
RX  aa55 01 01 00000000 0c00

TX  55aa 01 e8 01000000 34350000 cc00 0d00                           (baca 204 byte)
RX  aa55 01 01 00000000 0d00 | 55aa | 204 byte (lihat 7.10) | 63070000
```

- `p2` = selektor bulan (bagian 8.4). `0x3534` = September 2026. Blok yang kembali berisi
  jadwal shift bulan tersebut.
- PIN yang tidak ada: langkah pilih tetap OK, tapi langkah baca **gagal dengan kode 3**
  (`aa55 01 00 03000000 …`).

### 6.11 `E9`: tulis info user (tiga sub-perintah) [UJI]

Semua sub-perintah memakai blok 204 byte yang sama (bagian 7.10), dengan `p2` = selektor
bulan dari blok itu.

| p1 | Fungsi | Kapan dikirim (urutan SDK `SetUserInfoEx`) |
|---|---|---|
| `0x16` | Tulis jabatan (`PostId`) | Bila `PostId` 1–16 |
| `0x17` | Tulis jadwal shift bulan pada blok | Selalu |
| `0x15` | Tulis nama | Bila nama tidak kosong |

```
TX  55aa 01 e9 15000000 34350000 cc00 0700 | 55aa | "99999"… nama UTF-16LE @36 … | 0000
RX  aa55 01 01 00000000 0700
TX  55aa 01 e9 16000000 34350000 cc00 0800 | 55aa | blok | 0000
RX  aa55 01 01 00000000 0800
TX  55aa 01 e9 17000000 34350000 cc00 0900 | 55aa | blok | 0000
RX  aa55 01 01 00000000 0900
```

- `0x15` untuk PIN yang belum ada **langsung membuat user baru**: aktif, hak akses user.
  Tapi user itu tanpa jabatan dan tanpa shift (`PostId` = 0).
- Tambahkan `0x16` + `0x17` dengan blok bawaan (bagian 7.11) supaya user baru **identik
  byte demi byte** dengan user buatan mesin.
- Mesin mengisi sendiri jadwal bulan-bulan berikutnya dari jabatannya [UJI].
- `0x15` untuk PIN yang sudah ada berarti ganti nama [UJI].

### 6.12 `93`: hapus user [UJI]

```
TX  55aa 01 93 01000000 0c000000 3000 1400 | 55aa | "99999" + 00… | 0000   (p2 = 12)
RX  aa55 01 01 00000000 ….                                                 (PIN ada: terhapus)
RX  aa55 01 00 04000000 1400                                               (PIN tidak ada: kode 4)
```

- `p2 = 12` menghapus **user secara utuh**, beserta semua kredensialnya [UJI].
  - Di enum SDK FK, 12 adalah `BACKUP_FACE`, tapi mesin ini memperlakukannya sebagai
    "hapus semua".
  - Terbukti pada user tanpa kredensial; `p2 = 0–11` ditolak dengan kode 4.
- Hanya PIN yang dikirim yang tersentuh. Setelah menghapus, cek ulang daftar user (`97`).

### 6.13 `94` / `95` / `96`: aktif, nonaktif, hak akses [UJI]

Ketiganya memakai data `PIN48` dan `p1 = 1`.

- `94` / `95`: `p2 = 0`. Status aktif hanya terlihat di daftar user (byte [33]).
- `96`: `p2 = 0` untuk user, `p2 = 1` untuk manager. `B4` indeks 1 ikut berubah [UJI].

### 6.14 `E2`: jabatan dan shift [UJI baca]

`p1 = 0`, dibaca 2.476 byte dalam 3 halaman: halaman 0 `p2 = 0`, lalu `1 << 16` dan
`2 << 16`. Struktur: bagian 7.12.

### 6.15 `C5`: jadwal bel [UJI baca]

`p1 = 0`, `p2 = 0`, len 72. Semua 24 slot bernilai 0 (tidak ada bel). Struktur: bagian 7.13.

### 6.16 `0B`: blok setting [UJI baca]

`p1 = 0`, `p2 = 0`, len 120. Struktur: bagian 7.6.

### 6.17 `AE` + `AF`: log per rentang tanggal [KODE]

Dari `FK_LoadGeneralLogDataByDate`:

1. `AE` kirim 12 byte:
   `[0..1]` tahun awal u16, `[2]` bulan awal, `[3]` tanggal awal,
   `[4..5]` tahun akhir u16, `[6]` bulan akhir, `[7]` tanggal akhir, `[8..11]` sisa.
   (SDK mengambil tahun akhir dari tanggal awal, kemungkinan bug SDK.)
2. `status` pada ack = jumlah log yang cocok.
3. `AF` membaca record dengan ukuran 32 byte per record menurut SDK.

Format record `AF` belum terverifikasi. Berguna untuk tarik log bertahap, tapi harus diuji dulu.

---

## 7. Struktur data

### 7.1 Blok info `13` p1=0 (48 byte) [UJI baca, arti field KODE/DUGA]

| Offset | Nilai (mesin ini) | Arti |
|---|---|---|
| 0x00 | `0104` | Versi blok |
| 0x02 | `0030` = 48 | Panjang blok |
| 0x04 | `1300` | Pemilih kelas lama ("CIF13") [DUGA] |
| 0x08 | u32 **1261** | License SDK; dicek di sisi PC, tidak dikirim [KODE] |
| 0x0c | `0101` | Versi paket (`0x103` = paging 512 byte, selain itu 1024) [KODE] |
| 0x13 | `12` | Format template sidik jari (FpDataVer 128) [KODE] |
| 0x14 | u32 10.000 | Kapasitas, urutan field belum pasti [DUGA]. Cocok dengan max sidik jari. |
| 0x18 | u32 2.000 | Kapasitas [DUGA] |
| 0x1c | u32 2.000 | Kapasitas [DUGA] |
| 0x20 | u32 1.000 | Kapasitas [DUGA] |
| 0x24 | u32 200.000 | Kapasitas log |
| 0x2e | u16 1024 | Panjang JSON pada `13` p1=1 [KODE] |

> Angka kapasitas yang resmi ada di `B4` indeks 200–207 (7.4): 2.000 user, 10.000 sidik
> jari, 2.000 wajah, 2.000 kartu, 200.000 log. Angka ini sama dengan spesifikasi di situs
> Fingerspot.

### 7.2 JSON kemampuan (`13` p1=1) [UJI]

| Kunci | Nilai | Arti |
|---|---|---|
| `CommunicationInterfaceId` | `13_1` | Memilih kelas `CFKAttend_CIF13_1` |
| `CodePage` | `UTF-16` | Nama disimpan UTF-16 |
| `EnrollDataType` | `{fp,pwd,idcard,face}` | Kredensial yang didukung |
| `FpDataVer` / `FaceDataVer` | 128 / 528 | Versi template |
| `SetupInfoStructType` | 10 | Tipe struktur setting |
| `UDiskBackupFileFormatId` | 3 | Format backup flashdisk |
| `SupportSetupImages` | OK | – |

### 7.3 Data produk `C3` (256 byte) [UJI]

| Offset | Isi (string ASCII, NUL) | Indeks SDK |
|---|---|---|
| 0x00 | `Revo WF-206BNC` | 3, kode produk |
| 0x20 | `Fingerspot` | 4, nama |
| 0x60 | `Fio00000000000000` | 1, serial |
| 0x80 | `17-01-2022` | 6, tanggal produksi |

### 7.4 Indeks `B4` (status) [UJI]

Nama dari enum SDK `enumGetDeviceStatus`. Nilai diambil tanggal 28-09-2026.

| Indeks | Nama SDK | Arti | Nilai |
|---|---|---|---|
| 1 | GET_MANAGERS | Jumlah manager | 2 |
| 2 | GET_USERS | Jumlah user biasa | 9 |
| 3 | GET_FPS | Jumlah template sidik jari | 8 |
| 4 | GET_PSWS | Jumlah password | 1 |
| 5 | GET_SLOGS | Log admin baru | 0 |
| 6 | GET_GLOGS | Log absensi **belum dibaca** | 1.650 |
| 7 | GET_ASLOGS | Total log admin | 0 |
| 8 | GET_AGLOGS | **Total log absensi** | 1.688 |
| 9 | GET_CARDS | Jumlah kartu | 0 |
| 10 | GET_FACES | Jumlah wajah | 8 |
| 11 | (tidak ada di enum) | **Total user** (= 1 + 2) | 11 |
| 12–39 | – | Ditolak, kode 3 | – |
| 40 | GET_PVS | Palm vein | 0 |
| 200 | GET_MAXUSERS | Max user | 2.000 |
| 201 | GET_MAXFPS | Max sidik jari | 10.000 |
| 202 | GET_MAXPSWS | Max password | 2.000 |
| 203 | GET_MAXCARDS | Max kartu | 2.000 |
| 204 | GET_MAXFACES | Max wajah | 2.000 |
| 205 | GET_MAXPVS | – | ditolak, kode 3 |
| 206 | GET_MAXSLOGS | Max log admin | 0 |
| 207 | GET_MAXGLOGS | Max log absensi | 200.000 |

`p2 = 0xFFFF0000` dipakai untuk semua indeks [UJI].

### 7.5 Indeks `B0` (setting) [UJI baca]

Nama dari enum SDK `enumGetDeviceInfo`. Petunjuk bertanda [DUGA] berasal dari manual
SBXPC (keluarga yang mirip).

| Indeks | Nilai | Arti |
|---|---|---|
| 1 | 5 | Batas jumlah manager |
| 2 | 1 | Nomor mesin (DN) |
| 3 | 9 | Bahasa (9 kemungkinan Bahasa Indonesia) [DUGA] |
| 4 | 0 | Auto power-off (menit) |
| 5 | 0 | Lock control |
| 6 | 0 | Peringatan log absensi hampir penuh |
| 7 | 100 | Peringatan log admin hampir penuh |
| 8 | 1 | Interval verifikasi ulang (menit) |
| 9 | 15 | Baudrate serial (nilai di luar enum 3–7) |
| 10 | 0 | Pemisah tanggal |
| 12, 13, 14, 15 | 1, 0, 1, 10 | Belum diketahui (SBXPC: mode verifikasi, kontrol pintu, sensor pintu) [DUGA] |
| 21, 23 | 40, 1 | Belum diketahui |
| 24 | 0 | Jenis verifikasi (DI_VERIFY_KIND) |
| 28, 29, 30, 31 | 5, 1, 0, 10 | Belum diketahui |
| 0x20 (32) | 192.168.0.10 | IP **LAN kabel** (u32, byte tertinggi = oktet pertama) |
| 0x24 (36) | 0 | – |
| 0x28 (40) | 5005 | Port TCP |
| 0x2a–0x2f | `1a:00:00:00:00:ab` | MAC **LAN kabel**, satu byte per indeks |
| 0x30 (48) | 255.255.255.0 | Subnet LAN |
| 0x34 (52) | 192.168.0.1 | Gateway LAN |
| 0x38 (56) | 192.168.0.109 | **Bukan** Server IP: tidak berubah saat Server IP di menu diganti [UJI] |
| 0x3c (60) | 9001 → 8013 | **Server Port** FkWeb: ikut berubah saat Server Port di menu diganti [UJI] |
| 62, 65, 86, 91 | 0, 1, 5, 0 | Belum diketahui |

> IP dan MAC di `B0` adalah setting port **LAN kabel**. Mesin terhubung lewat WiFi dengan
> DHCP (`192.168.1.201`, MAC WiFi `f0:c8:14:00:00:00`).

### 7.6 Blok setting `0B` (120 byte) [UJI baca]

Isi mentah dari mesin ini:

```
000501090002000064000001050f01010128030000010100
050a000a010100000a00a8c0000000008d131a00000000ab
00ffffff0100a8c001000000000000000000000001000000
00003c3c6d00a8c029230000000000100300000000000000
000000000000000000000000000000000000000000000000
```

Pemetaan offset ke indeks `B0` (dari fungsi SDK `FUN_1001eb60`). Semua nilai sudah
dicocokkan dengan `B0`.

| Offset | Indeks B0 | Offset | Indeks B0 | Offset | Indeks B0 |
|---|---|---|---|---|---|
| 1 | 1 | 15 | 14 | 32–35 | 0x20 |
| 2 | 2 | 17 | 21 | 36–39 | 0x24 |
| 3 | 3 | 22 | 29 | 40–41 | 0x28 |
| 4 | 4 | 23 | 5 | 42–47 | 0x2a–0x2f |
| 6–7 | 6 | 24 | 28 | 48–51 | 0x30 |
| 8–9 | 7 | 25 | 31 | 52–55 | 0x34 |
| 10 | 10 | 26 | 30 | 64–67 | 91 |
| 11 | 12 | 27 | 15 | 68–71 | 8 |
| 12 | 86 | 29 | 23 | 76–79 | 0x38 |
| 13 | 9 | 30 | 13 | 80–81 | 0x3c |
| 14 | 65 | | | 82 | 62 |

Offset lain yang tidak nol tapi belum dipetakan: 5 (`02`), 16 (`01`), 18 (`03`), 21 (`01`),
74–75 (`3c 3c`), 87 (`10`), 88 (`03`).

**Tidak ada jam masuk/pulang di blok ini.**

### 7.7 Jam (8 byte) [UJI]

| Offset | Isi |
|---|---|
| 0–1 | Tahun (u16) |
| 2 | Bulan (1–12) |
| 3 | Tanggal |
| 4 | Hari: **Minggu = 0**, Senin = 1, …, Sabtu = 6 (`SYSTEMTIME.wDayOfWeek`) |
| 5 | Jam |
| 6 | Menit |
| 7 | Detik |

Waktu adalah **jam dinding WIB (UTC+7)** tanpa info zona waktu. Konversi harus memakai
offset eksplisit, bukan zona waktu proses (lihat bagian 10).

### 7.8 Record log absensi (48 byte) [UJI]

| Offset | Isi |
|---|---|
| 0–31 | PIN, ASCII diakhiri NUL |
| 32–34 | Selalu `01 00 00` (tidak dipakai) |
| 35 | Detik |
| 36–39 | u32 tanggal dan waktu: bit 2–11 = tahun − 1900, bit 12–15 = bulan, bit 16–20 = tanggal, bit 21–25 = jam, bit 26–31 = menit |
| 40–42 | Mode pintu (selalu 0 di mesin ini) |
| 43 | Aksi: `1` = masuk, `2` = pulang (lihat catatan status otomatis di bagian 10) |
| 44–47 | Kode verifikasi (u32). Lihat di bawah. |

**Kode verifikasi** [KODE, data cocok]:
- Baca nibble dari byte 47 turun ke byte 44 (nibble atas dulu). Berhenti di nibble 0.
- Arti nibble: `1` = sidik jari, `2` = password, `3` = kartu, `4` = wajah.
- Contoh:
  - `00 00 00 10` → sidik jari;
  - `00 00 00 40` → wajah (SDK `LOG_FACEVERIFY`);
  - `00 00 00 12` → sidik jari + password.
- Isi mesin ini: 1.230 log sidik jari, 458 log wajah.

### 7.9 Daftar user (record 36 byte) dan PIN48 [UJI]

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

**PIN48** adalah 48 byte berisi PIN ASCII di awal, sisanya `00`. Dipakai oleh `E8`
langkah pilih, `93`, `94`, `95`, dan `96`.

PIN maksimal 22 digit (spesifikasi resmi); field menyediakan ruang 23 karakter + NUL.

### 7.10 Blok info user (204 byte, struct SDK `USER_INFO_STRING_ID_13_1` tanpa header 8 byte) [UJI]

| Offset | Field SDK | Isi |
|---|---|---|
| 0–31 | UserId | PIN, ASCII diakhiri NUL |
| 32–35 | Reserved | 0 |
| 36–163 | UserName | Nama UTF-16LE (buffer 128 byte). Mesin menyimpan maksimal **15 karakter**. |
| 164–167 | PostId | Jabatan untuk fitur shift bawaan mesin. User buatan mesin = 1. **Bukan** flag aktif. |
| 168–169 | YearAssigned | Tahun jadwal (u16) |
| 170–171 | MonthAssigned | Bulan jadwal (u16) |
| 172 | StartWeekdayOfMonth | Hari tanggal 1 (Minggu = 0) |
| 173–203 | ShiftId[31] | Nomor shift per tanggal 1–31, 0 = tanpa shift |

Bulan pada blok ditentukan oleh `p2` (selektor bulan) saat `E8` dan `E9` [UJI].

### 7.11 Blok bawaan user baru [UJI]

Semua 11 user buatan mesin identik, dan blok user buatan script (`E9` 0x15 + 0x16 + 0x17)
sama byte demi byte:

- PIN di offset 0 dan nama di offset 36;
- `PostId` = 1;
- tahun dan bulan = bulan berjalan;
- `[172]` = hari tanggal 1;
- `ShiftId[i]` = 1 bila hari ke-i (dihitung dari hari tanggal 1) jatuh Senin–Jumat, 0 bila
  Sabtu–Minggu. Isi 31 slot penuh walaupun bulan hanya 30 hari (slot 31 tetap mengikuti
  urutan hari).

### 7.12 Jabatan dan shift `E2` (2.476 byte, struct `POST_SHIFT_INFO`) [UJI baca]

| Offset | Isi | Isi di mesin ini |
|---|---|---|
| 0–3 | Size u32 = 2476 | `ac090000` |
| 4–7 | Versi | `00131000` |
| 8–295 | 24 slot shift × 12 byte: jam/menit mulai-akhir pagi (AM), siang (PM), lembur (OV) | Shift 1: 10:00–12:00, 12:00–18:00, 18:00–10:00. Shift 2: 08:00–12:00. Sisanya kosong. |
| 296–2343 | 16 nama jabatan × 128 byte | Kosong semua |
| 2344–2471 | Nama perusahaan (128 byte) | Kosong |
| 2472–2475 | Reserved | `3c 3c 00 00` |

Urutan 12 byte satu slot: `AMStartH AMStartM AMEndH AMEndM PMStartH PMStartM PMEndH PMEndM
OVStartH OVStartM OVEndH OVEndM`.

### 7.13 Jadwal bel `C5` (72 byte) [UJI baca]

`valid[24] | jam[24] | menit[24]`. Mesin ini: semua 0 (tidak ada bel).

### 7.14 Backup number (kredensial)

| Nilai | Arti | Status |
|---|---|---|
| 0–9 | Sidik jari ke-0 sampai ke-9 | [KODE] |
| 10 | Password | [KODE] |
| 11 | Kartu | [KODE] |
| 12 | SDK: wajah. **Pada `93` di mesin ini: hapus user seluruhnya** | [UJI] |
| 13–16 | Palm vein | [KODE] |
| 20 | Vein | [KODE] |
| 30 | Foto user | [KODE] |

---

## 8. Algoritma (pseudocode)

### 8.1 Membangun bingkai

```
function build_frame(cmd, p1, p2, seq, send_data = null, read_len = 0):
    len = send_data != null ? length(send_data) : read_len
    header = bytes(55 AA 01) + u8(cmd) + u32le(p1) + u32le(p2) + u16le(len) + u16le(seq)
    if send_data == null: return header
    return header + bytes(55 AA) + send_data + bytes(00 00)
```

### 8.2 Membaca balasan

```
function read_reply(socket, seq, read_len, timeout = 15 s):
    buffer = empty
    loop until timeout:
        buffer += socket.receive()
        i = find index where buffer[i] == AA and buffer[i+1] == 55
                              and u16le(buffer[i+8..i+9]) == seq     // cocokkan seq
        if found:
            ok     = buffer[i+3] == 01
            status = u32le(buffer[i+4..i+7])
            if not ok or read_len == 0: return (ok, status, empty)
            if length(buffer) >= i + 12 + read_len:
                data = buffer[i+12 .. i+12+read_len-1]
                // opsional: bila buffer sudah memuat 4 byte checksum,
                // cek sum(buffer[i+10 .. i+12+read_len-1]) == u32le(checksum)
                return (ok, status, data)
    error "timeout"
```

### 8.3 Baca berhalaman

```
function paged_read(cmd, p1, first_p2, total_bytes):
    out = empty; offset = 0; page = 0
    while offset < total_bytes:
        n = min(1024, total_bytes - offset)
        p2 = (page == 0) ? first_p2 : (page << 16)
        (ok, status, data) = xfer(cmd, p1, p2, read_len = n)
        if not ok: error
        out += data; offset += n; page += 1
    return out
```

### 8.4 Selektor bulan (`p2` untuk `E8`/`E9`)

```
month_selector(year, month) = (((year + 0x30) << 9) | (month << 5) | 0x14) & 0xFFFF
```

Year dan month adalah bulan WIB. Contoh: 2026-09 → `0x3534`, 2026-10 → `0x3554`,
2025-01 → `0x3234`.

### 8.5 Waktu log

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

### 8.6 Kode verifikasi

```
kinds = []
for byte_index in 47 down to 44:
    for nibble in [record[byte_index] >> 4, record[byte_index] & 0x0F]:
        if nibble == 0: return kinds
        kinds.append({1: "sidik jari", 2: "password", 3: "kartu", 4: "wajah"}[nibble])
return kinds
```

### 8.7 Jam ke 8 byte (dan sebaliknya)

```
wib = utc_instant + 7 jam           // bukan zona waktu lokal proses
block = u16le(wib.year) + u8(wib.month) + u8(wib.day) + u8(wib.weekday_sunday0)
      + u8(wib.hour) + u8(wib.minute) + u8(wib.second)

utc_instant = make_utc(year, month, day, hour, minute, second) - 7 jam
```

### 8.8 Blok bawaan user baru

```
function default_user_block(pin, name, year, month):          // year/month = bulan WIB
    b = 204 byte nol
    b[0..]   = ascii(pin)
    b[36..]  = utf16le(name)                                     // maks 15 karakter
    b[164..167] = u32le(1)                                       // PostId
    b[168..169] = u16le(year); b[170..171] = u16le(month)
    first = weekday(year, month, 1)                              // Minggu = 0
    b[172] = first
    for i in 0..30: b[173+i] = ((first + i) % 7 in 1..5) ? 1 : 0
    return b
```

---

## 9. Resep operasi

Semua resep diawali handshake (bagian 4).

**Tarik semua log** [UJI]
1. `n = B4(8)`
2. `data = paged_read(A4, p1=0, first_p2=n, total=n × 48)`
3. Pecah per 48 byte, lalu terjemahkan (7.8).
4. Buang duplikat berdasarkan `(PIN, waktu)` di server.

**Polling log baru** (rekomendasi)
- Setiap 15–60 detik, baca `B4(8)`. Bila bertambah, tarik semua lalu buang duplikat.
- Hindari `A1`/`A2`: penanda "sudah dibaca" dipakai bersama software lain.

**Daftar user beserta nama** [UJI]
1. `n = B4(11)`
2. `paged_read(97, p1=n×36, first_p2=n×36, total=n×36)`
3. Untuk setiap PIN: `E8 p1=0 (PIN48)`, lalu `E8 p1=1 len 204`. Nama ada di offset 36.

**Tambah user** [UJI]
1. Pastikan PIN belum ada di daftar user.
2. `E9 p1=0x15` dengan blok berisi PIN dan nama. Langkah ini membuat user.
3. `E9 p1=0x16`, lalu `E9 p1=0x17`, dengan `default_user_block(...)` (8.8).
4. Opsional: `96 p2=1` untuk menjadikan manager.
5. Verifikasi lewat `97` dan `E8`.

**Ganti nama** [UJI]: `E9 p1=0x15` dengan blok berisi PIN dan nama baru.

**Hak akses** [UJI]: `96 p1=1 p2=(0|1)` dengan PIN48.

**Aktif / nonaktif** [UJI]: `94` (aktif) atau `95` (nonaktif), `p1=1 p2=0`, dengan PIN48.

**Hapus satu user** [UJI]
1. Konfirmasi ke operator.
2. `93 p1=1 p2=12` dengan PIN48.
3. Pastikan PIN hilang dari `97`.

**Sinkron jam** [UJI]
1. Tunggu awal detik berikutnya.
2. `B3` dengan jam WIB sekarang.
3. Baca `B2` untuk verifikasi (toleransi ±1 detik).

---

## 10. Perilaku mesin dan jebakan

1. **Zona waktu.** Jam mesin adalah jam dinding WIB. Jangan memakai fungsi tanggal "lokal"
   milik proses: uji otomatis, launchd, Docker, atau server bisa berjalan di UTC. Salah zona
   membuat sinkron jam menggeser mesin 7 jam dan semua absen berikutnya salah. Selalu
   pakai offset UTC+7 eksplisit. [UJI, bug nyata yang tertangkap]
2. **Status masuk/pulang diganti otomatis oleh jam** [DUGA kuat dari data]:
   - dari 1.688 log, tidak ada "masuk" sebelum 09:01, dan tidak ada "pulang" antara 08:57
     dan 15:40;
   - orang yang datang jam 08:30 tercatat "pulang";
   - setting ini tidak terbaca lewat perintah SDK mana pun (`E2`, `C5`, `0B`, `EC` sudah
     dicek) [FISIK].
   Aplikasi sebaiknya menentukan masuk/pulang sendiri dari jam dan urutan absen.
3. **Penanda "sudah dibaca" dipakai bersama.** `A2` mengubah penanda milik semua software
   (EasyLink, cloud). Pakai `A4` dan buang duplikat di server.
4. **`93 p2=12` menghapus user secara utuh.** Jangan kirim tanpa konfirmasi. `C1` menghapus
   **semua** data ⛔.
5. **Checksum balasan** hampir selalu cocok, tapi tidak pada halaman 2–3 dari `E2`. Jangan
   menolak data hanya karena checksum.
6. **Status 3 pada baca `E8`** berarti PIN tidak ada. Langkah pilih (p1=0) tetap OK.
7. **Byte 164 blok user adalah `PostId`**, bukan flag aktif. Flag aktif ada di daftar user
   [33].
8. **IP dan MAC dari `B0`/`0B` milik port LAN kabel**, bukan WiFi.
9. **Nama** maksimal 15 karakter di mesin. Simpan nama lengkap di aplikasi.
10. **Blok info `13`:** urutan field kapasitas tidak pasti. Pakai `B4` indeks 200–207.
11. **Koneksi ulang yang terlalu cepat** bisa ditolak sementara. Coba lagi setelah 1–2 detik.
12. **Firmware tidak bisa dibaca** (`79` tidak didukung).

---

## 11. Status uji lengkap

### 11.1 Sudah diuji: baca (aman) [UJI]

| Temuan | Hasil | Uji otomatis |
|---|---|---|
| Port 5005 dan 23 terbuka, port lain tertutup | Sesuai | ya |
| Telnet 23: Linux Buildroot | Sesuai | ya |
| MAC WiFi `f0:c8:14:00:00:00` | Sesuai | ya |
| Handshake tanpa password (`p1=0`) | Diterima | ya |
| Password salah (`p1=1234`) | Ditolak | ya |
| JSON kemampuan (CIF13_1, fp/pwd/idcard/face, 128/528) | Sesuai | ya |
| Blok info: license 1261 dan lima angka kapasitas | Sesuai | ya |
| Kapasitas `B4` 200–207 = spesifikasi resmi | Sesuai | ya |
| Data produk `C3` | Sesuai | ya |
| `79` versi firmware | Ditolak (16) | ya |
| `B0`: nomor mesin, port, IP/subnet/gateway/MAC LAN | Sesuai | ya |
| `B4` 1–11 valid, 12 ditolak kode 3, 1 + 2 = 11 | Sesuai | ya |
| `B2` baca jam | Sesuai | ya |
| `97` daftar user: jumlah dan flag cocok dengan status 1/4/10/11 | Sesuai | ya |
| `E8` semua nama ≤ 15 karakter; PIN yang tidak ada ditolak kode 3 | Sesuai | ya |
| `E8` selektor bulan (Sep 2026, Okt 2026, Jan 2025) | Sesuai | ya |
| `A4` 1.688 log: valid, tanpa duplikat, tidak menandai dibaca | Sesuai | ya |
| `E2` jabatan dan shift | Terbaca | manual |
| `C5` jadwal bel | Terbaca (kosong) | manual |
| `0B` blok setting, cocok dengan semua `B0` | Sesuai | manual |
| Checksum balasan | 90 dari 92 cocok | manual |
| `EC` zona waktu | Ditolak (16) | manual |
| `13` p1 = 2–4 | Ditolak | manual |
| Koneksi ulang cepat | Kadang `ECONNREFUSED`, pulih dalam 2 detik | manual |

### 11.2 Sudah diuji: tulis (dengan izin, user tes PIN 99999 yang selalu dihapus lagi) [UJI]

| Temuan | Hasil | Uji otomatis |
|---|---|---|
| `E9 0x15` membuat user baru (aktif, user biasa) | OK | ya |
| `E9 0x16 + 0x17`: jabatan dan jadwal identik dengan user buatan mesin, bulan ini dan bulan depan | OK | ya |
| `E9 0x15` pada PIN yang ada = ganti nama | OK | ya |
| `96` manager lalu user; `B4` indeks 1 ikut berubah | OK | ya |
| `95`/`94` nonaktif lalu aktif; `PostId` tidak ikut berubah | OK | ya |
| `93 p2=12` menghapus user; jumlah kembali; `E8` ditolak | OK | ya |
| `93` untuk PIN yang tidak ada | Ditolak (4) | ya |
| `81` kunci lalu buka keypad | OK | ya |
| `B3` sinkron jam, selisih ≤ 2 detik | OK (0 detik) | ya |

### 11.3 Dari kode SDK, belum diuji [KODE]

| Perintah | Keterangan |
|---|---|
| `A1` baca log baru | Tidak perlu (cukup `A4`) |
| `AE`/`AF` log per rentang tanggal | Berguna untuk tarik bertahap. Format record `AF` belum pasti. |
| `A3` log admin | Jumlah log admin 0 |
| `B1` ubah setting | Belum perlu |
| `93 p2=0–11` hapus satu kredensial | Baru terbukti menolak kredensial yang tidak ada |
| `98` tambah kredensial; `F1`, `F5`–`F8` template jari/wajah | Perlu kalau nanti ada mesin kedua |
| `E3` tulis jabatan/shift, `C6` tulis bel | Fitur laporan bawaan mesin, tidak dipakai |
| `E0`/`E1` status pintu | Mesin tidak dipakai sebagai kunci pintu |
| `FC` perintah JSON | Format dari SDK: kirim `{"cmd":nama,"param":{…}}` + NUL (p1=0); status ack = panjang jawaban; baca p1=1. Contoh resmi: `cs_serverinfo_set` (server log realtime). `cs_serverinfo_get` dan nama palsu sama-sama dijawab 16 [UJI]. Baca `p1=1` sepanjang 16 hanya mengembalikan 16 byte pertama yang dikirim (echo) [UJI]. Daftar perintah ada di firmware, tidak ada di SDK. |
| Daftar jari/wajah jarak jauh (remote enroll) | **Terjawab 29-09-2026 [UJI]:** lewat FkWeb, `SET_COMMAND {"cmd":"enter_enroll","param":{"user_id","backup_number"}}` (bagian 14.5). Catatan lama: **Tidak ada** di SDK FK maupun katalog FkWeb. Ada di cloud Fingerspot.io ("Register Online"), dan keluarga SBXPC (`RemoteEnroll`). Jalur lokal mungkin lewat `FC`, tapi nama perintahnya tidak diketahui. Alternatif: scanner USB → ISO 19794-2 → `FpDataConv.dll` (ISO → `0x89` → `0x85` → `0x80`, 612 byte) → `F1`/`F5`–`F8`. Belum diuji. Tanpa scanner: cloud fingerspot.io (`fdevice.com:8013`) memakai protokol FkWeb push, jadi Register Online = satu `cmd_code` yang namanya belum diketahui. Lihat riset.md no. 14. |

### 11.4 Sengaja tidak diuji

| Perintah | Alasan |
|---|---|
| `A2` tandai log dibaca | Tidak bisa dibatalkan, dan memengaruhi software lain |
| `C1 p1=0` hapus semua log ⛔ | Destruktif |
| `C1 p1=1` hapus semua user ⛔ | Destruktif |

### 11.5 Perlu pengecekan fisik [FISIK]

| Hal | Cara |
|---|---|
| Setting jam pergantian status masuk/pulang | Foto menu mesin |
| Password komunikasi | Aktifkan di menu, lalu uji `80` dengan `p1` = password |
| User buatan script bisa absen | Daftarkan sidik jari ke PIN tes buatan script, lalu coba absen |
| ~~Mode push/server (indeks `B0` 0x38/0x3c)~~ | **Selesai:** menu Jaringan, Mode Internet (bagian 14.1) |
| Konfirmasi kode verifikasi 0x40 = wajah | Satu kali absen wajah, lalu lihat log terbaru |

### 11.6 Riwayat koreksi temuan

| Temuan lama | Koreksi | Bukti |
|---|---|---|
| Flag daftar user di byte 33/34/35 | Byte 32 (manager), 33 (aktif), 34 (data) | Data mentah dan status |
| Blok user [164] = flag aktif | `PostId` (jabatan) | Struct SDK dan uji 94/95 |
| `E8 p2 = 0x3534` konstanta | Selektor bulan | Uji tiga bulan |
| `93 p2=12` = hapus wajah (enum SDK) | Hapus user seluruhnya | Uji tulis |
| Kapasitas: 10.000 user, 1.000 wajah | 2.000 user, 10.000 jari, 2.000 wajah | `B4` 200–207 dan situs resmi |
| `B4` indeks 7 = kartu | 7 = total log admin, 9 = kartu | Enum SDK |
| 4 byte penutup bukan checksum | Checksum jumlah byte `55 AA` + data | 90 dari 92 balasan |
| IP/MAC `B0` = jaringan mesin | Setting LAN kabel, bukan WiFi | Nilai berbeda dari WiFi |

---

## 12. Test vector

Pakai untuk memvalidasi implementasi di bahasa apa pun. Semua diambil dari mesin atau
dari uji yang lulus.

| # | Masukan | Keluaran yang benar |
|---|---|---|
| 1 | `build_frame(0x93, p1=1, p2=12, seq=7, send=PIN48("1"))` | 68 byte: `55aa0193010000000c00000030000700` + `55aa` + `31` + 47 × `00` + `0000` |
| 2 | `build_frame(0xB2, 0, 0, seq=1, read_len=8)` | `55aa01b2000000000000000008000100` |
| 3 | Ack `aa550101980600000600` | OK, status 1688, seq 6 |
| 4 | Ack `aa550100030000000700` | Gagal, kode 3, seq 7 |
| 5 | `month_selector(2026, 9)` / `(2026, 10)` / `(2025, 1)` | `0x3534` / `0x3554` / `0x3234` |
| 6 | Jam 2026-09-28 21:34:44 WIB (Senin) | `ea07091c0115222c` |
| 7 | Jam 2026-09-27 12:00 WIB (Minggu) | byte ke-4 = `00` |
| 8 | Jam 2026-09-28 01:00:00 WIB (UTC masih tanggal 27) | `ea07091c01010000` |
| 9 | Balasan `B2`: data `ea07091c01171529` | Checksum `6b020000` (= 619) |
| 10 | Log: `"13"` + 30 × `00` + `0100000afa313a920000000200000010` | PIN 13, 2026-03-26 17:36:10, pulang, sidik jari |
| 11 | Kode verifikasi `00000040` / `00000012` | wajah / sidik jari + password |
| 12 | Record user: `"1"` + 31 × `00` + `00010000` | PIN 1, user, aktif, data 00 |
| 13 | `default_user_block(…, 2026, 9)[164..203]` | `01000000ea0709000201010101000001010101010000010101010100000101010101000001010101` |
| 14 | `default_user_block(…, 2026, 10)[164..203]` | `01000000ea070a000401010000010101010100000101010101000001010101010000010101010100` |

---

## 13. Implementasi referensi dan uji otomatis

| Bagian dokumen | Modul SDK (`crates/freedom-finger-sdk/src`) |
|---|---|
| 2, 8.1-8.3 bingkai, balasan, paging | `tcp/mod.rs` (`frame`, `parse_reply`), `tcp/client.rs` (`read_paged`) |
| 4 handshake, 6 perintah, 9 resep | `tcp/client.rs` (`Client`) |
| 7, 8.4-8.8 struktur data | `tcp/record.rs`, `time.rs` (`WallTime`) |
| 12 test vector | uji di `tcp/mod.rs`, `tcp/record.rs`, `time.rs` |
| 14 FkWeb | `fkweb/mod.rs` (`Body`), `fkweb/message.rs`, `fkweb/command.rs` |

CLI di atas SDK: `crates/fk-cli` (biner `fk`: `log`, `jam [--sinkron]`, `list`, `add`,
`edit`, `delete`). Server FkWeb lengkap: `crates/freedom-finger`.

```bash
cargo test --workspace            # uji offline, tanpa mesin (termasuk test vector bagian 12)
```

Semua temuan di bagian 11.1 dan 11.2 pernah diuji langsung ke mesin dengan implementasi
sebelumnya (28-09-2026): 16 uji baca lulus, 9 uji tulis lulus. Uji ke mesin versi Rust belum
ada di repo ini.

Kalau membuat implementasi di bahasa lain, jalankan dulu test vector bagian 12. Setelah
itu, ulangi urutan uji ke mesin untuk memastikan hasilnya sama.

---

## 14. Protokol FkWeb (HTTP push, mode Internet)

Semua isi bagian ini [UJI] di mesin ini pada 29-09-2026, kecuali ditandai lain.
Implementasi referensi: modul `freedom_finger_sdk::fkweb` (codec dan pesan) dan server lengkap
`crates/freedom-finger`.

### 14.1 Transport

| Hal | Nilai |
|---|---|
| Mengaktifkan | Menu **Jaringan**: Mode **Internet**, Server IP, Server Port, Server Req = Ya. Mode **Lokal** mematikan FkWeb dan menghidupkan TCP 5005. |
| Arah | **Mesin = klien HTTP.** Mesin mengirim `POST /` ke `http://<Server IP>:<Server Port>/`. Server tidak pernah memulai koneksi. |
| Gaya | HTTP/1.0, `Connection: close`, satu request per koneksi, `User-Agent: Mozilla/4.0`, `Content-Type: application/octet-stream` |
| Keamanan | Tanpa TLS dan tanpa autentikasi. Mesin dikenali dari header `dev_id` (= Cloud ID, `C2610000000000AB`). |
| Server resmi | `fdevice.com:8013` / `8014` (fingerspot.io), `fdevice.com:9004` (developer.fingerspot.io) |
| Kompresi | Mesin mengirim `Accept-Encoding: gzip, deflate`. Server cukup menjawab tanpa kompresi. |

### 14.2 Header

| Header | Arah | Isi |
|---|---|---|
| `request_code` | mesin → server | `receive_cmd`, `send_cmd_result`, `realtime_glog`, `realtime_enroll_data` |
| `dev_id` | mesin → server | Cloud ID, huruf/angka ≤ 18 |
| `trans_id` | dua arah | `ReceiveCommandAction` / `RTLogSendAction` / `RTEnrollDataAction`, atau `trans_id` perintah pada `send_cmd_result` |
| `cmd_return_code` | mesin → server | Hasil perintah, misalnya `OK` (hanya `send_cmd_result`) |
| `blk_no`, `blk_len` | mesin → server | Nomor dan panjang blok. `0` = blok terakhir/tunggal. |
| `response_code` | server → mesin | `OK`, `ERROR_NO_CMD`, atau `ERROR_…` |
| `cmd_code` | server → mesin | Nama perintah (hanya jawaban `receive_cmd`) |

Body jawaban server = `cmd_param` (bagian 14.3), atau kosong.

### 14.3 Format body

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

### 14.4 Request dari mesin

| `request_code` | Body JSON | Jawaban server |
|---|---|---|
| `receive_cmd` | `{"fk_name":"Fingerspot","fk_time":"YYYYMMDDhhmmss","fk_info":{"face_data_ver":528,"firmware":"A102D2S2K1Wfs01 v1.14","firmware_filename":"A102D2S2K1Wfs01_um","fk_bin_data_lib":"FKDataHS103","fp_data_ver":128,"supported_enroll_data":["PASSWORD","IDCARD","FACE","FP"]}}` | `ERROR_NO_CMD`, atau `OK` + `trans_id` + `cmd_code` + `cmd_param` |
| `send_cmd_result` | Hasil perintah (bagian 14.5); kosong bila hanya `OK` | `OK` |
| `realtime_glog` | `{"fk_bin_data_lib":"FKDataHS103","io_mode":N,"io_time":"YYYYMMDDhhmmss","log_image":null,"user_id":"13","verify_mode":N}` | `OK` (mesin lalu menandai log terkirim) |
| `realtime_enroll_data` | `{"enroll_data_array":[{"backup_number":0,"enroll_data":"BIN_2"},{"backup_number":12,"enroll_data":"BIN_3"}],"user_id":"13","user_name":"Andi","user_photo":"BIN_1","user_privilege":"USER"}` + foto, jari (800 byte), wajah (20.000 byte) | `OK` |

**Log:** `io_mode` dan `verify_mode` sama dengan byte 40–43 dan 44–47 record 48 byte
(bagian 7.8).
- `io_mode >>> 24` = aksi: 1 masuk, 2 pulang.
- `verify_mode >>> 28` = cara verifikasi: 1 jari, 2 password, 3 kartu, 4 wajah.

Contoh: `io_mode 33554432` = pulang, `verify_mode 268435456` = jari,
`1073741824` = wajah. Foto absen = `log_image: "BIN_1"`; di mesin ini selalu `null`.

### 14.5 Perintah (server → mesin)

| `cmd_code` | `cmd_param` | Hasil (`send_cmd_result`) |
|---|---|---|
| `GET_USER_ID_LIST` | – | `{"one_user_id_size":36,"user_id_array":"BIN_1","user_id_count":11}` + record 36 byte (bagian 7.9) |
| `GET_USER_INFO` | `{"user_id":"2"}` | `{"enable_flag":"ON","enroll_data_array":[{"backup_number":0,"enroll_data":"BIN_1"}],"user_id":"2","user_name":"Budi Santoso","user_privilege":"MANAGER"}` + biner. `enroll_data_array` = `null` bila belum ada kredensial. |
| `SET_USER_INFO` | JSON seperti hasil `GET_USER_INFO` (+ opsional `user_photo`) + biner | `OK`. **Mengganti seluruh data user**: kredensial yang tidak dikirim ikut terhapus. |
| `DELETE_USER` | `{"user_id":"99999"}` | `OK` |
| `SET_COMMAND` | `{"cmd":"enter_enroll","param":{"user_id":"2","backup_number":0}}` | `OK` langsung. Mesin menampilkan layar daftar; setelah berhasil, datanya dikirim sebagai `realtime_enroll_data`. |
| `SET_TIME` | `{"time":"20260929131140"}` (jam dinding lokal) | `OK` |
| `RESET_FK` | – | Tidak ada; mesin langsung restart. Jam tetap benar. |
| `GET_LOG_DATA` | – | `{"log_count":1697,"one_log_size":48}` + semua log, record 48 byte (bagian 7.8) |

- `backup_number`: 0–9 jari, 10 password, 11 kartu, 12 wajah (bagian 7.14).
- Password = teks ASCII tanpa NUL (`"1234"` = `31323334`).
- `user_privilege`: `USER`, `MANAGER`, `OPERATOR` (ketiganya diterima mesin), dan
  `REGISTER` [KODE].
- Template jari FkWeb = 800 byte, versi `0x80`. Setelah `SET_USER_INFO` ulang, byte
  676–798 berubah, 676 byte pertama tetap, dan jari tetap dikenali.
- Tidak dipakai (destruktif) [KODE]: `CLEAR_ENROLL_DATA`, `CLEAR_LOG_DATA`,
  `CLEAR_MANAGER`, `SET_WEB_SERVER_INFO`, `UPDATE_FIRMWARE`.

### 14.6 Perilaku dan jebakan

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

### 14.7 Contoh pertukaran (daftar jari jarak jauh)

```
mesin  → POST /   request_code: receive_cmd   dev_id: C2610000000000AB   trans_id: ReceiveCommandAction
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

## 15. Sumber

FkWeb (bagian 14):
- Uji langsung dan relay `fdevice.com:9004` ↔ mesin, 29 September 2026
- [InjesApp: server FkWeb resmi](https://github.com/GhazanfarKhan/InjesApp)
  (`FKWebCmdTrans.cs`, `Default.aspx.cs`, `ControlFK/UserManage.aspx.cs`): format body,
  header, blok, `SET_USER_INFO`
- [developer.fingerspot.io/docs](https://developer.fingerspot.io/docs/en/getting-started):
  bentuk API dan webhook yang ditiru `freedom-finger`
- [fingerspot.io/device](https://fingerspot.io/device): port 8013/8014
- [arivin29/finger](https://github.com/arivin29/finger/blob/master/data1): rekaman
  request FkWeb mesin lain (2019)

TCP 5005:

- Dekompilasi `FKAttend.dll` dan `FKViaDev.dll` (Ghidra 12.1.4), dari paket SDK FK di
  [biomax_security](https://github.com/Yaswanth-Vempuluru-7916/biomax_security),
  [NovinPardaz_Device_Connector](https://github.com/AliRezaKhazaeiNezhad/NovinPardaz_Device_Connector),
  dan [UTAS](https://github.com/TahaImran1/UTAS)
- Sampel SDK FK: `FKAttendDLL.cs` (enum, struct `USER_INFO_STRING_ID_13_1`,
  `POST_SHIFT_INFO`), `frmPostShiftInfo.cs`, `frmEnroll.cs`
  ([biomax_security](https://github.com/Yaswanth-Vempuluru-7916/biomax_security/tree/main/Samples/FK623Attend/c%23))
- Manual SBXPC OCX v3.12 (SmackBio), dari paket SDK Realand
- [Byiringiro24/Tablet_Setup](https://github.com/Byiringiro24/Tablet_Setup) dan
  [SecureyeDashboard](https://github.com/Aditya260306/SecureyeDashboard): cara pihak lain
  menghapus user
- [Spesifikasi Revo WF-206BNC di Fingerspot.io](https://fingerspot.io/detail-product/mesin-absensi-sidik-jari-wajah-revo-wf-206bnc):
  kapasitas, PIN 22 digit, auto shift
- Uji langsung ke mesin `192.168.1.201`, 28 September 2026
