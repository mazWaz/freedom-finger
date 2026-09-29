// Dashboard absen hari ini, realtime. Server Freedom Finger berjalan di dalam aplikasi ini
// (src-tauri/src/main.rs); halaman ini memakai API HTTP-nya (docs/api.md) seperti aplikasi lain.
// PC tidak menyala 24 jam: saat start, semua log mesin ditarik (sync_attlog) untuk menyusul absen
// selama PC mati, karena antrean kiriman mesin sendiri masuk pelan.
import { invoke } from '@tauri-apps/api/core';

const STATUS = ['Masuk', 'Pulang'];
const VERIFY = { 1: 'Jari', 2: 'Password', 3: 'Kartu', 4: 'Wajah' };
const $ = (id) => document.getElementById(id);
const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, jam komputer ini
/** localStorage yang tidak pernah melempar error (mode privat, penyimpanan penuh). */
function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
}
// PIN datang dari mesin (atau siapa pun di LAN yang meniru mesin): jangan masuk HTML mentah
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function main() {
  const { url, port, token } = await invoke('server');
  const headers = { authorization: `Bearer ${token}` };
  const api = async (endpoint, body = {}) => {
    const r = await fetch(`${url}/api/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.success) throw new Error(j.message);
    return j.data;
  };
  let shown = new Set();

  async function load() {
    const devices = await api('get_devices');
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
    const logs = (await Promise.all(devices.map((d) => api('get_attlog', { cloud_id: d.cloud_id, start_date: day, end_date: day })))).flat();
    logs.sort((a, b) => b.scan_date.localeCompare(a.scan_date));
    const key = (l) => `${l.pin} ${l.scan_date}`;
    $('jumlah').textContent = `(${logs.length})`;
    $('daftar').innerHTML = logs
      .map((l) => `<tr${shown.size && !shown.has(key(l)) ? ' class="baru"' : ''}><td>${l.scan_date.slice(11, 16)}</td><td>${esc(l.pin)}</td>` +
        `<td>${STATUS[l.status_scan] ?? esc(l.status_scan)}</td><td>${VERIFY[l.verify] ?? esc(l.verify)}</td></tr>`)
      .join('');
    shown = new Set(logs.map(key));
  }

  // Event realtime (SSE lewat fetch, karena EventSource tidak bisa mengirim token); tiap absen baru
  // memuat ulang daftar. Tersambung ulang sendiri bila koneksi putus.
  (async () => {
    for (;;) {
      try {
        const r = await fetch(`${url}/api/events`, { headers });
        const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (let c; !(c = await reader.read()).done; ) {
          buf += c.value;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
            buf = buf.slice(i + 2);
            const type = line && JSON.parse(line.slice(5)).type;
            if (type === 'attlog' || type === 'sync_attlog') await load(); // absen baru, atau hasil penyusulan
          }
        }
      } catch {}
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  })();
  // server di dalam aplikasi baru saja dinyalakan: beri waktu sampai port-nya siap
  for (let i = 0; ; i++) {
    try {
      await load();
      break;
    } catch (e) {
      if (i === 20) throw e;
      await new Promise((ok) => setTimeout(ok, 250));
    }
  }
  // Susul absen selama PC mati; mesin mengambil perintah ini saat bertanya berikutnya (±20 detik–2 menit)
  for (const d of await api('get_devices')) api('sync_attlog', { cloud_id: d.cloud_id }).catch(() => {});
  setInterval(load, 60_000); // status mesin terhubung/terputus, dan ganti hari
}

main().catch((e) => {
  $('mesin').className = 'off';
  $('mesin').textContent = `Gagal: ${e.message ?? e}. Mungkin port 8013 dipakai program lain (misalnya layanan ` +
    'freedom-finger). Tutup program itu, lalu buka lagi aplikasi ini.';
});
