// Server Freedom Finger lewat server web ini (server/proxy.ts menambahkan token; halaman cukup login):
// permintaan API (docs/api.md), perintah ke mesin, event realtime, dan data dari server (mesin, user,
// log). `bus` memberi tahu tab yang terbuka bahwa datanya berubah.
import { today } from './format.js';

/** Perubahan yang perlu ditampilkan ulang tab yang terbuka: logs, users, devices, data. */
export const bus = new EventTarget();
export const emit = (type) => bus.dispatchEvent(new Event(type));

// --- server web (alamat yang sama dengan halaman; cookie sesi ikut sendiri) ---------------------

/** fetch ke server web; sesi yang berakhir membawa kembali ke layar login. */
export async function send(path, init) {
  const r = await fetch(path, init);
  // sesi berakhir (12 jam tidak dipakai, atau server web dimulai ulang): muat ulang ke layar login
  if (r.status === 401) {
    location.reload();
    await new Promise(() => {}); // berhenti di sini sampai halaman berganti
  }
  return r;
}

/** JSON `{success, …}` dari server web; `success: false` menjadi error dengan `status` HTTP-nya. */
export async function request(path, method = 'GET', body) {
  const init = body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const r = await send(path, init);
  const j = await r.json();
  if (!j.success) throw Object.assign(new Error(j.message), { status: r.status });
  return j;
}

/** IP dan port server Freedom Finger: isian menu Jaringan di mesin. */
export let serverIp;
export let port;
export async function loadStatus() {
  const r = await send('/app/status');
  const s = await r.json();
  if (!r.ok) throw new Error(s.message);
  serverIp = s.server_ip;
  port = s.port;
}

/** Balasan lengkap API Freedom Finger `{success, data?, trans_id?, …}`; `success: false` menjadi error. */
export const call = (endpoint, body = {}) => request(`/api/${endpoint}`, 'POST', body);
export const api = async (endpoint, body) => (await call(endpoint, body)).data;

/**
 * Cadangan data satu user di server (`get_backup`, dari data yang dikirim mesin), satu per mesin yang
 * punya, terbaru dulu: `{cloud_id, name, privilege, updated, template, body}` dengan `template` = base64
 * untuk set_userinfo dan `body` = byte body FkWeb yang sama (lihat fkBody).
 */
export async function backups(pin) {
  const list = await Promise.all(devices.map((d) => api('get_backup', { cloud_id: d.cloud_id, pin })
    .then((b) => ({ ...b, cloud_id: d.cloud_id, body: Uint8Array.from(atob(b.template), (c) => c.charCodeAt(0)) }), () => null)));
  return list.filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated));
}

/**
 * Kirim perintah ke mesin dan tunggu hasilnya (mesin mengambil perintah saat bertanya, ±20 detik–2 menit).
 * `status` "offline": mesin terputus sebelum mengambil perintahnya; perintah tetap mengantre di server.
 */
export async function command(cloud_id, endpoint, body = {}) {
  const { trans_id } = await call(endpoint, { cloud_id, ...body });
  const start = Date.now();
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 3000));
    const r = await call('get_result', { cloud_id, trans_id });
    if (r.status === 'done' || r.status === 'timeout') return r;
    // daftar mesin diperbarui tiap menit (main.js); terputus = tidak bertanya lebih dari 3 menit
    if (r.status === 'pending' && devices.find((d) => d.cloud_id === cloud_id)?.connected === false) return { ...r, status: 'offline' };
    if (r.status === 'pending' && Date.now() - start > 10 * 60_000) return { ...r, status: 'timeout' }; // mesin mati atau dicabut
  }
}

/**
 * Event realtime (SSE lewat fetch, supaya sesi yang berakhir terdeteksi seperti request lain): absen
 * baru dan hasil perintah, isinya sama dengan webhook. Tersambung ulang sendiri bila koneksi putus.
 */
export async function listen(onEvent) {
  for (;;) {
    try {
      const r = await send('/api/events');
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (let c; !(c = await reader.read()).done; ) {
        buf += c.value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
          buf = buf.slice(i + 2);
          if (line) onEvent(JSON.parse(line.slice(5)));
        }
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 1000));
  }
}

export let devices = [];
export async function loadDevices() {
  devices = await api('get_devices');
  emit('devices');
}

/**
 * Tanggal scan pertama tiap PIN sepanjang data (semua mesin): rekap menghitung karyawan mulai hari itu.
 * `null` sampai dimuat; bila gagal dimuat, rekap menghitung seperti biasa (tanpa tanggal mulai).
 */
export let firstScans = null;
export async function loadFirstScans() {
  const first = new Map();
  for (const l of await logs('2000-01-01', today())) {
    const d = l.scan_date.slice(0, 10);
    if (!(first.get(l.pin) <= d)) first.set(l.pin, d);
  }
  firstScans = first;
}
/** Absen baru dari event realtime: orang yang baru pertama kali scan. */
export const noteScan = (pin, date) => firstScans && !firstScans.has(pin) && firstScans.set(pin, date);

/** Log absen semua mesin (atau satu), masing-masing dengan `cloud_id`. */
export async function logs(from, to, cloudId) {
  const ids = cloudId ? [cloudId] : devices.map((d) => d.cloud_id);
  const parts = await Promise.all(
    ids.map(async (id) => (await api('get_attlog', { cloud_id: id, start_date: from, end_date: to })).map((l) => ({ ...l, cloud_id: id }))),
  );
  return parts.flat();
}

// --- user di mesin ---------------------------------------------------------------------------

/** User yang tercatat di server (`get_users`, semua mesin). */
export let users = [];
const machineNames = new Map();

export async function loadUsers() {
  const list = await api('get_users');
  if (JSON.stringify(list) === JSON.stringify(users)) return;
  users = list;
  machineNames.clear();
  // PIN yang sama di beberapa mesin = satu karyawan; nama yang terbaru dipakai
  for (const u of [...users].sort((a, b) => a.updated.localeCompare(b.updated))) if (u.name) machineNames.set(u.pin, u.name);
  emit('users');
}

export const machineName = (pin) => machineNames.get(pin) ?? '';
