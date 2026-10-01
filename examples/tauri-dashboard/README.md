# Freedom Finger desktop app

Aplikasi desktop untuk pengguna: server absensi dan aplikasi absensi (absen hari ini, riwayat,
rekap bulanan, izin dan koreksi absen, perawatan mesin, export Excel, backup) dalam satu aplikasi. Kodenya sekaligus contoh pemakaian SDK. Sisi Rust menanam server lewat
`freedom_finger::serve()`, dan halaman memanggil API HTTP-nya dengan `fetch` biasa
([`docs/api.md`](../../docs/api.md)), sama seperti aplikasi lain. Installer siap pakai ada di
[Releases](https://github.com/mazWaz/freedom-finger/releases/latest).

## Tabs

| Tab | Isi |
|---|---|
| Hari ini | Sebaran jam scan (arahkan kursor ke titik untuk nama; garis jam masuk/pulang semua jadwal). Papan absen: satu kartu per karyawan (tepat waktu, terlambat, izin, belum datang), bisa disaring per status, dicari, dan dibagi per halaman. Kartu dibuka untuk rincian (dengan foto karyawan bila mesin pernah mengirimnya) dan untuk mencatat izin atau koreksi absen dengan nama dan tanggal sudah terisi. Semua scan hari ini secara realtime (terlipat, dengan cari dan halaman); isian menu mesin |
| Riwayat | Per hari: daftar hadir, karyawan ke bawah dan tanggal ke samping, sel berwarna menurut hitungan Rekap (terlambat, izin/sakit/cuti/dinas, tidak masuk, libur, tanpa absen pulang, koreksi manual). Semua scan: tiap scan per hari, termasuk koreksi manual; pilih mesin. Keduanya: rentang tanggal dengan pilihan cepat (1 minggu, 1–6 bulan, …), cari nama atau PIN, export Excel/CSV dan cetak |
| Rekap | Per karyawan per bulan: strip harian (hadir, terlambat, alpa, izin, libur), hadir, terlambat, pulang cepat, lupa absen pulang, alpa, izin/sakit/cuti/dinas, jam kerja, lembur; klik untuk rincian per hari |
| Izin & koreksi | Izin, sakit, cuti, dinas luar (satu hari atau rentang, dengan keterangan); koreksi absen untuk yang lupa scan (jam dan alasan wajib). Form di modal, juga dari kartu di Hari ini. Bisa diubah dan dihapus |
| Karyawan | Ambil data karyawan dari mesin; tambah karyawan ke mesin (PIN dicek dulu di mesin supaya tidak menimpa orang lain); nama lengkap, departemen, jadwal, dan ikut rekap. Per karyawan (tombol bergambar mesin di kolom Terdaftar di mesin): lihat yang terdaftar (jari, wajah, kartu, password); ubah nama di mesin (maks. 15 huruf) dan hak admin mesin; daftarkan wajah, jari, kartu (ditempelkan di mesin), atau password (diketik di mesin), dengan layar daftar yang terbuka sendiri di mesin; hapus dari mesin (riwayat absen tetap ada, hari sesudahnya tidak dihitung alpa, PIN-nya tidak dipakai lagi). Karyawan yang dihapus bisa dipulihkan dari cadangan: nama, hak akses, jari, wajah, kartu, password, dan foto kembali ke mesin (PIN dicek dulu di mesin) |
| Mesin | Per mesin: Cloud ID, IP, terakhir aktif, jam mesin dibanding jam PC, firmware; setel jam, tarik ulang semua log, restart (perintah yang menunggu mesin tetap tampil setelah aplikasi dibuka ulang); cari mesin di jaringan |
| Jam kerja | Jam kerja per hari (jadwal utama dan jadwal lain, mis. paruh waktu, masing-masing dengan warna yang tampil sebagai tanda jadwal di Hari ini) dengan sakelar lembur per hari (hari kerja: sesudah jam pulang; hari libur: seluruh jam kerja) dan lembur maksimal per hari (jam; kosong = tanpa batas), toleransi terlambat, batas menit lembur, jarak scan pulang |
| Hari libur | Tanggal libur kantor dan keterangannya |
| Backup | Folder backup, backup sekarang, pulihkan dari backup |
| Pengaturan | Nama kantor dan kata sandi |

Aturan rekap: karyawan dihitung mulai hari pertama ada (scan pertama, ditambahkan lewat aplikasi, izin, atau koreksi), jadi karyawan baru tidak alpa sebelum mulai; scan pertama = masuk, scan terakhir = pulang bila minimal 60 menit sesudahnya
(tombol Masuk/Pulang di mesin diabaikan); menit terlambat dihitung dari jam masuk; hari ini
belum dihitung; hari dengan izin/sakit/cuti/dinas bukan alpa; koreksi manual dihitung seperti scan. Semua aturan
ada di `src/lib/hitung-rekap.js` dan diuji dengan `npm test`.

## Behavior

Aplikasi dirancang untuk PC yang hanya menyala di jam kantor, bukan server 24 jam.

| Hal | Perilaku |
|---|---|
| Jalan otomatis | Saat login, aplikasi mulai di tray tanpa jendela (build rilis) |
| Tutup jendela | Jendela disembunyikan ke tray; server tetap menerima absen. Keluar lewat menu tray |
| Dibuka dua kali | Jendela yang sudah ada dimunculkan; tidak ada server kedua |
| Ukuran layar | Jendela dibuka 90% layar, di tengah; layar kecil (720p, 1366×768) penuh. Layar 4K dengan skala 100%: tampilan diperbesar 1,5×. Ctrl + / Ctrl − / Ctrl 0 untuk memperbesar, memperkecil, dan mengembalikan |
| Absen selama PC mati | Mesin menyimpannya. Saat aplikasi start, `sync_attlog` menarik semua log dalam ±2 menit |
| Isian menu mesin | Ditampilkan di bawah daftar absen selama ada mesin yang belum/tidak terhubung, dengan IP PC ini dan port |
| IP PC berubah | Peringatan bila mesin tidak lagi terhubung dan IP berbeda dari saat terakhir terhubung |
| Firewall Windows | Installer (NSIS, butuh admin) membuka TCP 8013 untuk jaringan lokal; uninstall menutupnya |
| Backup | Otomatis sekali sehari saat aplikasi pertama kali hidup, ke folder `Freedom Finger Backup` di folder pengguna (bukan Dokumen, yang sering disinkronkan OneDrive); 30 terakhir disimpan |
| Kata sandi | Dibuat saat aplikasi pertama kali dibuka; diminta setiap aplikasi dibuka, lewat tombol Kunci aplikasi, dan setelah jendela tersembunyi lebih dari 5 menit. Selama terkunci server tetap menerima absen. Lupa kata sandi: tutup aplikasi, hapus bagian `auth` di `aplikasi.json`, lalu buka lagi dan buat kata sandi baru |
| Ubah nama atau admin | Data terbaru diambil dulu dari mesin (`get_userinfo`), lalu dikirim ulang bersama nama dan hak akses baru, karena `set_userinfo` mengganti seluruh data user. Sesudahnya dibaca lagi untuk memastikan jari, wajah, kartu, dan password tetap. Nama lengkap di aplikasi tidak berubah |
| Menunggu mesin | Selama perintah menunggu jawaban mesin (tab Karyawan dan Mesin, juga Cari mesin), layar tunggu dengan spinner, langkah yang sedang berjalan, dan lama menunggu mengunci seluruh halaman; Esc tidak menutupnya. Ambil data dari mesin tidak mengunci halaman, karena bisa belasan menit dan tetap berjalan di latar |
| Mesin menolak atau terputus | Layar tunggu hilang, lalu pesannya tampil di modal: mesin sedang dipakai (menu terbuka), menolak isi perintah, atau terputus (±3–4 menit tanpa kabar). Perintah untuk mesin yang terputus tetap mengantre di server dan dijalankan saat mesin tersambung lagi |
| Pulihkan | Database diganti saat aplikasi mulai ulang; kata sandi yang sekarang tetap dipakai; data sebelumnya disimpan sebagai `absensi-sebelum-pulih.db` di folder data |

Data ada di folder data aplikasi, misalnya `%APPDATA%\io.github.mazwaz.freedom-finger-dashboard`
di Windows: `absensi.db` milik server (log mesin, tidak pernah diubah aplikasi), `aplikasi.json`
milik aplikasi (nama lengkap, jam kerja, libur, izin, koreksi absen; ditulis atomik). Koreksi absen tidak pernah
ditulis ke mesin atau `absensi.db`, supaya log asli mesin tetap utuh sebagai bukti, dan `freedom-finger.env` (token).
Backup berisi data sidik jari dan wajah: simpan di tempat yang aman.

## Run from source

Butuh Node 20+, Rust, dan [prasyarat Tauri](https://tauri.app/start/prerequisites/) untuk OS
Anda (Linux: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev` dkk.; Windows: WebView2,
sudah ada di Windows 10/11).

```sh
cd examples/tauri-dashboard
npm install
npm run tauri dev        # build pertama beberapa menit dan butuh ±4 GB ruang disk
```

Belum punya mesin? Kirim absen tiruan dari terminal lain:

```sh
npm run simulasi         # absen baru muncul di daftar dalam kurang dari 1 detik
npm test                 # uji aturan rekap (Node 20+, tanpa build)
```

Port 8013 sudah dipakai (misalnya layanan `freedom-finger install`)? Jalankan dengan
`FKWEB_PORT=8014 npm run tauri dev`, lalu `FKWEB_PORT=8014 npm run simulasi`. Mode dev tidak
mendaftarkan autostart. Installer dibuat oleh `.github/workflows/release.yml` (job `app`).

Struktur folder mengikuti template resmi Tauri v2: halaman (Vite, JavaScript tanpa framework) di
`src/`, sisi Rust di `src-tauri/`.

```text
index.html                 kerangka halaman: sidebar dan isi semua menu
src/
├── main.js                mulai: tunggu server, event realtime, sync_attlog saat start, pindah menu
├── styles.css             tampilan, termasuk tampilan cetak (@media print)
├── pages/                 satu file per menu di sidebar
├── components/            bagian layar yang dipakai banyak menu: tanggal.js, kunci.js
└── lib/                   kode bersama tanpa tampilan sendiri
    ├── api.js             server: fetch ke API, perintah ke mesin, event realtime, mesin/user/log
    ├── data.js            aplikasi.json dan data karyawan (nama, bagian, jadwal)
    ├── format.js          tanggal dan jam untuk tampilan, rentang cepat
    ├── ui.js              $, esc, pesan, laci (modal), layar tunggu, halaman tabel
    ├── export.js          export .xlsx/CSV dan cetak
    └── hitung-rekap.js    aturan rekap, fungsi murni tanpa DOM (+ .test.js, npm test)
src-tauri/
├── src/main.rs            titik masuk, hanya memanggil lib.rs
├── src/lib.rs             rakit aplikasi: server tertanam, tray, autostart, satu instans, ukuran jendela
└── src/commands/          perintah untuk halaman (invoke), satu file per topik:
                           server, data (aplikasi.json), export, backup (+ pulihkan), update
```

| File | Isi |
|---|---|
| `src/pages/*.js` | `hari-ini`, `riwayat`, `rekap`, `izin`, `karyawan`, `mesin`, `pengaturan`. `pengaturan.js` melayani Jam kerja, Hari libur, Backup, dan Pengaturan. `karyawan.js`: `get_all_pin` lalu `get_userinfo` per PIN baru, berlanjut walau aplikasi ditutup |
| `src/components/tanggal.js` | Pemilih tanggal dan rentang untuk semua `<input type="date">`: tampil "1 Januari 2026" dengan kalender berbahasa Indonesia, apa pun bahasa OS |
| `src/components/kunci.js` | Layar kunci dan kata sandi (hash PBKDF2 lewat WebCrypto, disimpan di `aplikasi.json`) |
| `src-tauri/windows/hooks.nsh` | Aturan firewall saat install dan uninstall di Windows |
| `simulasi.mjs` | Mesin tiruan untuk developer: satu absen FkWeb ke server |
