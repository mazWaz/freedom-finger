// Tab Mesin: info tiap mesin, jam mesin dibanding jam server, perintah perawatan (setel jam, tarik ulang
// log, restart), dan cari mesin di jaringan. Mesin mengambil perintah ±20 detik sampai 2 menit
// kemudian, jadi setiap perintah tampil "menunggu mesin" sampai selesai. Perintah yang sedang berjalan
// disimpan di aplikasi.json, sehingga tetap terlihat setelah aplikasi dibuka ulang.
// Juga panduan pertama kali (guide): cari mesin, isian menu, tunggu terhubung, lalu ambil karyawan dan jam kerja.
import { Check, createElement } from 'lucide';
import { api, call, devices, loadDevices, port, serverIp, users } from '../lib/api.js';
import { data, saveData } from '../lib/data.js';
import { dmy } from '../lib/format.js';
import { $, MACHINE_ICON, ask, closeDrawer, esc, notify, openDrawer, waiting } from '../lib/ui.js';

const ACTIONS = {
  set_time: { label: 'Setel jam sekarang', done: () => 'jam mesin sudah disetel' },
  sync_attlog: { label: 'Tarik ulang semua log', done: (d) => `${d?.added ?? 0} log baru dari ${d?.log_count ?? 0} log di mesin` },
  restart_device: { label: 'Restart mesin', done: () => 'perintah terkirim; mesin menyala lagi dalam ±1 menit' },
};
const ENROLL = { FP: 'Jari', FACE: 'Wajah', IDCARD: 'Kartu', PASSWORD: 'Password' };
const MODE = { lokal: 'Mode Lokal', ditolak: 'Mode Lokal, password beda', diam: 'Kemungkinan mode Internet' };
/** Perintah yang tidak diambil mesin selama ini dianggap gagal (mesin mati atau dicabut). */
const WAIT_MS = 10 * 60_000;

/** Kode tolakan mesin -> kalimat biasa; kodenya tetap disebut untuk teknisi. */
export const REJECT = {
  ERROR_INVALID_PARAMTER: 'mesin menolak isi perintah',
  BUSY: 'mesin sedang dipakai (menu mesin terbuka); coba lagi setelah menu ditutup',
  'NOT SUPPORT CMD': 'mesin tidak mendukung perintah ini',
};

let info = {}; // cloud_id -> get_device
const results = {}; // cloud_id -> hasil perintah terakhir {at, text, ok}, terbaru dulu (hanya selama aplikasi terbuka)
let ip = 'IP server Freedom Finger'; // untuk petunjuk menu mesin yang terputus

export function init() {
  $('m-daftar').onclick = (e) => {
    const b = e.target.closest('button[data-cmd]');
    if (b) run(b.dataset.cmd, b.dataset.id);
  };
  $('m-cari').onclick = () => search($('m-hasil'));
  $('m-panduan').onclick = guide;
  $('pd-cari').onclick = () => search($('pd-hasil'));
  $('pd-ambil').onclick = () => {
    closeDrawer();
    $('tab-karyawan').click();
    $('y-ambil').click();
  };
  $('pd-jam').onclick = () => {
    closeDrawer();
    $('tab-jam-kerja').click();
  };
}

export async function show(reason) {
  // get_devices diperbarui tiap menit (event devices): ambil juga jam dan info tiap mesin
  if (reason === 'open' || reason === 'devices') {
    const list = await Promise.all(devices.map((d) => api('get_device', { cloud_id: d.cloud_id }).catch(() => null)));
    ip = serverIp ?? ip;
    info = Object.fromEntries(devices.map((d, i) => [d.cloud_id, list[i]]));
  }
  render();
}

/** Jam komputer ini "HH:MM" untuk riwayat perintah. */
const at = (d) => new Date(d).toTimeString().slice(0, 5);
const when = (t) => (t ? `${dmy(t.slice(0, 10))} ${t.slice(11)}` : '-');

/** Jam mesin saat terakhir bertanya, dibanding jam server Freedom Finger saat itu juga. */
function clock(g, connected) {
  if (g?.clock_offset == null) {
    return esc(connected ? 'belum diketahui: muncul setelah mesin bertanya lagi (±2 menit)' : 'tidak diketahui');
  }
  const s = g.clock_offset;
  const diff = Math.abs(s) <= 1 ? 'sama dengan jam server' : `${Math.abs(s)} detik lebih ${s > 0 ? 'cepat' : 'lambat'} dari jam server`;
  // lebih dari 2 menit disetel otomatis oleh server; sampai saat itu tandai merah
  return `<span class="jam-mesin">${esc(when(g.fk_time).slice(11))}</span> <span class="${Math.abs(s) > 120 ? 'off' : 'ok'}">${diff}</span>` +
    `<span class="redup">, ${esc(when(g.fk_time).slice(0, 10))}</span>`;
}

function render() {
  $('m-daftar').innerHTML = devices
    .map((d) => {
      const g = info[d.cloud_id];
      const waiting = data.commands.filter((c) => c.cloud_id === d.cloud_id);
      const buttons = Object.entries(ACTIONS)
        .map(([type, a]) => `<button data-cmd="${type}"${type === 'restart_device' ? ' class="bahaya"' : ''} data-id="${esc(d.cloud_id)}"${!d.connected || waiting.some((c) => c.type === type) ? ' disabled' : ''}>${a.label}</button>`)
        .join('');
      const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
      const log = [
        ...waiting.map((c) => `<li><time>${at(c.at)}</time><span>${ACTIONS[c.type].label}: menunggu mesin mengambil perintah (±20 detik sampai 2 menit)…</span></li>`),
        ...(results[d.cloud_id] ?? []).map((r) => `<li><time>${at(r.at)}</time><span class="${r.ok ? '' : 'off'}">${esc(r.text)}</span></li>`),
      ];
      return `<article class="mesin-kartu"><header><h2>${esc(d.device_name || 'Mesin')}</h2>` +
        `<span class="status-titik ${d.connected ? 'ok' : 'off'}">${d.connected ? 'terhubung' : `terputus${d.last_activity ? ` sejak ${when(d.last_activity)}` : ''}`}</span></header>` +
        '<dl class="info-mesin">' +
        row('Jam mesin', clock(g, d.connected)) +
        row('Cloud ID', esc(d.cloud_id)) +
        row('IP', esc(d.ip ?? (d.connected ? 'belum diketahui: muncul setelah mesin bertanya lagi' : 'tidak diketahui'))) +
        row('Terakhir aktif', esc(when(d.last_activity))) +
        row('Firmware', esc(g?.info?.firmware ?? '-')) +
        row('Bisa mendaftarkan', esc((g?.info?.supported_enroll_data ?? []).map((k) => ENROLL[k] ?? k).join(', ') || '-')) +
        row('Karyawan tercatat', users.filter((u) => u.cloud_id === d.cloud_id).length) +
        `</dl><div class="controls" style="margin: 0">${buttons}</div>` +
        (d.connected ? '' : `<p class="catatan" style="margin: 14px 0 0">Mesin tidak menghubungi aplikasi ini${d.last_activity ? ` sejak ${when(d.last_activity)}` : ''}. ` +
          `Periksa: mesin menyala dan tersambung ke jaringan kantor, dan menu Jaringan mesin berisi Mode Internet, Server IP ${esc(ip)}, ` +
          `Server Port ${port}, Server Req Ya. Tombol perintah aktif lagi setelah mesin terhubung.</p>`) +
        (log.length ? `<ul class="hasil" aria-label="Perintah ke mesin ini">${log.join('')}</ul>` : '') + '</article>';
    })
    .join('') || '<p class="kosong">Belum ada mesin yang pernah terhubung. Lihat isian menu mesin di tab Hari ini, atau cari mesin di bawah.</p>';
}

/** Catat hasil perintah di kartu mesinnya (juga tampil sebagai pesan singkat). */
function record(cloud_id, text, ok) {
  results[cloud_id] = [{ at: new Date(), text, ok }, ...(results[cloud_id] ?? [])].slice(0, 3);
  notify(text, !ok);
}

async function run(type, cloud_id) {
  if (type === 'restart_device' && !(await ask(`Restart mesin ${cloud_id}? Selama ±1 menit mesin tidak bisa dipakai absen.`,
    { title: 'Restart mesin', kind: 'warning', okLabel: 'Restart', cancelLabel: 'Batal' }))) return;
  try {
    const { trans_id } = await call(type, { cloud_id });
    data.commands.push({ trans: trans_id, cloud_id, type, at: Date.now() });
    await saveData(null);
    awaited = trans_id;
    waiting(`${ACTIONS[type].label}: menunggu mesin (±20 detik sampai 2 menit)…`);
  } catch (e) {
    return notify(`Gagal mengirim perintah: ${e.message}`, true);
  }
  render();
  resume();
}

let awaited = null; // perintah yang sedang ditunggu dengan layar tunggu (yang lain dipantau di kartu mesin)
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
      if (r.status === 'done' && (r.result_code === 'OK' || r.result_code === 'NO_REPLY')) record(c.cloud_id, `${what}: ${ACTIONS[c.type].done(r.data)}.`, true);
      else {
        const why = waiting ? 'mesin tidak mengambil perintah dalam 10 menit' : r.status === 'timeout' ? 'mesin tidak menjawab'
          : `${REJECT[r.result_code] ?? 'ditolak mesin'} (${r.result_code})`;
        record(c.cloud_id, `${what} gagal: ${why}.`, false);
      }
    }
    if (left.length !== data.commands.length) {
      data.commands = left;
      await saveData(null);
      render();
    }
    // layar tunggu ditutup saat perintahnya selesai, atau saat mesinnya terputus (perintah tetap dipantau di kartu)
    const w = left.find((c) => c.trans === awaited);
    if (awaited && (!w || devices.find((d) => d.cloud_id === w.cloud_id)?.connected === false)) {
      if (w) notify('Mesin terputus. Perintahnya tetap menunggu dan dijalankan saat mesin tersambung lagi.', true);
      awaited = null;
      waiting();
    }
    if (!left.length) clearInterval(timer);
  } finally {
    busy = false;
  }
}

async function search(out) {
  waiting('Mencari mesin di jaringan (sampai 10 detik)…');
  try {
    const found = await api('scan_devices');
    out.innerHTML = found.length
      ? `<ul class="temuan">${found.map((f) => `<li><b>${esc(f.ip)}</b> · ${MODE[f.mode] ?? esc(f.mode)}${f.cloud_id ? ` · ${esc(f.cloud_id)}` : ''}` +
        `<span class="muted">${esc(f.note)}</span></li>`).join('')}</ul>`
      : '<p class="muted">Tidak ada mesin ditemukan. Pastikan mesin menyala dan satu jaringan dengan server Freedom Finger.</p>';
  } catch (e) {
    out.innerHTML = '';
    notify(`Gagal mencari mesin: ${e.message}`, true);
  } finally {
    waiting();
  }
}

// --- panduan pertama kali ------------------------------------------------------------------------

let guideTimer;
/** Panduan menghubungkan mesin: terbuka sendiri bila belum pernah ada mesin (main.js), atau dari tab Mesin. */
export async function guide() {
  const ip = serverIp ?? 'IP server Freedom Finger (lihat pengaturan jaringannya)';
  $('pd-isian').innerHTML = [['Mode', 'Internet'], ['Server IP', ip], ['Server Port', port], ['Server Req', 'Ya']]
    .map(([k, v]) => `<dt>${k}</dt><dd><b>${esc(v)}</b></dd>`).join('');
  $('pd-hasil').innerHTML = '';
  guideStatus();
  openDrawer('panduan', 'Hubungkan mesin absensi', 'Mesin muncul ±2 menit setelah menunya disimpan');
  // server tidak mengirim event untuk mesin baru: tanya daftar mesin selama panduan terbuka
  clearInterval(guideTimer);
  guideTimer = setInterval(async () => {
    if (!$('laci').open || $('panduan').hidden) return clearInterval(guideTimer);
    await loadDevices().catch(() => {});
    guideStatus();
  }, 5000);
}

/** Langkah 3: menunggu (lingkaran berputar), atau centang begitu ada mesin terhubung. */
function guideStatus() {
  const on = devices.filter((d) => d.connected);
  const off = devices.filter((d) => !d.connected);
  $('pd-ikon').classList.toggle('selesai', on.length > 0);
  $('pd-ikon').replaceChildren(createElement(on.length ? Check : MACHINE_ICON));
  $('pd-status').innerHTML = on.length
    ? `<b>${on.map((d) => esc(d.device_name || d.cloud_id)).join(', ')} terhubung.</b> Absen dari mesin kini masuk ke aplikasi ini.`
    : off.length ? `Menunggu… ${off.map((d) => esc(d.device_name || d.cloud_id)).join(', ')} pernah terhubung, tetapi sekarang terputus.`
      : 'Menunggu mesin menghubungi server Freedom Finger…';
  $('pd-ambil').disabled = !on.length;
}
