//! Perintah untuk halaman (`invoke` di `src/`), didaftarkan di `lib.rs`. Satu file per topik:
//! server (alamat dan token API), data (`aplikasi.json`), export, backup/pulihkan, update.

pub mod backup;
pub mod data;
pub mod export;
pub mod server;
pub mod update;

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
