# Freedom Finger desktop app

Aplikasi desktop untuk pengguna: server absensi dan dashboard absen hari ini dalam satu
aplikasi. Kodenya sekaligus contoh pemakaian SDK. Sisi Rust menanam server lewat
`freedom_finger::serve()`, dan halaman memanggil API HTTP-nya dengan `fetch` biasa
([`docs/api.md`](../../docs/api.md)), sama seperti aplikasi lain. Installer siap pakai ada di
[Releases](https://github.com/mazWaz/freedom-finger/releases/latest).

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

Data (pengaturan, token, database) ada di folder data aplikasi, misalnya
`%APPDATA%\io.github.mazwaz.freedom-finger-dashboard` di Windows.

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
```

Port 8013 sudah dipakai (misalnya layanan `freedom-finger install`)? Jalankan dengan
`FKWEB_PORT=8014 npm run tauri dev`, lalu `FKWEB_PORT=8014 npm run simulasi`. Mode dev tidak
mendaftarkan autostart. Installer dibuat oleh `.github/workflows/release.yml` (job `app`).

| File | Isi |
|---|---|
| `src-tauri/src/main.rs` | Server tertanam, tray, autostart, satu instans; perintah `server` dan `lan_ip` untuk halaman |
| `src/main.js` | Daftar absen hari ini (`get_devices`, `get_attlog`), event realtime, `sync_attlog` saat start, isian menu dan peringatan IP |
| `src-tauri/windows/hooks.nsh` | Aturan firewall saat install dan uninstall di Windows |
| `simulasi.mjs` | Mesin tiruan untuk developer: satu absen FkWeb ke server |
