# Architecture

Workspace Rust berisi tiga crate: SDK protokol mesin, server pengganti developer.fingerspot.io,
dan CLI untuk mode Lokal. Perilakunya disalin dari prototipe TypeScript yang sudah berjalan di
produksi. Pada 29-09-2026 kedua versi diuji banding memakai salinan database dan request
yang sama: jawabannya identik, kecuali teks satu pesan error.

```text
                 mesin Fingerspot Revo WF-206BNC
          mode Internet │ HTTP POST / (FkWeb)               mode Lokal │ TCP 5005
                        ▼                                              ▲
 aplikasi ─ POST /api/<endpoint> ─────▶ freedom-finger            mesin (CLI)
 webhook, SSE ◀─ attlog, hasil perintah ─┤ http → service → store      │
                                         │        │        (SQLite)    │
                                         └ freedom_finger_sdk::fkweb   freedom_finger_sdk::tcp::Client
```

Mesin hanya bisa di satu mode pada satu waktu (menu **Jaringan → Mode**). Selama mesin di
mode Lokal, server tidak menerima data.

## Crates

| Crate | Isi | Dependency utama |
|---|---|---|
| `crates/freedom-finger-sdk` | `tcp` (bingkai, record, `Client`), `fkweb` (`Body`, pesan, `Command`), `time` (`WallTime`) | serde, thiserror; tanpa tokio dan HTTP |
| `crates/freedom-finger` | library `config`, `store`, `service`, `http`, `net`; program `main`, `setup` (layanan OS), `mesin` (TCP 5005) | axum, tokio, rusqlite (SQLite bawaan), ureq, jiff, clap, if-addrs, windows-service |

Aplikasi memakai server lewat HTTP saja (`docs/api.md`); tidak ada pustaka klien. Aplikasi Rust
bisa menanam server langsung lewat `freedom_finger::serve()`, seperti `examples/tauri-dashboard`.

Crate hanya dipecah bila kebutuhan dependency-nya berbeda. Versi Rust dikunci di
`rust-toolchain.toml`; lint dan versi dependency bersama diatur di `Cargo.toml` root.

## Server layers

| Lapisan | Tugas | Aturan |
|---|---|---|
| `store` | Semua SQL | Skema sama dengan versi TypeScript, jadi `absensi.db` lama dipakai tanpa migrasi |
| `service` | Request mesin, antrean perintah, jam otomatis, cadangan user, endpoint API | Tidak tahu HTTP: masukan `DeviceRequest` atau JSON, keluaran `DeviceReply` atau JSON. Webhook dikembalikan sebagai nilai (`hook`). |
| `http` | Token Bearer, batas body 32 MB, kirim webhook dan event SSE | `/api/<endpoint>` untuk aplikasi, path lain untuk mesin |

`config` membaca `freedom-finger.env` di folder data dan variabel `FKWEB_*` (daftarnya di
`README.md`), dan membuat token bila belum ada. `net` mencari mesin di jaringan lokal. Tabel
endpoint API ada di dokumentasi modul `service.rs` dan `docs/openapi.yaml`; tabel request HTTP
di `http.rs`. Endpoint baru: tambahkan juga ke `docs/api.md` dan `docs/openapi.yaml`.

## Decisions

| Keputusan | Alasan |
|---|---|
| Virtual manifest, semua crate sejajar di `crates/` | Pola workspace besar rust-analyzer ([matklad](https://matklad.github.io/2021/08/22/large-rust-workspaces.html)); menambah crate tidak mengubah struktur |
| Logika protokol tanpa I/O, kecuali `tcp::Client` | Bisa diuji dengan byte asli dari mesin tanpa jaringan ([sans-IO](https://www.firezone.dev/blog/sans-io)) |
| `tcp::Client` blocking (`std::net`), bukan async | Mesin melayani satu perintah pada satu waktu; pemakai SDK tidak dipaksa memakai tokio |
| `WallTime` polos, zona selalu diberikan pemanggil | Jam mesin adalah jam dinding WIB, sedangkan zona proses bisa UTC (launchd, uji otomatis). Salah zona pernah menggeser jam 7 jam (`riset.md`). |
| Satu kunci (`Mutex`) untuk seluruh `Service` | Satu mesin dan satu aplikasi; SQLite juga satu penulis. Ganti ke kunci per mesin bila mesin bertambah. |
| Log dibaca dengan `A4`, bukan `A1`/`A2` | Penanda "sudah dibaca" di mesin dipakai bersama software lain |
| Tidak ada perintah hapus massal (`C1`) | Permintaan pemilik: hapus hanya per PIN |
| Status masuk/pulang disimpan apa adanya | Mesin mengganti status menurut jam; aturan kerja belum ada |
| Server berjalan di Windows, Linux, atau macOS | Keputusan 29-09-2026. Kode tidak memakai API khusus OS; zona `Asia/Jakarta` ikut dibundel untuk Windows (`jiff`). |
| Satu folder aplikasi: program, pengaturan, `absensi.db`, `photos/` | `/opt/freedom-finger` (Linux) atau `C:\FreedomFinger` (Windows), dijalankan sebagai layanan OS |
| Tiga beda sengaja dari server TypeScript | Foto ditulis sebelum log dicatat; `io_time` divalidasi karena dipakai di nama file; error database dijawab 500, bukan 400 |

## Adding an FkWeb command and API endpoint

1. Tambah varian di `freedom_finger_sdk::fkweb::Command` (`code()`, `body()`), dengan uji yang
   membandingkan body dengan hasil sadapan.
2. Bila mesin mengirim hasil, tambah struct pesannya di `fkweb/message.rs`.
3. Tambah cabang di `Service::api` (validasi input, lalu `cmd(&Command::…)`), dan bentuk
   hasilnya di `Service::shape` bila perlu.
4. Tambah uji di `crates/freedom-finger/tests/server.rs`: panggil API, `poll`, `result`,
   lalu cek `get_result`.
5. Perbarui tabel endpoint di kepala `service.rs` dan `operasional.md` bagian 4.

## Adding a TCP 5005 command

1. Kode perintah di `tcp::cmd`; susunan byte sebagai fungsi murni di `tcp/record.rs`,
   dengan test vector.
2. Metode di `Client` (lewat `must` atau `read_paged`).
3. Subperintah di `crates/freedom-finger/src/mesin.rs` bila perlu.
4. Catat di `protokol.md` (bagian 5, 6, dan 11) beserta tanda statusnya.

## Tests and checks

| Perintah | Isi |
|---|---|
| `cargo test --workspace` | Uji SDK dengan test vector `protokol.md` bagian 12, server dengan mesin disimulasikan, dan argumen CLI. Tanpa mesin. |
| `cargo clippy --workspace --all-targets -- -D warnings` | Lint; SDK juga wajib punya dokumentasi di setiap API publik |
| `cargo fmt --all --check` | Gaya kode (`rustfmt.toml`) |
| `RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps` | Dokumentasi tanpa peringatan |

Uji langsung ke mesin belum ada di repo ini; urutan ujinya tercatat di `protokol.md` bagian 11.
