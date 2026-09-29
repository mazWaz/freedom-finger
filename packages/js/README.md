# freedom-finger (JavaScript)

Klien JavaScript untuk [Freedom Finger](https://github.com/mazWaz/freedom-finger), server absensi
lokal untuk mesin Fingerspot Revo WF-206BNC, tanpa cloud. Tanpa dependency. Jalan di Node 18+,
Electron, Tauri, dan browser; `start()` hanya untuk Node dan Electron.

> Proyek independen, tidak berafiliasi dengan Fingerspot.

## Usage

Server sudah terpasang (`freedom-finger install`), atau di komputer lain:

```js
import { connect } from 'freedom-finger';

const ff = connect({ url: 'http://localhost:8013', token: '<FKWEB_TOKEN dari freedom-finger.env>' });

for await (const e of ff.events()) {
  if (e.type === 'attlog') console.log(e.data.pin, e.data.scan);
}
```

Program dijalankan oleh aplikasi Anda sendiri (sidecar). Tokennya dibaca otomatis:

```js
import { start } from 'freedom-finger';

const ff = await start({ bin: './freedom-finger', data: './data' });
console.log(await ff.getDevices());
await ff.stop();
```

## API

Semua method menerima `cloud_id`. Isian ini boleh kosong selama baru satu mesin yang terhubung.
Bentuk data lengkap ada di `index.d.ts` dan `docs/openapi.yaml`.

| Method | Isi |
|---|---|
| `getDevices()` | Mesin yang pernah terhubung, IP, terhubung atau tidak |
| `scanDevices({ password? })` | Cari mesin di jaringan lokal |
| `getAttlog({ start_date, end_date })` | Log absen dari database (`YYYY-MM-DD`) |
| `getDevice()`, `getBackup({ pin })`, `getResult({ trans_id })` | Info mesin, cadangan user, hasil perintah |
| `getAllPin()`, `getUserInfo({ pin })` | Perintah ke mesin: **menunggu jawaban mesin** (±20 detik sampai 2 menit) |
| `setUserInfo({ data })`, `deleteUserInfo({ pin })` | Idem. `setUserInfo` mengganti seluruh data user; sertakan `template` dari `getUserInfo` supaya jari tidak hilang |
| `regOnline({ pin, verification })`, `setTime()`, `restartDevice()`, `syncAttlog()` | Idem |
| `events({ signal? })` | Absen baru dan hasil perintah, realtime; tersambung ulang sendiri |
| `call(endpoint, body)` | Endpoint apa saja, balasan apa adanya (perintah tidak ditunggu) |

Error dilempar sebagai `FreedomFingerError`, dengan `status` (HTTP) atau `result` (hasil
perintah yang gagal atau timeout). Event selama koneksi putus tidak dikirim ulang, jadi yang
terlewat diambil lewat `getAttlog()`.

## Test

```sh
cargo build                 # dari root repo
node packages/js/test.mjs   # mesin disimulasikan: absen masuk lewat events(), getAllPin() menunggu jawaban
```
