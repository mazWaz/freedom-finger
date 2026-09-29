//! Server absensi pengganti developer.fingerspot.io: menerima FkWeb dari mesin (mode Internet) dan
//! menyediakan API bergaya developer.fingerspot.io, tanpa cloud.
//!
//! Lapisan: [`store`] (SQL) → [`service`] (logika, tanpa HTTP) → [`http`] (axum). [`config`] dari env.

pub mod config;
pub mod http;
pub mod service;
pub mod store;
