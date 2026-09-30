// Tab Mesin: info tiap mesin, jam mesin dibanding jam PC, perintah perawatan (setel jam, tarik ulang
// log, restart), dan cari mesin di jaringan. Mesin mengambil perintah ±20 detik sampai 2 menit
// kemudian, jadi setiap perintah tampil "menunggu mesin" sampai selesai. Perintah yang sedang berjalan
// disimpan di aplikasi.json, sehingga tetap terlihat setelah aplikasi dibuka ulang.
import { ask } from '@tauri-apps/plugin-dialog';
import { $, api, call, data, devices, dmy, esc, notify, saveData, users } from './app.js';

const ACTIONS = {
  set_time: { label: 'Setel jam sekarang', done: () => 'jam mesin sudah disetel' },
  sync_attlog: { label: 'Tarik ulang semua log', done: (d) => `${d?.added ?? 0} log baru dari ${d?.log_count ?? 0} log di mesin` },
  restart_device: { label: 'Restart mesin', done: () => 'perintah terkirim; mesin menyala lagi dalam ±1 menit' },
};
const ENROLL = { FP: 'Jari', FACE: 'Wajah', IDCARD: 'Kartu', PASSWORD: 'Password' };
const MODE = { lokal: 'Mode Lokal', ditolak: 'Mode Lokal, password beda', diam: 'Kemungkinan mode Internet' };
/** Perintah yang tidak diambil mesin selama ini dianggap gagal (mesin mati atau dicabut). */
const WAIT_MS = 10 * 60_000;

let info = {}; // cloud_id -> get_device

export function init() {
  $('m-daftar').onclick = (e) => {
    const b = e.target.closest('button[data-cmd]');
    if (b) run(b.dataset.cmd, b.dataset.id);
  };
  $('m-cari').onclick = search;
}

export async function show(reason) {
  // get_devices diperbarui tiap menit (event devices): ambil juga jam dan info tiap mesin
  if (reason === 'open' || reason === 'devices') {
    const list = await Promise.all(devices.map((d) => api('get_device', { cloud_id: d.cloud_id }).catch(() => null)));
    info = Object.fromEntries(devices.map((d, i) => [d.cloud_id, list[i]]));
  }
  render();
}

const when = (t) => (t ? `${dmy(t.slice(0, 10))} ${t.slice(11)}` : '-');

/** Jam mesin saat terakhir bertanya, dibanding jam PC (jam server di aplikasi ini) saat itu juga. */
function clock(g) {
  if (g?.clock_offset == null) return 'belum diketahui: muncul setelah mesin bertanya lagi (±2 menit)';
  const s = g.clock_offset;
  const diff = Math.abs(s) <= 1 ? 'sama dengan jam PC' : `${Math.abs(s)} detik lebih ${s > 0 ? 'cepat' : 'lambat'} dari jam PC`;
  return `${when(g.fk_time)}, ${diff}`;
}

function render() {
  $('m-daftar').innerHTML = devices
    .map((d) => {
      const g = info[d.cloud_id];
      const waiting = data.commands.filter((c) => c.cloud_id === d.cloud_id);
      const buttons = Object.entries(ACTIONS)
        .map(([type, a]) => `<button data-cmd="${type}"${type === 'restart_device' ? ' class="bahaya"' : ''} data-id="${esc(d.cloud_id)}"${!d.connected || waiting.some((c) => c.type === type) ? ' disabled' : ''}>${a.label}</button>`)
        .join(' ');
      return `<h2>${esc(d.device_name || 'Mesin')} <span class="${d.connected ? 'ok' : 'off'}">${d.connected ? 'terhubung' : 'terputus'}</span></h2>` +
        '<table style="width: auto"><tbody>' +
        `<tr><th>Cloud ID</th><td>${esc(d.cloud_id)}</td></tr>` +
        `<tr><th>IP</th><td>${esc(d.ip ?? 'belum diketahui: muncul setelah mesin bertanya lagi')}</td></tr>` +
        `<tr><th>Terakhir aktif</th><td>${when(d.last_activity)}</td></tr>` +
        `<tr><th>Jam mesin</th><td>${esc(clock(g))}</td></tr>` +
        `<tr><th>Firmware</th><td>${esc(g?.info?.firmware ?? '-')}</td></tr>` +
        `<tr><th>Bisa mendaftarkan</th><td>${esc((g?.info?.supported_enroll_data ?? []).map((k) => ENROLL[k] ?? k).join(', ') || '-')}</td></tr>` +
        `<tr><th>Karyawan tercatat</th><td>${users.filter((u) => u.cloud_id === d.cloud_id).length}</td></tr>` +
        `</tbody></table><p>${buttons}</p>` +
        (d.connected ? '' : '<p class="muted">Perintah bisa dikirim setelah mesin terhubung lagi.</p>') +
        waiting.map((c) => `<p class="muted">${ACTIONS[c.type].label}: menunggu mesin mengambil perintah (±20 detik sampai 2 menit)…</p>`).join('');
    })
    .join('') || '<p class="muted">Belum ada mesin yang pernah terhubung. Lihat isian menu mesin di tab Hari ini, atau cari mesin di bawah.</p>';
}

async function run(type, cloud_id) {
  if (type === 'restart_device' && !(await ask(`Restart mesin ${cloud_id}? Selama ±1 menit mesin tidak bisa dipakai absen.`,
    { title: 'Restart mesin', kind: 'warning', okLabel: 'Restart', cancelLabel: 'Batal' }))) return;
  try {
    const { trans_id } = await call(type, { cloud_id });
    data.commands.push({ trans: trans_id, cloud_id, type, at: Date.now() });
    await saveData(null);
  } catch (e) {
    return notify(`Gagal mengirim perintah: ${e.message}`, true);
  }
  render();
  resume();
}

let timer;
/** Pantau perintah yang sedang berjalan (juga setelah aplikasi dibuka ulang). */
export function resume() {
  clearInterval(timer);
  if (data.commands.length) timer = setInterval(tick, 10_000); // cadangan bila event realtime terlewat
  tick();
}

/** Hasil perintah dari event realtime: periksa sekarang juga. */
export function onEvent(ev) {
  if (ACTIONS[ev.type]) tick();
}

let busy = false;
async function tick() {
  if (busy || !data.commands.length) return;
  busy = true;
  try {
    const left = [];
    for (const c of data.commands) {
      let r;
      try {
        r = await call('get_result', { cloud_id: c.cloud_id, trans_id: c.trans });
      } catch (e) {
        // perintah tidak dikenal lagi (mis. database dipulihkan): lupakan; error lain dicoba lagi nanti
        if (!/trans_id tidak dikenal/.test(e.message)) left.push(c);
        continue;
      }
      const waiting = r.status === 'pending' || r.status === 'sent';
      if (waiting && Date.now() - c.at < WAIT_MS) {
        left.push(c);
        continue;
      }
      const what = `${ACTIONS[c.type].label} (${c.cloud_id})`;
      if (r.status === 'done' && (r.result_code === 'OK' || r.result_code === 'NO_REPLY')) notify(`${what}: ${ACTIONS[c.type].done(r.data)}.`);
      else notify(`${what} gagal: ${waiting ? 'mesin tidak mengambil perintah dalam 10 menit' : r.status === 'timeout' ? 'mesin tidak menjawab' : `ditolak mesin (${r.result_code})`}.`, true);
    }
    if (left.length !== data.commands.length) {
      data.commands = left;
      await saveData(null);
      render();
    }
    if (!left.length) clearInterval(timer);
  } finally {
    busy = false;
  }
}

async function search() {
  $('m-cari').disabled = true;
  $('m-hasil').innerHTML = '<p class="muted">Mencari mesin di jaringan (sampai 10 detik)…</p>';
  try {
    const found = await api('scan_devices');
    $('m-hasil').innerHTML = found.length
      ? '<table><thead><tr><th>IP</th><th>Mode</th><th>Cloud ID</th><th>Keterangan</th></tr></thead><tbody>' +
        found.map((f) => `<tr><td>${esc(f.ip)}</td><td>${MODE[f.mode] ?? esc(f.mode)}</td><td>${esc(f.cloud_id ?? '')}</td><td>${esc(f.note)}</td></tr>`).join('') +
        '</tbody></table>'
      : '<p class="muted">Tidak ada mesin ditemukan. Pastikan mesin menyala dan satu jaringan dengan komputer ini.</p>';
  } catch (e) {
    $('m-hasil').innerHTML = '';
    notify(`Gagal mencari mesin: ${e.message}`, true);
  }
  $('m-cari').disabled = false;
}
