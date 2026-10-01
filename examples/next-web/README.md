# Freedom Finger web app (Next.js)

Tampilan aplikasi desktop (Hari ini, Riwayat, Rekap, Izin & koreksi, Karyawan, Jam kerja, Hari
libur, Mesin, Pengaturan) sebagai aplikasi web [Next.js](https://nextjs.org) (App Router, React),
untuk kantor yang punya server menyala terus. Dibuka dari browser mana pun di jaringan kantor, dengan
login user dan kata sandi. Server Next.js berbicara dengan server Freedom Finger lewat API HTTP-nya
([`docs/api.md`](../../docs/api.md)).

```text
mesin absensi ──► server Freedom Finger :8013 ◄── server Next.js :3000 ◄── browser (login)
                   (freedom-finger install)       menyimpan token API      tidak pernah melihat token
```

Isinya sama dengan [`examples/bun-web`](../bun-web) (server Bun, halaman tanpa framework); pilih yang
cocok dengan tim Anda. Contoh ini menunjukkan cara yang lazim di Next.js: route handler untuk API,
server action untuk login dan kelola user, dan komponen React per menu.

## Differences from the desktop app

| Hal | Desktop | Web |
|---|---|---|
| Masuk | Satu kata sandi untuk PC itu | User dan kata sandi per orang; semua user setara, dikelola di Pengaturan |
| Server Freedom Finger | Tertanam di aplikasi | Terpisah, dipasang dengan `freedom-finger install` |
| Data aplikasi | `aplikasi.json` di PC | `aplikasi.json` dan `users.json` di `DATA_DIR` server web |
| Export dan cetak | Dialog simpan dan cetak OS | Unduhan dan dialog cetak browser |
| Backup | Menu Backup | Tidak ada: backup database dengan `freedom-finger backup FILE`, dan salin `DATA_DIR` |
| Update | Otomatis dari rilis GitHub | Ambil kode baru, `npm run build`, lalu mulai ulang |
| Absen selama PC mati | Ditarik saat aplikasi dibuka | Tidak perlu: server menyala terus |

Beberapa orang bisa membuka aplikasi bersamaan. Data aplikasi diambil ulang tiap menit, dan bila
dua orang menyimpan perubahan hampir bersamaan, yang kedua ditolak dengan pesan dan diminta mengulang,
supaya perubahan orang pertama tidak tertimpa.

## Run

Butuh Node.js 20.9+ dan server Freedom Finger yang sudah berjalan.

```sh
cd examples/next-web
npm install
cp .env.example .env     # isi FREEDOM_FINGER_TOKEN dengan FKWEB_TOKEN dari freedom-finger.env
npm run dev              # http://localhost:3000, muat ulang sendiri saat kode berubah
```

Buka halamannya, lalu buat user pertama. Halaman pembuatan user pertama hanya muncul selama belum ada
user, jadi buat segera setelah server web dinyalakan.

Untuk dipakai sehari-hari: `npm run build` sekali, lalu `npm start` (bawaan port 3000; port lain:
`PORT=8080 npm start`), dijalankan sebagai layanan (systemd di Linux, NSSM atau Task Scheduler di
Windows) supaya hidup lagi setelah restart. Jalankan satu proses saja: sesi login dan antrean simpan
ada di memori proses itu.

| Variabel | Bawaan | Isi |
|---|---|---|
| `FREEDOM_FINGER_URL` | `http://localhost:8013` | Alamat server Freedom Finger |
| `FREEDOM_FINGER_TOKEN` | wajib | `FKWEB_TOKEN` dari `freedom-finger.env` |
| `DATA_DIR` | `./data` | Folder `aplikasi.json` dan `users.json` |
| `PORT` | `3000` | Port halaman web; isi lewat environment, bukan `.env` (Next.js memilih port sebelum membaca `.env`) |

Pindah dari aplikasi desktop atau dari `bun-web`: salin `aplikasi.json` ke `DATA_DIR` sebelum server
web dinyalakan. Kata sandi desktop di file itu diabaikan. `users.json` dari `bun-web` tidak bisa
dipakai (hash kata sandinya berbeda): buat user lagi.

Lupa semua kata sandi: hentikan server web, hapus `DATA_DIR/users.json`, nyalakan lagi, lalu buat
user pertama lagi. Data absen dan aplikasi tidak ikut terhapus.

## Security

- Token API hanya ada di server web. Browser memanggil `/api/ff/<endpoint>` dan server web
  meneruskannya dengan token, hanya untuk user yang sudah login. Setiap route handler dan server
  action memeriksa sesi sendiri; layout yang mengalihkan ke `/login` hanya untuk kenyamanan.
- Kata sandi disimpan sebagai hash scrypt (`node:crypto`, tanpa dependency) di `users.json` (izin
  file 600). Lima kali salah berturut-turut mengunci user itu 5 menit.
- Sesi memakai cookie `HttpOnly` dan `SameSite=Strict`, berakhir setelah 12 jam tidak dipakai, saat
  keluar, saat kata sandi diganti (perangkat lain), atau saat user dihapus. Sesi disimpan di memori:
  server web dimulai ulang = semua orang login lagi.
- Tanpa HTTPS. Pakai di jaringan kantor; bila dibuka dari luar kantor, pasang di balik reverse proxy
  dengan HTTPS (Caddy, nginx) dan jangan buka port 8013 maupun 3000 langsung ke internet.

## Code layout

Setiap file paling banyak ±300 baris. Kode server ada di `lib/server` dan tidak pernah sampai ke
browser (`import 'server-only'`); halaman hanya memakai `/api/*` dan server action.

```text
app/
├── layout.tsx               kerangka HTML, huruf, CSS
├── login/                   layar login dan pembuatan user pertama (server action signIn)
├── (aplikasi)/              semua menu; layout.tsx: cek sesi, sidebar, provider state
│   ├── hari-ini/ riwayat/ rekap/ izin/          satu folder per menu: page.tsx dan bagian-bagiannya
│   ├── karyawan/ jam-kerja/ libur/ mesin/
│   └── pengaturan/          server component: daftar user dibaca langsung di server
└── api/
    ├── ff/[endpoint]/       POST: API Freedom Finger dengan token dari server
    ├── ff/events/           GET: event realtime (SSE) diteruskan
    ├── data/                GET/PUT aplikasi.json dengan pemeriksaan bentrok (rev)
    ├── status/              IP dan port server Freedom Finger (isian menu mesin)
    └── xlsx/                export Excel
components/
├── aplikasi.tsx             state bersama: data aplikasi, mesin, user di mesin, event realtime, simpan
├── tugas.tsx                kerja di latar: ambil data karyawan, perintah perawatan mesin
├── ui.tsx                   pesan singkat, dialog tanya, layar tunggu
├── laci.tsx                 laci (modal) untuk form dan rincian
├── samping.tsx              sidebar
├── form-catatan.tsx         form izin dan koreksi (dipakai Hari ini, Rekap, Izin)
├── panduan.tsx, cari-mesin.tsx   panduan hubungkan mesin, cari mesin di jaringan
└── tanggal.tsx, halaman.tsx, isian.tsx, ikon.tsx
lib/
├── server/                  config, sesi (cookie), auth (user, scrypt, kunci), data (rev), proxy, xlsx, actions
├── rekap.ts                 aturan rekap, fungsi murni (+ rekap.test.ts)
├── rekap-app.ts             rekap untuk data aplikasi ini (jadwal per karyawan, karyawan baru/dihapus)
├── api.ts                   fetch ke server web, perintah ke mesin, event realtime
├── data.ts                  bentuk aplikasi.json dan karyawan
├── format.ts, export.ts, types.ts
styles/                      CSS yang sama dengan bun-web, dimuat berurutan di app/layout.tsx
```

```sh
npm test         # aturan rekap, user, sesi, dan simpan bentrok (node --test)
npm run check    # periksa tipe TypeScript
npm run build    # build produksi
```

Halaman disalin dari [`examples/bun-web`](../bun-web) dan ditulis ulang sebagai komponen React.
Fitur halaman yang baru di desktop perlu disalin ke sini juga.
