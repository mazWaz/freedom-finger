# Freedom Finger

Server absensi lokal untuk mesin Fingerspot Revo WF-206BNC: tanpa cloud dan tanpa biaya
langganan. Mesin mengirim data langsung ke komputer Anda, lalu aplikasi Anda mengambilnya
lewat API yang bentuknya sama dengan developer.fingerspot.io.

> Freedom Finger adalah proyek independen dan tidak berafiliasi dengan Fingerspot.
> "Fingerspot" disebut hanya untuk menjelaskan mesin yang didukung.

## Quick start

1. Unduh file untuk komputer server dari [Releases](https://github.com/mazWaz/freedom-finger/releases),
   lalu ekstrak: Windows `…-x86_64-pc-windows-msvc.zip`, Linux `…-x86_64-unknown-linux-musl.tar.gz`
   (ARM64: `aarch64-unknown-linux-musl`), Mac `…-aarch64-apple-darwin.tar.gz` (Intel: `x86_64-apple-darwin`).
2. Pasang sebagai layanan, dengan hak admin:
   ```sh
   sudo ./freedom-finger install          # Linux, macOS
   .\freedom-finger.exe install           # Windows, terminal "Run as administrator"
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

Program belum bertanda tangan. Windows: bila muncul "Windows protected your PC", klik
**More info → Run anyway**. macOS: jalankan sekali `xattr -d com.apple.quarantine freedom-finger`.

Tidak ada file yang perlu diedit: token API dibuat otomatis di `freedom-finger.env`.
Tidak tahu IP mesin? `freedom-finger cari` mencarinya di jaringan lokal.

## For developers

Aplikasi Anda memanggil API di `http://<server>:8013/api/…` dengan token dari `freedom-finger.env`.
Untuk JavaScript (Node, Electron, Tauri, browser) ada paket [`packages/js`](packages/js):

```js
import { connect } from 'freedom-finger';

const ff = connect({ url: 'http://localhost:8013', token: '<FKWEB_TOKEN>' });
for await (const e of ff.events()) if (e.type === 'attlog') console.log(e.data.pin, e.data.scan);
```

Contoh lengkap: [`examples/tauri-dashboard`](examples/tauri-dashboard), aplikasi desktop yang
sekaligus server dan dashboard absen realtime, lengkap dengan mesin tiruan. Spesifikasi API:
[`docs/openapi.yaml`](docs/openapi.yaml).

## Commands

| Perintah | Isi |
|---|---|
| `freedom-finger` | Jalankan server di terminal (folder data = folder program, atau `--data <folder>`) |
| `freedom-finger install` / `uninstall` | Pasang atau lepas layanan; data tidak pernah dihapus |
| `freedom-finger status` | Server berjalan? Mesin terhubung? Jumlah absen |
| `freedom-finger cari` | Cari mesin di jaringan lokal, beserta petunjuk untuk tiap mesin |
| `freedom-finger mesin …` | Perintah langsung ke mesin di mode Lokal: `log`, `jam`, `list`, `add`, `edit`, `delete` |

| Folder | Isi |
|---|---|
| `crates/freedom-finger` | Program dan library server: menerima data mesin, API bergaya developer.fingerspot.io, SQLite |
| `crates/freedom-finger-sdk` | SDK: protokol TCP 5005 (mode Lokal) dan FkWeb (mode Internet) |
| `packages/js` | Paket npm `freedom-finger`: klien bertipe, event realtime, menjalankan server di samping aplikasi |
| `examples/tauri-dashboard` | Contoh aplikasi desktop: server tertanam + dashboard absen realtime |

## Build and test

Hanya perlu bila tidak memakai file rilis. Butuh [rustup](https://rustup.rs); versi Rust dipasang
otomatis dari `rust-toolchain.toml`. Rilis dibuat oleh `.github/workflows/release.yml` saat tag
`v*` di-push.

```sh
cargo build --release     # target/release/freedom-finger
cargo test --workspace    # uji offline, tanpa mesin
node packages/js/test.mjs # paket JS dengan mesin simulasi
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

Contoh pemakaian API ada di `docs/operasional.md` bagian 3; spesifikasinya di `docs/openapi.yaml`.
Absen baru dan hasil perintah juga bisa diterima realtime lewat `GET /api/events` (SSE).

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
| `docs/openapi.yaml` | Spesifikasi API (OpenAPI 3.1) |
| `docs/protokol.md` | Spesifikasi TCP 5005 dan FkWeb, test vector |
| `docs/riset.md` | Laporan riset dan riwayat keputusan |

## License

Dual license [MIT](LICENSE-MIT) atau [Apache-2.0](LICENSE-APACHE), pilih salah satu.
