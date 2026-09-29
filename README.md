# Freedom Finger

Absensi lokal untuk mesin Fingerspot Revo WF-206BNC: tanpa cloud dan tanpa biaya langganan.
Mesin mengirim absen langsung ke komputer Anda. Ada dua produk:

| Produk | Untuk | Isi |
|---|---|---|
| **Aplikasi desktop** | Pengguna (kantor, admin HR) | Installer siap pakai: server absensi, absen hari ini, riwayat, rekap bulanan, export Excel, dan backup dalam satu aplikasi |
| **SDK** | Developer yang memasang dan mengintegrasikan sendiri | Program server `freedom-finger`, API bergaya developer.fingerspot.io, crate Rust |

> Freedom Finger adalah proyek independen dan tidak berafiliasi dengan Fingerspot.
> "Fingerspot" disebut hanya untuk menjelaskan mesin yang didukung.

## Quick start

1. Unduh installer dari [Releases](https://github.com/mazWaz/freedom-finger/releases/latest):
   Windows `freedom-finger-desktop-windows-x64-setup.exe`, Mac `freedom-finger-desktop-macos.dmg`,
   Linux `freedom-finger-desktop-linux-x64.deb` atau `.AppImage`.
2. Pasang, lalu buka **Freedom Finger**. Aplikasi jalan sendiri setiap login dan tetap di tray
   walau jendelanya ditutup.
3. Isi menu mesin (**Menu → Jaringan**) persis seperti petunjuk di bawah daftar absen. Mesin
   muncul dalam ±2 menit, dan absen baru langsung tampil.
4. Di tab **Karyawan**, tekan **Ambil data karyawan dari mesin**, lalu isi jam kerja kantor di
   **Pengaturan**. Tab **Rekap** menghitung hadir, terlambat, alpa, jam kerja, dan lembur per bulan.

PC tidak perlu menyala 24 jam. Selama PC mati, mesin menyimpan absen; saat aplikasi hidup lagi,
semua absen ditarik dari mesin dalam ±2 menit. Minta admin jaringan **mereservasi IP PC ini di
router**, karena mesin mengirim ke IP yang tetap; aplikasi memberi peringatan bila IP berubah.

Installer belum bertanda tangan. Windows: bila muncul "Windows protected your PC", klik
**More info → Run anyway**. macOS: bila aplikasi ditolak, jalankan
`xattr -cr "/Applications/Freedom Finger.app"` di Terminal.

## For developers

### Server program

Untuk server 24 jam atau integrasi sendiri, pasang program `freedom-finger` sebagai layanan:

1. Unduh satu file dari [Releases](https://github.com/mazWaz/freedom-finger/releases/latest):
   Windows `freedom-finger.exe`; Linux `freedom-finger-linux-x64` (ARM64: `freedom-finger-linux-arm64`);
   Mac `freedom-finger-macos-arm64` (Intel: `freedom-finger-macos-x64`).
2. Pasang sebagai layanan, dengan hak admin:
   ```sh
   .\freedom-finger.exe install                  # Windows, terminal "Run as administrator"
   chmod +x freedom-finger-linux-x64            # Linux, macOS: sesuaikan nama file
   sudo ./freedom-finger-linux-x64 install
   ```
3. Isi menu mesin persis seperti yang tampil di layar, lalu buka `http://localhost:8013`
   untuk melihat mesin terhubung dan jumlah absen hari ini.

```text
✓ Terpasang di C:\FreedomFinger, jalan otomatis saat komputer menyala
✓ Firewall: port 8013 dibuka untuk jaringan lokal

Atur di mesin absensi (Menu → Jaringan):
  Mode         Internet
  Server IP    192.168.1.10
  Server Port  8013
  Server Req   Ya
```

Tidak ada file yang perlu diedit: token API dibuat otomatis di `freedom-finger.env`. Tidak tahu
IP mesin? `freedom-finger cari` mencarinya di jaringan lokal. macOS/Linux: program unduhan perlu
`chmod +x`, dan di macOS juga `xattr -d com.apple.quarantine <file>`.

### API

Aplikasi Anda (bahasa apa pun) memanggil `http://<server>:8013/api/<endpoint>` dengan header
`Authorization: Bearer <token>`; tokennya ada di `freedom-finger.env`. Absen baru dan hasil
perintah bisa diterima realtime lewat `GET /api/events`.

```sh
curl -s http://localhost:8013/api/get_attlog -H "Authorization: Bearer $TOKEN" \
  -d '{"start_date":"2026-09-29","end_date":"2026-09-29"}'
```

| Dokumen | Isi |
|---|---|
| [`docs/api.md`](docs/api.md) | Semua endpoint, contoh request dan balasan, event realtime, contoh JavaScript tanpa pustaka |
| [`docs/openapi.yaml`](docs/openapi.yaml) | Spesifikasi OpenAPI 3.1, untuk Swagger UI atau generator klien |
| [`examples/tauri-dashboard`](examples/tauri-dashboard) | Kode aplikasi desktop: contoh menanam server di aplikasi Rust dan memakai API-nya |

## Commands

| Perintah | Isi |
|---|---|
| `freedom-finger` | Jalankan server di terminal (folder data = folder program, atau `--data <folder>`) |
| `freedom-finger install` / `uninstall` | Pasang atau lepas layanan; data tidak pernah dihapus |
| `freedom-finger status` | Server berjalan? Mesin terhubung? Jumlah absen |
| `freedom-finger cari` | Cari mesin di jaringan lokal, beserta petunjuk untuk tiap mesin |
| `freedom-finger backup FILE` | Salin database ke `FILE`, aman saat server berjalan. Isinya termasuk data jari/wajah: simpan di tempat aman |
| `freedom-finger mesin …` | Perintah langsung ke mesin di mode Lokal: `log`, `jam`, `list`, `add`, `edit`, `delete` |

| Folder | Isi |
|---|---|
| `crates/freedom-finger` | Program dan library server: menerima data mesin, API bergaya developer.fingerspot.io, SQLite |
| `crates/freedom-finger-sdk` | SDK: protokol TCP 5005 (mode Lokal) dan FkWeb (mode Internet) |
| `examples/tauri-dashboard` | Aplikasi desktop untuk pengguna, sekaligus contoh dan demo: server tertanam, riwayat, rekap, export, backup |

## Build and test

Hanya perlu bila tidak memakai file rilis. Butuh [rustup](https://rustup.rs); versi Rust dipasang
otomatis dari `rust-toolchain.toml`. Rilis dibuat oleh `.github/workflows/release.yml` saat tag
`v*` di-push.

```sh
cargo build --release     # target/release/freedom-finger
cargo test --workspace    # uji offline, tanpa mesin
```

## Settings

Semua opsional. Server membaca `freedom-finger.env` di folder data; variabel environment
menang bila keduanya ada.

| Variabel | Bawaan | Isi |
|---|---|---|
| `FKWEB_TOKEN` | dibuat otomatis | Token Bearer untuk `/api/*`, minimal 16 karakter |
| `FKWEB_PORT` | `8013` | Port untuk mesin dan API |
| `FKWEB_DB` | `absensi.db` | Database SQLite, relatif ke folder data |
| `FKWEB_TZ` | `Asia/Jakarta` | Zona jam mesin |
| `FKWEB_DEVICES` | semua | Cloud ID mesin yang diterima, pisah koma |
| `FKWEB_WEBHOOK` | - | URL penerima callback |
| `FKWEB_PHOTOS` | `photos` | Folder foto absen, relatif ke folder data |

Dokumentasi API: `docs/api.md`.

## Local mode commands

`freedom-finger mesin …` hanya jalan saat mesin di mode **Lokal**; selama itu server tidak
menerima data.

```sh
freedom-finger mesin --host 192.168.1.201 list
freedom-finger mesin --host 192.168.1.201 log > absensi.csv
freedom-finger mesin --help    # semua perintah dan variabel FK_*
```

## Documents

| File | Isi |
|---|---|
| `docs/arsitektur.md` | Susunan kode, keputusan, cara menambah perintah dan endpoint |
| `docs/operasional.md` | Menjalankan server, API, pekerjaan sehari-hari, masalah umum |
| `docs/api.md` | API untuk aplikasi: endpoint, contoh, event realtime |
| `docs/openapi.yaml` | Spesifikasi API (OpenAPI 3.1) |
| `docs/protokol.md` | Spesifikasi TCP 5005 dan FkWeb, test vector |
| `docs/riset.md` | Laporan riset dan riwayat keputusan |

## License

Dual license [MIT](LICENSE-MIT) atau [Apache-2.0](LICENSE-APACHE), pilih salah satu.
