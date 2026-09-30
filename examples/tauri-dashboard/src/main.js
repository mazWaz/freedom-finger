// Aplikasi absensi. Server Freedom Finger berjalan di dalam aplikasi ini (src-tauri/src/main.rs);
// halaman memakai API HTTP-nya (docs/api.md) seperti aplikasi lain. Satu modul per tab; yang
// dipakai bersama ada di app.js, dan aturan rekap di hitung-rekap.js.
// PC tidak menyala 24 jam: saat start, semua log mesin ditarik (sync_attlog) untuk menyusul absen
// selama PC mati, karena antrean kiriman mesin sendiri masuk pelan.
// Tampilan terkunci sampai kata sandi benar (kunci.js); tugas latar tetap berjalan.
// Versi baru di rilis GitHub: tombol di sidebar, dipasang setelah pengguna setuju (checkUpdate).
import '@fontsource-variable/plus-jakarta-sans';
import { invoke } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import {
  CalendarCheck, CalendarX, Clock, DatabaseBackup, Download, FilePenLine, FileSpreadsheet, FileText, FingerprintPattern, History, Lock, PenLine, Plus,
  Printer, Settings, Sheet, UserPlus, Users,
  createIcons,
} from 'lucide';
import {
  $, api, bus, closeDrawer, connect, data, devices, emit, listen, loadData, loadDevices, loadFirstScans, loadUsers, noteScan, notify, waiting,
} from './app.js';
import * as hariIni from './hari-ini.js';
import * as izin from './izin.js';
import * as karyawan from './karyawan.js';
import * as kunci from './kunci.js';
import * as mesin from './mesin.js';
import * as pengaturan from './pengaturan.js';
import * as rekap from './rekap.js';
import * as riwayat from './riwayat.js';
import * as tanggal from './tanggal.js';

// Jam kerja, Hari libur, dan Backup ditangani pengaturan.js bersama Pengaturan (satu modul, empat menu)
const TABS = { 'hari-ini': hariIni, riwayat, rekap, izin, karyawan, 'jam-kerja': pengaturan, libur: pengaturan, mesin, backup: pengaturan, pengaturan };

// ikon menu (Lucide, ISC): <i data-lucide="…"> diganti SVG
createIcons({
  icons: {
    CalendarCheck, CalendarX, Clock, DatabaseBackup, Download, FilePenLine, FileSpreadsheet, FileText, FingerprintPattern, History, Lock, PenLine, Plus,
    Printer, Settings, Sheet, UserPlus, Users,
  },
});
tanggal.init(); // semua <input type="date">: tampil "1 Januari 2026", kalender berbahasa Indonesia
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

/** Sidebar: nama kantor dan jumlah mesin terhubung dari semua mesin (1/2), terlihat dari semua tab. */
function sidebar() {
  $('nama-kantor').textContent = data.office;
  const on = devices.filter((d) => d.connected).length;
  $('status-samping').className = !devices.length ? 'redup' : on === devices.length ? 'ok' : 'off';
  $('status-samping').textContent = devices.length ? `${on}/${devices.length} mesin terhubung` : 'Belum ada mesin';
}

let guided = false; // panduan otomatis cukup sekali per aplikasi dibuka

/**
 * Versi baru (latest.json di rilis GitHub terbaru, ditandatangani kunci updater): tombol di sidebar. Diperiksa saat
 * start dan sekali sehari; build `tauri dev` tidak pernah mendapat update (check_update = null).
 */
async function checkUpdate() {
  const u = await invoke('check_update').catch(() => null); // tanpa internet: diam, dicoba lagi besok
  $('pembaruan').hidden = !u;
  if (!u) return;
  $('pembaruan').querySelector('span').textContent = `Pasang versi ${u.version}`;
  $('pembaruan').onclick = async () => {
    if (!(await ask(`Versi ${u.version} tersedia (sekarang ${u.current}). Aplikasi mengunduh update, lalu mulai ulang dalam ±1 menit.\n\n` +
      'Data tidak berubah. Absen selama itu tetap tersimpan di mesin dan masuk setelah aplikasi hidup lagi.',
    { title: 'Update aplikasi', kind: 'info', okLabel: 'Pasang sekarang', cancelLabel: 'Nanti' }))) return;
    waiting(`Mengunduh dan memasang versi ${u.version}…`);
    try {
      await invoke('install_update'); // berhasil: aplikasi mulai ulang (Windows: installer menutupnya)
    } catch (e) {
      waiting();
      notify(`Update gagal: ${e}. Coba lagi nanti, atau unduh installer dari halaman rilis.`, true);
    }
  };
}

async function main() {
  // setelah dibuka: gambar ulang tab supaya datanya terbaru; pemasangan baru (belum pernah ada mesin): panduan
  kunci.init(() => {
    open(active);
    if (!devices.length && !guided) {
      guided = true;
      mesin.guide();
    }
  });
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
  await loadFirstScans().catch(() => {}); // gagal: rekap tanpa tanggal mulai karyawan
  for (const t of new Set(Object.values(TABS))) t.init?.();
  for (const n of Object.keys(TABS)) $(`tab-${n}`).onclick = () => open(n);
  $('laci-tutup').onclick = closeDrawer;
  // klik di luar panel. Jangan `=> cond && close()`: onclick yang mengembalikan false membatalkan
  // aksi bawaan, sehingga tombol Simpan di dalam panel tidak men-submit form
  $('laci').onclick = (e) => {
    if (e.target === $('laci')) closeDrawer();
  };
  // perubahan data -> tab yang terbuka digambar ulang (tiap tab memilih apa yang perlu diambil lagi)
  for (const type of ['logs', 'users', 'devices', 'data', 'employees']) {
    bus.addEventListener(type, () => TABS[active].show(type));
  }
  bus.addEventListener('devices', sidebar);
  bus.addEventListener('data', sidebar);
  sidebar();
  listen((ev) => {
    if (ev.type === 'attlog') noteScan(ev.data.pin, ev.data.scan.slice(0, 10));
    if (ev.type === 'sync_attlog') loadFirstScans().catch(() => {}); // log lama yang baru ditarik: mungkin ada scan pertama baru
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
  checkUpdate();
  setInterval(checkUpdate, 24 * 3600_000);
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
