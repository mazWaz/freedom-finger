# Freedom Finger

Server absensi lokal untuk mesin Fingerspot Revo WF-206BNC: tanpa cloud dan tanpa biaya
langganan. Mesin mengirim data langsung ke komputer Anda, lalu aplikasi Anda mengambilnya
lewat API yang bentuknya sama dengan developer.fingerspot.io.

> Freedom Finger adalah proyek independen dan tidak berafiliasi dengan Fingerspot.
> "Fingerspot" disebut hanya untuk menjelaskan mesin yang didukung.

| Crate | Isi |
|---|---|
| `crates/freedom-finger` | Server: menerima data mesin, API bergaya developer.fingerspot.io, SQLite |
| `crates/freedom-finger-sdk` | SDK: protokol TCP 5005 (mode Lokal) dan FkWeb (mode Internet) |
| `crates/fk-cli` | CLI `fk` untuk mode Lokal: log, jam, kelola user |

Status: server dan SDK sudah teruji dengan data asli dari mesin. Pemasangan satu perintah
(`freedom-finger install`), halaman status, paket JS, dan rilis siap unduh sedang
dikerjakan.

## Build and test

Butuh [rustup](https://rustup.rs); versi Rust dipasang otomatis dari `rust-toolchain.toml`.

```sh
cargo build --release     # target/release/freedom-finger dan target/release/fk
cargo test --workspace    # uji offline, tanpa mesin
```

## Running the server

Server membaca `.env` di direktori kerja.

| Variabel | Bawaan | Isi |
|---|---|---|
| `FKWEB_TOKEN` | wajib | Token Bearer untuk `/api/*`, minimal 16 karakter (`openssl rand -hex 24`) |
| `FKWEB_PORT` | `8013` | Port untuk mesin dan API |
| `FKWEB_DB` | `absensi.db` | Database SQLite |
| `FKWEB_TZ` | `Asia/Jakarta` | Zona jam mesin |
| `FKWEB_DEVICES` | semua | Cloud ID mesin yang diterima, pisah koma |
| `FKWEB_WEBHOOK` | - | URL penerima callback |
| `FKWEB_PHOTOS` | `photos` | Folder foto absen |

```sh
target/release/freedom-finger
```

Di menu mesin → Jaringan: Mode **Internet**, Server IP = IP komputer server, Server Port =
`8013`, Server Req = **Ya**. Contoh pemakaian API ada di `docs/operasional.md` bagian 3.

## CLI `fk`

Hanya jalan saat mesin di mode **Lokal**; selama itu server tidak menerima data.

```sh
target/release/fk --host 192.168.1.201 list
target/release/fk --host 192.168.1.201 log > absensi.csv
target/release/fk --help    # semua perintah dan variabel FK_*
```

## Documents

| File | Isi |
|---|---|
| `docs/arsitektur.md` | Susunan kode, keputusan, cara menambah perintah dan endpoint |
| `docs/operasional.md` | Menjalankan server, API, pekerjaan sehari-hari, masalah umum |
| `docs/protokol.md` | Spesifikasi TCP 5005 dan FkWeb, test vector |
| `docs/riset.md` | Laporan riset dan riwayat keputusan |

## License

Dual license [MIT](LICENSE-MIT) atau [Apache-2.0](LICENSE-APACHE), pilih salah satu.
