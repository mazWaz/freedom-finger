// Aplikasi absensi versi web. Halaman ini memakai server web Bun (server/), yang meneruskan permintaan
// ke server Freedom Finger dengan tokennya; tanpa login tidak ada data yang bisa dibuka (masuk.js).
// Satu modul per menu di pages/, bagian layar bersama di components/, kode bersama di lib/ (aturan
// rekap: lib/hitung-rekap.js). Beberapa orang bisa membuka aplikasi bersamaan: data aplikasi diambil
// ulang tiap menit, dan simpan yang bentrok ditolak (lib/data.js).
import '@fontsource-variable/plus-jakarta-sans';
import {
  CalendarCheck, CalendarX, Clock, Download, FilePenLine, FileSpreadsheet, FileText, FingerprintPattern, History, LogOut, PenLine, Plus, Printer,
  Settings, Sheet, UserPlus, Users,
  createIcons,
} from 'lucide';
import * as masuk from './components/masuk.js';
import * as tanggal from './components/tanggal.js';
import { api, bus, devices, emit, listen, loadDevices, loadFirstScans, loadStatus, loadUsers, noteScan } from './lib/api.js';
import { data, loadData, refreshData } from './lib/data.js';
import { $, closeDrawer, notify } from './lib/ui.js';
import * as hariIni from './pages/hari-ini.js';
import * as izin from './pages/izin.js';
import * as karyawan from './pages/karyawan.js';
import * as mesin from './pages/mesin.js';
import * as pengaturan from './pages/pengaturan.js';
import * as rekap from './pages/rekap.js';
import * as riwayat from './pages/riwayat.js';

// Jam kerja dan Hari libur ditangani pengaturan.js bersama Pengaturan (satu modul, tiga menu)
const TABS = { 'hari-ini': hariIni, riwayat, rekap, izin, karyawan, 'jam-kerja': pengaturan, libur: pengaturan, mesin, pengaturan };

// ikon menu (Lucide, ISC): <i data-lucide="…"> diganti SVG
createIcons({
  icons: {
    CalendarCheck, CalendarX, Clock, Download, FilePenLine, FileSpreadsheet, FileText, FingerprintPattern, History, LogOut, PenLine, Plus, Printer,
    Settings, Sheet, UserPlus, Users,
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

async function main() {
  await masuk.login();
  $('keluar').onclick = masuk.logout;
  await loadData();
  // server Freedom Finger bisa sedang dimulai ulang: coba beberapa kali sebelum menyerah
  for (let i = 0; ; i++) {
    try {
      await loadStatus();
      await loadDevices();
      break;
    } catch (e) {
      if (i === 10) throw e;
      await new Promise((ok) => setTimeout(ok, 1000));
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
  if (!devices.length) mesin.guide(); // pemasangan baru (belum pernah ada mesin): panduan
  karyawan.resumePull();
  mesin.resume();
  // status mesin, karyawan baru dari mesin, dan data aplikasi yang diubah pengguna lain
  setInterval(async () => {
    await loadStatus().catch(() => {});
    await loadDevices().catch(() => {});
    await loadUsers().catch(() => {});
    await refreshData().catch(() => {});
  }, 60_000);
}

main().catch((e) => {
  const text = `Aplikasi gagal mulai: ${e.message ?? e}. Periksa apakah server Freedom Finger menyala dan FREEDOM_FINGER_URL di .env benar, ` +
    'lalu muat ulang halaman ini.';
  $('status-mesin').className = 'catatan off';
  $('status-mesin').hidden = false;
  $('status-mesin').textContent = text;
  notify(text, true);
});
