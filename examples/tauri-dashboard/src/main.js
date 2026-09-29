// Aplikasi absensi. Server Freedom Finger berjalan di dalam aplikasi ini (src-tauri/src/main.rs);
// halaman memakai API HTTP-nya (docs/api.md) seperti aplikasi lain. Satu modul per tab; yang
// dipakai bersama ada di app.js, dan aturan rekap di hitung-rekap.js.
// PC tidak menyala 24 jam: saat start, semua log mesin ditarik (sync_attlog) untuk menyusul absen
// selama PC mati, karena antrean kiriman mesin sendiri masuk pelan.
import { $, api, bus, connect, devices, emit, listen, loadData, loadDevices, loadUsers } from './app.js';
import * as hariIni from './hari-ini.js';
import * as izin from './izin.js';
import * as karyawan from './karyawan.js';
import * as pengaturan from './pengaturan.js';
import * as rekap from './rekap.js';
import * as riwayat from './riwayat.js';

const TABS = { 'hari-ini': hariIni, riwayat, rekap, izin, karyawan, pengaturan };
let active = 'hari-ini';

function open(name) {
  active = name;
  for (const n of Object.keys(TABS)) {
    $(n).hidden = n !== name;
    $(`tab-${n}`).setAttribute('aria-selected', String(n === name));
  }
  TABS[name].show('open');
}

async function main() {
  await connect();
  await loadData();
  // server di dalam aplikasi baru saja dinyalakan: beri waktu sampai port-nya siap
  for (let i = 0; ; i++) {
    try {
      await loadDevices();
      break;
    } catch (e) {
      if (i === 20) throw e;
      await new Promise((ok) => setTimeout(ok, 250));
    }
  }
  await loadUsers();
  for (const t of Object.values(TABS)) t.init?.();
  for (const n of Object.keys(TABS)) $(`tab-${n}`).onclick = () => open(n);
  // perubahan data -> tab yang terbuka digambar ulang (tiap tab memilih apa yang perlu diambil lagi)
  for (const type of ['logs', 'users', 'devices', 'data', 'employees']) {
    bus.addEventListener(type, () => TABS[active].show(type));
  }
  listen((ev) => {
    if (ev.type === 'attlog' || ev.type === 'sync_attlog') emit('logs'); // absen baru, atau hasil penyusulan
    if (ev.type === 'get_userinfo') loadUsers();
    karyawan.onEvent(ev);
  });
  open('hari-ini');
  // Susul absen selama PC mati; mesin mengambil perintah ini saat bertanya berikutnya (±20 detik–2 menit)
  for (const d of devices) api('sync_attlog', { cloud_id: d.cloud_id }).catch(() => {});
  karyawan.resumePull();
  pengaturan.autoBackup();
  // status mesin terhubung/terputus (event devices juga menangani ganti hari), karyawan baru dari mesin
  setInterval(async () => {
    await loadDevices().catch(() => {});
    await loadUsers().catch(() => {});
  }, 60_000);
}

main().catch((e) => {
  $('mesin').className = 'off';
  $('mesin').textContent = `Gagal: ${e.message ?? e}. Mungkin port 8013 dipakai program lain (misalnya layanan ` +
    'freedom-finger). Tutup program itu, lalu buka lagi aplikasi ini.';
});
