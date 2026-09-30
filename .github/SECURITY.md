# Security policy

Freedom Finger menyimpan data absen, data karyawan, serta **template sidik jari dan wajah**. Laporan
celah keamanan sangat kami hargai.

## Reporting a vulnerability

**Jangan laporkan celah keamanan lewat Issue publik.** Laporkan secara pribadi:

1. Buka tab **Security** di repo ini, lalu klik **Report a vulnerability**
   ([tautan langsung](https://github.com/mazWaz/freedom-finger/security/advisories/new)).
2. Jelaskan celahnya, versi yang terdampak, dan langkah untuk mengulanginya.
3. Jangan sertakan data asli: nama karyawan, database `absensi.db`, backup, token API, atau
   template jari/wajah. Pakai data contoh.

Laporan hanya terlihat oleh Anda dan pengelola. Balasan dan perbaikannya dibahas di thread laporan
itu, lalu diumumkan sebagai security advisory setelah versi perbaikannya terbit.

## Supported versions

Perbaikan keamanan hanya dibuat untuk **rilis terbaru**. Aplikasi desktop v0.4.0 ke atas memasang
versi baru sendiri setelah disetujui pengguna.

## Known limitations

Hal berikut sudah diketahui dan terdokumentasi, jadi tidak perlu dilaporkan sebagai celah baru:

| Hal | Keterangan |
|---|---|
| Mesin mengirim tanpa TLS dan tanpa autentikasi | Batasan protokol FkWeb di mesin. Siapa pun di jaringan kantor bisa mengirim data palsu ke port 8013. `FKWEB_DEVICES` hanya penyaring ringan. Lihat [`docs/riset.md`](../docs/riset.md). |
| Kunci aplikasi hanya menutup tampilan | Orang yang bisa membuka folder data aplikasi tetap bisa membaca datanya. |
| Backup berisi data biometrik | File backup harus disimpan di tempat yang aman, sama seperti database. |
| Installer belum bertanda tangan digital | Windows dan macOS menampilkan peringatan saat memasang. Paket update otomatis ditandatangani kunci updater Tauri. |

Saran pemasangan yang aman: pasang di jaringan kantor yang tidak terbuka ke internet, pisahkan
mesin absensi di jaringan atau Wi-Fi khusus bila bisa, dan jangan membuka port 8013 ke internet.
