# Tauri dashboard example

Aplikasi desktop yang sekaligus menjadi server Freedom Finger dan dashboard absen hari ini,
realtime. Sisi Rust menjalankan `freedom_finger::serve()` di dalam aplikasi. Halaman memakai
paket JS `freedom-finger` (`connect()` dan `events()`), sama seperti aplikasi lain.

## Run

Butuh Node 20+, Rust, dan [prasyarat Tauri](https://tauri.app/start/prerequisites/) untuk OS
Anda (Linux: `libwebkit2gtk-4.1-dev` dkk.; Windows: WebView2, sudah ada di Windows 10/11).

```sh
cd examples/tauri-dashboard
npm install
npm run tauri dev        # build pertama beberapa menit
```

Jendela "Absen hari ini" terbuka. Terminal menampilkan isian menu mesin (Mode Internet,
Server IP, Server Port 8013). Belum punya mesin? Kirim absen tiruan dari terminal lain:

```sh
npm run simulasi         # absen baru muncul di daftar dalam kurang dari 1 detik
```

Port 8013 sudah dipakai (misalnya layanan `freedom-finger install`)? Jalankan dengan
`FKWEB_PORT=8014 npm run tauri dev`, lalu `FKWEB_PORT=8014 npm run simulasi`.

| File | Isi |
|---|---|
| `src-tauri/src/main.rs` | Menjalankan server; perintah `server` memberi alamat dan token ke halaman |
| `src/main.js` | Daftar absen hari ini; tiap event `attlog` memuat ulang daftar |
| `simulasi.mjs` | Mesin tiruan: satu absen FkWeb ke server |
