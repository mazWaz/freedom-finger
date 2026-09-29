// Dashboard absen hari ini, realtime. Server Freedom Finger berjalan di dalam aplikasi ini
// (src-tauri/src/main.rs); halaman ini memakai paket JS freedom-finger seperti aplikasi lain.
import { invoke } from '@tauri-apps/api/core';
import { connect } from 'freedom-finger';

const STATUS = ['Masuk', 'Pulang'];
const VERIFY = { 1: 'Jari', 2: 'Password', 3: 'Kartu', 4: 'Wajah' };
const $ = (id) => document.getElementById(id);
const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, jam komputer ini
// PIN datang dari mesin (atau siapa pun di LAN yang meniru mesin): jangan masuk HTML mentah
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function main() {
  const ff = connect(await invoke('server'));
  let shown = new Set();

  async function load() {
    const devices = await ff.getDevices();
    const on = devices.filter((d) => d.connected).length;
    $('mesin').className = on ? 'ok' : 'off';
    $('mesin').textContent = devices.length
      ? `${on} dari ${devices.length} mesin terhubung`
      : 'Belum ada mesin. Di mesin, Menu → Jaringan: Mode Internet, Server IP = IP komputer ini, Server Port 8013.';
    const day = today();
    const logs = (await Promise.all(devices.map((d) => ff.getAttlog({ cloud_id: d.cloud_id, start_date: day, end_date: day })))).flat();
    logs.sort((a, b) => b.scan_date.localeCompare(a.scan_date));
    const key = (l) => `${l.pin} ${l.scan_date}`;
    $('jumlah').textContent = `(${logs.length})`;
    $('daftar').innerHTML = logs
      .map((l) => `<tr${shown.size && !shown.has(key(l)) ? ' class="baru"' : ''}><td>${l.scan_date.slice(11, 16)}</td><td>${esc(l.pin)}</td>` +
        `<td>${STATUS[l.status_scan] ?? esc(l.status_scan)}</td><td>${VERIFY[l.verify] ?? esc(l.verify)}</td></tr>`)
      .join('');
    shown = new Set(logs.map(key));
  }

  (async () => {
    for await (const e of ff.events()) if (e.type === 'attlog') await load(); // absen baru: muat ulang daftar
  })();
  await load();
  setInterval(load, 60_000); // status mesin terhubung/terputus, dan ganti hari
}

main().catch((e) => {
  $('mesin').className = 'off';
  $('mesin').textContent = `Gagal: ${e.message ?? e}. Port 8013 dipakai server lain? Jalankan dengan FKWEB_PORT=8014.`;
});
