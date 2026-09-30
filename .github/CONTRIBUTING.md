# Contributing

Terima kasih sudah ingin membantu Freedom Finger. Bantuan tidak harus berupa kode: laporan bug,
cerita mencoba mesin lain, perbaikan wiki, dan usul fitur sama berharganya.

## Reporting a bug or idea

- **Bug:** buka [Issue baru](https://github.com/mazWaz/freedom-finger/issues/new/choose) dan pilih
  **Laporan bug**. Sebutkan versi aplikasi, sistem operasi, model mesin, dan langkah kejadiannya.
- **Usul fitur:** pilih **Usul fitur**, lalu ceritakan masalah yang ingin diselesaikan.
- **Mencoba mesin Fingerspot lain:** ceritakan hasilnya lewat Issue, berhasil atau tidak. Informasi
  ini membantu pengguna lain.
- **Celah keamanan:** jangan lewat Issue. Ikuti [SECURITY.md](SECURITY.md).

**Jangan pernah melampirkan data asli**: nama karyawan, `absensi.db`, backup, token API, atau
template jari/wajah. Pakai data contoh atau samarkan.

## Development setup

| Kebutuhan | Keterangan |
|---|---|
| [rustup](https://rustup.rs) | Versi Rust dipasang otomatis dari `rust-toolchain.toml` |
| Node.js 22 | Untuk aplikasi desktop di `examples/tauri-dashboard` |
| Mesin absensi | Tidak wajib: semua uji berjalan tanpa mesin |

```sh
cargo test --workspace                        # SDK dan server
cd examples/tauri-dashboard && npm ci
npm test                                      # aturan rekap (hitung-rekap.js)
npm run tauri dev                             # aplikasi desktop, server di port 8013
```

Susunan kode dan cara menambah perintah FkWeb atau endpoint API ada di
[`docs/arsitektur.md`](../docs/arsitektur.md). Protokol mesin ada di
[`docs/protokol.md`](../docs/protokol.md).

## Before you open a pull request

CI menjalankan pemeriksaan berikut, jadi jalankan dulu di komputer Anda:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps
cargo clippy --manifest-path examples/tauri-dashboard/src-tauri/Cargo.toml --all-targets -- -D warnings
```

- Satu pull request untuk satu perubahan, dengan uji untuk logika baru.
- Teks yang dilihat pengguna ditulis dalam Bahasa Indonesia yang sederhana.
- Pesan commit dalam Bahasa Indonesia, diawali area yang diubah, misalnya
  `Aplikasi desktop: …`, `Server: …`, atau `README: …`.
- Perubahan yang menulis ke mesin (menambah, mengubah, atau menghapus user) harus diuji dulu dengan
  mesin tiruan, dan di mesin asli hanya dengan PIN uji yang dihapus lagi.

Dengan mengirim kontribusi, Anda setuju kontribusi itu berlisensi ganda MIT atau Apache-2.0, sama
dengan proyek ini.

## Code of conduct

Semua yang ikut serta diharapkan mengikuti [Kode Etik](CODE_OF_CONDUCT.md).
