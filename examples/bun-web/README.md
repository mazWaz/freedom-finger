# Freedom Finger web app

Tampilan aplikasi desktop (Hari ini, Riwayat, Rekap, Izin & koreksi, Karyawan, Jam kerja, Hari
libur, Mesin, Pengaturan) sebagai halaman web, untuk kantor yang punya server menyala terus. Dibuka
dari browser mana pun di jaringan kantor, dengan login user dan kata sandi. Servernya memakai
[Bun](https://bun.com) dan berbicara dengan server Freedom Finger lewat API HTTP-nya
([`docs/api.md`](../../docs/api.md)).

```text
mesin absensi ──► server Freedom Finger :8013 ◄── server web Bun :3000 ◄── browser (login)
                   (freedom-finger install)        menyimpan token API      tidak pernah melihat token
```

## Differences from the desktop app

| Hal | Desktop | Web |
|---|---|---|
| Masuk | Satu kata sandi untuk PC itu | User dan kata sandi per orang; semua user setara, dikelola di Pengaturan |
| Server Freedom Finger | Tertanam di aplikasi | Terpisah, dipasang dengan `freedom-finger install` |
| Data aplikasi | `aplikasi.json` di PC | `aplikasi.json` dan `users.json` di `DATA_DIR` server web |
| Export dan cetak | Dialog simpan dan cetak OS | Unduhan dan dialog cetak browser |
| Backup | Menu Backup | Tidak ada: backup database dengan `freedom-finger backup FILE`, dan salin `DATA_DIR` |
| Update | Otomatis dari rilis GitHub | Ambil kode baru, lalu mulai ulang |
| Absen selama PC mati | Ditarik saat aplikasi dibuka | Tidak perlu: server menyala terus |

Beberapa orang bisa membuka aplikasi bersamaan. Data aplikasi diambil ulang tiap menit, dan bila
dua orang menyimpan perubahan hampir bersamaan, yang kedua ditolak dengan pesan dan diminta mengulang,
supaya perubahan orang pertama tidak tertimpa.

## Run

Butuh Bun 1.3+ dan server Freedom Finger yang sudah berjalan.

```sh
cd examples/bun-web
bun install
cp .env.example .env     # isi FREEDOM_FINGER_TOKEN dengan FKWEB_TOKEN dari freedom-finger.env
bun run dev              # http://localhost:3000, muat ulang sendiri saat kode berubah
```

Buka halamannya, lalu buat user pertama. Halaman pembuatan user pertama hanya muncul selama belum ada
user, jadi buat segera setelah server web dinyalakan.

Untuk dipakai sehari-hari: `bun run start` (mode produksi, tanpa langkah build), dijalankan sebagai
layanan (systemd di Linux, NSSM atau Task Scheduler di Windows) supaya hidup lagi setelah restart.

| Variabel | Bawaan | Isi |
|---|---|---|
| `FREEDOM_FINGER_URL` | `http://localhost:8013` | Alamat server Freedom Finger |
| `FREEDOM_FINGER_TOKEN` | wajib | `FKWEB_TOKEN` dari `freedom-finger.env` |
| `PORT` | `3000` | Port halaman web |
| `DATA_DIR` | `./data` | Folder `aplikasi.json` dan `users.json` |

Pindah dari aplikasi desktop: salin `aplikasi.json` dari folder data aplikasi desktop ke `DATA_DIR`
sebelum server web dinyalakan. Kata sandi desktop di file itu diabaikan.

Lupa semua kata sandi: hentikan server web, hapus `DATA_DIR/users.json`, nyalakan lagi, lalu buat
user pertama lagi. Data absen dan aplikasi tidak ikut terhapus.

## Docker

Cara paling ringkas untuk server kantor Linux: satu perintah menjalankan **server Freedom Finger**
(menerima absen dari mesin di port 8013) dan **halaman web** (port 3000), tanpa memasang Bun
atau program server di komputer itu.

```sh
cd examples/bun-web
cp .env.example .env     # isi FREEDOM_FINGER_TOKEN dengan teks acak, mis. hasil `openssl rand -hex 24`
docker compose up -d --build
```

Lalu isi menu mesin dengan IP server dan port 8013 (lihat `http://<IP server>:8013`), dan buka
halaman web di `http://<IP server>:3000`. Keduanya hidup lagi sendiri setelah komputer dinyalakan ulang.

Server Freedom Finger sudah dipasang langsung dengan `freedom-finger install`, atau komputernya Mac atau
Windows? Jalankan halaman web saja, dengan `FREEDOM_FINGER_TOKEN` diisi `FKWEB_TOKEN` dari
`freedom-finger.env`:

```sh
docker compose up -d --build web
```

| Hal | Isi |
|---|---|
| Image server | File rilis Linux `freedom-finger` (statis; SDK, SQLite, zona waktu sudah di dalamnya) di image kosong: ±7 MB ([`docker/Dockerfile`](../../docker/Dockerfile)). Versi tertentu: ubah `build` menjadi `{context: ../../docker, args: {VERSION: v0.5.0}}` |
| Image web | satu file executable (`bun build --compile`: server, halaman, CSS, huruf, exceljs) di Alpine; unduhan ±41 MB, di disk ±104 MB |
| Jaringan | Server memakai jaringan komputer itu (`network_mode: host`): mesin mengirim ke port 8013-nya, IP di layar status benar, dan Cari mesin memindai jaringan kantor. Ini hanya penuh di Linux; di Docker Desktop (Mac, Windows) pasang server langsung. Halaman web menghubungi server lewat `host.docker.internal:8013` |
| Port web | `PORT` di `.env` (bawaan 3000) |
| Data | Volume `server` (database absen, berisi data jari/wajah) dan `data` (`aplikasi.json`, `users.json`) |
| Backup | `docker compose exec freedom-finger /freedom-finger --data /data backup /data/backup.db`, lalu `docker compose cp freedom-finger:/data/backup.db .`; data web: `docker compose cp web:/data ./backup-web` |
| Update | Web: ambil kode baru (`git pull`), lalu `docker compose up -d --build`. Server ke rilis terbaru: `docker compose build --no-cache freedom-finger && docker compose up -d` |

## Security

- Token API hanya ada di server web. Browser memanggil `/api/<endpoint>` dan server web meneruskannya
  dengan token, hanya untuk user yang sudah login.
- Kata sandi disimpan sebagai hash argon2id (`Bun.password`) di `users.json` (izin file 600). Lima kali
  salah berturut-turut mengunci user itu 5 menit.
- Sesi memakai cookie `HttpOnly` dan `SameSite=Strict`, berakhir setelah 12 jam tidak dipakai, saat
  keluar, saat kata sandi diganti (perangkat lain), atau saat user dihapus. Sesi disimpan di memori:
  server web dimulai ulang = semua orang login lagi.
- Tanpa HTTPS. Pakai di jaringan kantor; bila dibuka dari luar kantor, pasang di balik reverse proxy
  dengan HTTPS (Caddy, nginx) dan jangan buka port 8013 maupun 3000 langsung ke internet.

## Code layout

Setiap file paling banyak ±350 baris. Server tidak tahu isi halaman; halaman hanya memakai `/app/*`
dan `/api/*`.

```text
server/                      server web (TypeScript, Bun)
├── index.ts                 titik masuk: baca .env, jalankan server
├── app.ts                   rakit route; semua route selain login dijaga sesi (guard)
├── config.ts                variabel environment
├── auth.ts                  user, kata sandi, sesi: /app/me, login, logout, setup, password, users
├── data.ts                  aplikasi.json dengan pemeriksaan bentrok (rev): /app/data
├── proxy.ts                 /api/* ke server Freedom Finger dengan token; /app/status
├── xlsx.ts                  export Excel: /app/xlsx
├── store.ts                 file JSON yang ditulis atomik
├── http.ts                  bentuk balasan dan error bersama
└── server.test.ts           uji dengan server Freedom Finger tiruan
web/                         halaman (JavaScript tanpa framework, dibundel Bun)
├── index.html               kerangka: login, sidebar, isi semua menu, dialog
├── main.js                  mulai: login, muat data, event realtime, pindah menu
├── styles/                  base, hari-ini, dialog, halaman, masuk, cetak (dimuat berurutan)
├── pages/                   satu file per menu; menu Karyawan dibagi: karyawan, -laci, -ambil, -bersama
├── components/              tanggal.js (pemilih tanggal), masuk.js (layar login)
└── lib/
    ├── api.js               permintaan ke server web, perintah ke mesin, event realtime
    ├── data.js              data aplikasi dan karyawan; simpan dengan rev
    ├── format.js            tanggal dan jam untuk tampilan
    ├── ui.js                $, esc, pesan, laci, layar tunggu, dialog tanya, halaman tabel
    ├── export.js            unduh Excel/CSV, cetak
    └── hitung-rekap.js      aturan rekap, fungsi murni (+ .test.js)
```

```sh
bun test         # aturan rekap dan server web
bun run check    # periksa tipe TypeScript server
```

Halaman disalin dari [`examples/tauri-dashboard`](../tauri-dashboard), lalu disesuaikan untuk web:
perintah Tauri diganti `fetch` ke server ini, dialog OS diganti dialog halaman dan unduhan browser.
Fitur halaman yang baru di desktop perlu disalin ke sini juga.
