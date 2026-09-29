// Tab Hari ini: absen hari ini (realtime), status mesin, isian menu mesin, dan peringatan bila IP
// PC ini berubah.
import { invoke } from '@tauri-apps/api/core';
import { $, devices, esc, logs, nameOf, port, today } from './app.js';

export const STATUS = ['Masuk', 'Pulang'];
export const VERIFY = { 1: 'Jari', 2: 'Password', 3: 'Kartu', 4: 'Wajah' };

/** localStorage yang tidak pernah melempar error (mode privat, penyimpanan penuh). */
function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
}

let shown = new Set();

export async function show() {
  const on = devices.filter((d) => d.connected).length;
  const ip = (await invoke('lan_ip')) ?? 'IP komputer ini';
  $('isian').textContent = `Isian di mesin (Menu → Jaringan): Mode Internet · Server IP ${ip} · Server Port ${port} · Server Req Ya`;
  $('mesin').className = on ? 'ok' : 'off';
  $('mesin').textContent = devices.length
    ? `${on} dari ${devices.length} mesin terhubung`
    : 'Belum ada mesin terhubung. Isi menu mesin seperti di bawah; mesin muncul di sini dalam ±2 menit.';
  // Mesin mengirim ke Server IP yang tetap: bila IP komputer ini berganti, mesin kehilangan tujuan
  const lastOk = storage('ip');
  if (on) storage('ip', ip);
  $('peringatan').hidden = !(devices.length && !on && lastOk && lastOk !== ip);
  $('peringatan').textContent = `IP komputer ini berubah dari ${lastOk} menjadi ${ip}. Ubah Server IP di mesin ke ${ip}, ` +
    'lalu minta admin jaringan mereservasi IP komputer ini di router supaya tidak berubah lagi.';
  const day = today();
  const list = await logs(day, day);
  list.sort((a, b) => b.scan_date.localeCompare(a.scan_date));
  const key = (l) => `${l.cloud_id} ${l.pin} ${l.scan_date}`;
  $('jumlah').textContent = `(${list.length})`;
  $('daftar').innerHTML = list
    .map((l) => `<tr${shown.size && !shown.has(key(l)) ? ' class="baru"' : ''}><td>${l.scan_date.slice(11, 16)}</td>` +
      `<td>${esc(nameOf(l.pin))}</td><td>${esc(l.pin)}</td>` +
      `<td>${STATUS[l.status_scan] ?? esc(l.status_scan)}</td><td>${VERIFY[l.verify] ?? esc(l.verify)}</td></tr>`)
    .join('');
  shown = new Set(list.map(key));
}
