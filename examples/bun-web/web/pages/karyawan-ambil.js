// Ambil data karyawan dari mesin (menu Karyawan). Mesin hanya menjawab satu perintah setiap ±20 detik,
// jadi pengambilan berjalan lama; antrean perintahnya ada di server dan kemajuannya di aplikasi.json,
// sehingga tetap berlanjut walau halaman ditutup.
// ponytail: kemajuan dijalankan halaman yang terbuka; dua orang membuka menu ini bersamaan bisa saling
// menolak simpan (409, lalu dimuat ulang). Pindahkan ke server web bila sering terjadi.
import { call, devices, loadUsers, users } from '../lib/api.js';
import { byPin, data, saveData } from '../lib/data.js';
import { notify } from '../lib/ui.js';

export function pullStatus() {
  const jobs = Object.values(data.pull);
  if (!jobs.length) return '';
  if (jobs.some((p) => !p.cmds)) return 'Menunggu daftar PIN dari mesin (±20 detik sampai 2 menit)…';
  const done = jobs.reduce((n, p) => n + p.done, 0);
  const total = jobs.reduce((n, p) => n + p.cmds.length, 0);
  return `Mengambil data karyawan: ${done} dari ${total}. Mesin menjawab ±20 detik per karyawan; aplikasi boleh ditutup, nanti dilanjutkan.`;
}

/** Daftar PIN yang tidak datang selama ini dianggap gagal (mis. mesin lama yang sudah dicabut). */
const WAIT_LIST_MS = 10 * 60_000;

export async function startPull() {
  // hanya mesin yang sedang terhubung: perintah untuk mesin yang dicabut menunggu selamanya
  const on = devices.filter((d) => d.connected);
  if (!on.length) return notify('Belum ada mesin yang terhubung. Lihat isian menu mesin di tab Hari ini.', true);
  try {
    for (const d of on) data.pull[d.cloud_id] = { trans: (await call('get_all_pin', { cloud_id: d.cloud_id })).trans_id, at: Date.now() };
  } catch (e) {
    notify(`Gagal meminta data ke mesin: ${e.message}`, true);
  }
  await saveData('employees');
  resumePull();
}

let timer;
/** Lanjutkan pengambilan yang sedang berjalan (juga setelah aplikasi dibuka ulang). */
export function resumePull() {
  clearInterval(timer);
  if (Object.keys(data.pull).length) timer = setInterval(tick, 15_000); // cadangan bila event realtime terlewat
  tick();
}

/** Hasil perintah dari event realtime: periksa kemajuan sekarang juga. */
export function onEvent(ev) {
  if (ev.type === 'get_all_pin' || ev.type === 'get_userinfo') tick();
}

let busy = false;
async function tick() {
  if (busy || !Object.keys(data.pull).length) return;
  busy = true;
  let changed = false;
  try {
    for (const [cloud_id, p] of Object.entries(data.pull)) {
      try {
        changed = (await step(cloud_id, p)) || changed;
      } catch (e) {
        // perintah tidak dikenal lagi (mis. database dipulihkan): berhenti; error lain dicoba lagi nanti
        if (!/trans_id tidak dikenal/.test(e.message)) continue;
        delete data.pull[cloud_id];
        notify(`Ambil data karyawan dari ${cloud_id} berhenti: ${e.message}`, true);
        changed = true;
      }
    }
    if (changed) {
      await loadUsers();
      await saveData('employees');
    }
    if (!Object.keys(data.pull).length) clearInterval(timer);
  } finally {
    busy = false;
  }
}

/** Satu langkah untuk satu mesin; `true` bila ada kemajuan. */
async function step(cloud_id, p) {
  let changed = false;
  if (!p.cmds) {
    const r = await call('get_result', { cloud_id, trans_id: p.trans });
    const pending = r.status === 'pending' || r.status === 'sent';
    if (pending && Date.now() - (p.at ?? 0) < WAIT_LIST_MS) return false;
    const pins = r.data?.pin_arr;
    if (pending || r.status === 'timeout' || !pins) {
      delete data.pull[cloud_id];
      notify(`Mesin ${cloud_id} tidak menjawab. Pastikan mesin terhubung (tab Hari ini), lalu coba lagi.`, true);
      return true;
    }
    // hanya PIN yang belum tercatat di server; urut supaya kemajuan bisa dicek dari depan
    const known = new Set(users.filter((u) => u.cloud_id === cloud_id).map((u) => u.pin));
    p.cmds = [];
    p.done = 0;
    for (const pin of pins.filter((x) => !known.has(x)).sort(byPin)) p.cmds.push((await call('get_userinfo', { cloud_id, pin })).trans_id);
    changed = true;
  }
  // mesin mengerjakan antrean berurutan: cukup periksa perintah terdepan yang belum selesai
  const before = p.done;
  while (p.done < p.cmds.length) {
    const r = await call('get_result', { cloud_id, trans_id: p.cmds[p.done] });
    if (r.status === 'pending' || r.status === 'sent') break;
    p.done++;
  }
  if (p.done === p.cmds.length) {
    delete data.pull[cloud_id];
    notify(`Data karyawan dari ${cloud_id} sudah lengkap.`);
  }
  return changed || p.done !== before;
}
