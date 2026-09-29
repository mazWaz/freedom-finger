# Freedom Finger desktop app

Aplikasi desktop untuk pengguna: server absensi dan aplikasi absensi (absen hari ini, riwayat,
rekap bulanan, export Excel, backup) dalam satu aplikasi. Kodenya sekaligus contoh pemakaian SDK. Sisi Rust menanam server lewat
`freedom_finger::serve()`, dan halaman memanggil API HTTP-nya dengan `fetch` biasa
([`docs/api.md`](../../docs/api.md)), sama seperti aplikasi lain. Installer siap pakai ada di
[Releases](https://github.com/mazWaz/freedom-finger/releases/latest).

## Tabs

| Tab | Isi |
|---|---|
| Hari ini | Absen hari ini secara realtime, status mesin, isian menu mesin |
| Riwayat | Semua scan per rentang tanggal; cari nama atau PIN; pilih mesin; export Excel/CSV dan cetak |
| Rekap | Per karyawan per bulan: hadir, terlambat, pulang cepat, lupa absen pulang, alpa, jam kerja, lembur; klik untuk rincian per hari |
| Karyawan | Ambil data karyawan dari mesin; nama lengkap, departemen, jadwal, dan ikut rekap |
| Pengaturan | Nama kantor, jam kerja per hari (jadwal utama dan jadwal lain, mis. paruh waktu), toleransi, batas lembur, hari libur, backup dan pulihkan |

Aturan rekap: scan pertama = masuk, scan terakhir = pulang bila minimal 60 menit sesudahnya
(tombol Masuk/Pulang di mesin diabaikan); menit terlambat dihitung dari jam masuk; hari ini
belum dihitung. Semua aturan ada di `src/hitung-rekap.js` dan diuji dengan `npm test`.

## Behavior

Aplikasi dirancang untuk PC yang hanya menyala di jam kantor, bukan server 24 jam.

| Hal | Perilaku |
|---|---|
| Jalan otomatis | Saat login, aplikasi mulai di tray tanpa jendela (build rilis) |
| Tutup jendela | Jendela disembunyikan ke tray; server tetap menerima absen. Keluar lewat menu tray |
| Dibuka dua kali | Jendela yang sudah ada dimunculkan; tidak ada server kedua |
| Absen selama PC mati | Mesin menyimpannya. Saat aplikasi start, `sync_attlog` menarik semua log dalam ±2 menit |
| Isian menu mesin | Ditampilkan di bawah daftar absen, dengan IP PC ini dan port |
| IP PC berubah | Peringatan bila mesin tidak lagi terhubung dan IP berbeda dari saat terakhir terhubung |
| Firewall Windows | Installer (NSIS, butuh admin) membuka TCP 8013 untuk jaringan lokal; uninstall menutupnya |
| Backup | Otomatis sekali sehari saat aplikasi pertama kali hidup, ke folder `Freedom Finger Backup` di folder pengguna (bukan Dokumen, yang sering disinkronkan OneDrive); 30 terakhir disimpan |
| Pulihkan | Database diganti saat aplikasi mulai ulang; data sebelumnya disimpan sebagai `absensi-sebelum-pulih.db` di folder data |

Data ada di folder data aplikasi, misalnya `%APPDATA%\io.github.mazwaz.freedom-finger-dashboard`
di Windows: `absensi.db` milik server (log mesin, tidak pernah diubah aplikasi), `aplikasi.json`
milik aplikasi (nama lengkap, jam kerja, libur; ditulis atomik), dan `freedom-finger.env` (token).
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

| File | Isi |
|---|---|
| `src-tauri/src/main.rs` | Server tertanam, tray, autostart, satu instans; perintah untuk halaman: `aplikasi.json`, export .xlsx/CSV, backup, pulihkan, cetak |
| `src/main.js` | Mulai: tunggu server, event realtime, `sync_attlog` saat start, backup otomatis, pindah tab |
| `src/app.js` | Bersama: `fetch` ke API, `get_users` untuk nama, `aplikasi.json`, tanggal, export |
| `src/hitung-rekap.js` | Aturan rekap, fungsi murni tanpa DOM; diuji `src/hitung-rekap.test.js` (`npm test`) |
| `src/hari-ini.js`, `riwayat.js`, `rekap.js`, `karyawan.js`, `pengaturan.js` | Satu modul per tab. `karyawan.js`: `get_all_pin` lalu `get_userinfo` per PIN baru, berlanjut walau aplikasi ditutup |
| `src-tauri/windows/hooks.nsh` | Aturan firewall saat install dan uninstall di Windows |
| `simulasi.mjs` | Mesin tiruan untuk developer: satu absen FkWeb ke server |
