// Aplikasi absensi. Server Freedom Finger berjalan di dalam aplikasi ini (src-tauri/src/main.rs);
// halaman memakai API HTTP-nya (docs/api.md) seperti aplikasi lain. Satu modul per tab; yang
// dipakai bersama ada di app.js, dan aturan rekap di hitung-rekap.js.
// PC tidak menyala 24 jam: saat start, semua log mesin ditarik (sync_attlog) untuk menyusul absen
// selama PC mati, karena antrean kiriman mesin sendiri masuk pelan.
// Tampilan terkunci sampai kata sandi benar (kunci.js); tugas latar tetap berjalan.
import '@fontsource-variable/plus-jakarta-sans';
import { $, api, bus, connect, data, devices, emit, listen, loadData, loadDevices, loadUsers } from './app.js';
import * as hariIni from './hari-ini.js';
import * as izin from './izin.js';
import * as karyawan from './karyawan.js';
import * as kunci from './kunci.js';
import * as mesin from './mesin.js';
import * as pengaturan from './pengaturan.js';
import * as rekap from './rekap.js';
import * as riwayat from './riwayat.js';

const TABS = { 'hari-ini': hariIni, riwayat, rekap, izin, karyawan, mesin, pengaturan };
let active = 'hari-ini';

function open(name) {
  active = name;
  for (const n of Object.keys(TABS)) {
    $(n).hidden = n !== name;
    if (n === name) $(`tab-${n}`).setAttribute('aria-current', 'page');
    else $(`tab-${n}`).removeAttribute('aria-current');
  }
  TABS[name].show('open');
}

/** Sidebar: nama kantor dan status mesin, terlihat dari semua tab. */
function sidebar() {
  $('nama-kantor').textContent = data.office;
  const on = devices.filter((d) => d.connected).length;
  $('status-samping').className = !devices.length ? 'redup' : on ? 'ok' : 'off';
  $('status-samping').textContent = !devices.length ? 'Belum ada mesin' : on === devices.length
    ? `${on === 1 ? 'Mesin' : `${on} mesin`} terhubung` : `${devices.length - on} dari ${devices.length} mesin terputus`;
}

async function main() {
  kunci.init(() => open(active)); // setelah dibuka: gambar ulang tab supaya datanya terbaru
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
  bus.addEventListener('devices', sidebar);
  bus.addEventListener('data', sidebar);
  sidebar();
  listen((ev) => {
    if (ev.type === 'attlog' || ev.type === 'sync_attlog') emit('logs'); // absen baru, atau hasil penyusulan
    if (ev.type === 'get_userinfo') loadUsers();
    karyawan.onEvent(ev);
    mesin.onEvent(ev);
  });
  open('hari-ini');
  kunci.ready();
  // Susul absen selama PC mati; mesin mengambil perintah ini saat bertanya berikutnya (±20 detik–2 menit)
  for (const d of devices) api('sync_attlog', { cloud_id: d.cloud_id }).catch(() => {});
  karyawan.resumePull();
  mesin.resume();
  pengaturan.autoBackup();
  // status mesin terhubung/terputus (event devices juga menangani ganti hari), karyawan baru dari mesin
  setInterval(async () => {
    await loadDevices().catch(() => {});
    await loadUsers().catch(() => {});
  }, 60_000);
}

main().catch((e) => {
  const text = `Aplikasi gagal mulai: ${e.message ?? e}. Mungkin port 8013 dipakai program lain (misalnya layanan ` +
    'freedom-finger). Tutup program itu, lalu buka lagi aplikasi ini.';
  $('status-mesin').className = 'off';
  $('status-mesin').textContent = text;
  kunci.failed(text);
});
