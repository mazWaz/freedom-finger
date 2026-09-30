// Tab Karyawan: nama lengkap, departemen, dan "ikut rekap" per PIN, serta ambil data karyawan dari
// mesin. Mesin hanya menjawab satu perintah setiap ±20 detik, jadi pengambilan berjalan lama; antrean
// perintahnya ada di server dan kemajuannya di aplikasi.json, sehingga tetap berlanjut walau
// aplikasi ditutup atau PC dimatikan.
import { $, byPin, call, data, devices, esc, knownPins, loadUsers, machineName, nameOf, notify, saveData, users } from './app.js';

export function init() {
  $('y-ambil').onclick = startPull;
  $('y-cari').oninput = filter;
  let saveTimer;
  // simpan saat mengetik (tertunda sebentar); tabel bisa digambar ulang saat data mesin masuk
  $('y-daftar').oninput = (e) => {
    const tr = e.target.closest('tr[data-pin]');
    if (!tr) return;
    const q = (k) => tr.querySelector(`[name=${k}]`);
    const name = q('name').value.trim();
    const dept = q('dept').value.trim();
    const recap = q('recap').checked;
    const schedule = q('schedule').value || undefined; // kosong = jadwal utama
    if (name || dept || !recap || schedule) data.employees[tr.dataset.pin] = { name, dept, recap, schedule };
    else delete data.employees[tr.dataset.pin];
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveData('employees'), e.target.matches('input[type=checkbox], select') ? 0 : 400);
  };
}

export function show() {
  const pins = knownPins();
  const status = pullStatus();
  $('y-status').textContent = status;
  $('y-status').hidden = !status;
  $('y-ambil').disabled = !!status;
  $('y-info').textContent = `${pins.length} karyawan`;
  // baris yang sama: cukup perbarui nama di mesin, supaya isian yang sedang diketik tidak hilang
  const tbody = $('y-daftar');
  const key = `${pins.join(',')}|${data.schedules.map((s) => `${s.id}=${s.name}`).join(',')}`;
  if (tbody.dataset.key === key) {
    for (const tr of tbody.rows) if (tr.dataset.pin) tr.querySelector('.di-mesin').textContent = diMesin(tr.dataset.pin, data.employees[tr.dataset.pin]?.name);
    return filter();
  }
  tbody.dataset.key = key;
  const options = (pin) => [{ id: '', name: 'Utama' }, ...data.schedules]
    .map((s) => `<option value="${esc(s.id)}"${(data.employees[pin]?.schedule ?? '') === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  tbody.innerHTML = pins
    .map((pin) => {
      const e = data.employees[pin] ?? {};
      const label = `PIN ${esc(pin)}`;
      // kotak isian "senyap": tanpa garis sampai baris disentuh, supaya tabel terbaca sebagai daftar
      return `<tr data-pin="${esc(pin)}"><td class="pin">${esc(pin)}</td>` +
        `<td><input class="senyap" name="name" value="${esc(e.name ?? '')}" placeholder="${esc(machineName(pin) || 'Nama lengkap')}" aria-label="Nama lengkap ${label}">` +
        `<small class="di-mesin">${esc(diMesin(pin, e.name))}</small></td>` +
        `<td><input name="dept" value="${esc(e.dept ?? '')}" placeholder="Isi departemen" class="senyap petunjuk" aria-label="Departemen ${label}"></td>` +
        `<td><select class="senyap" name="schedule" aria-label="Jadwal ${label}">${options(pin)}</select></td>` +
        `<td class="tengah"><input type="checkbox" class="saklar" name="recap"${e.recap === false ? '' : ' checked'} aria-label="Ikut rekap ${label}"></td></tr>`;
    })
    .join('') || '<tr><td colspan="5" class="muted">Belum ada data karyawan. Tekan Ambil data dari mesin.</td></tr>';
  filter();
}

/** Keterangan di bawah nama: nama di mesin bila berbeda dari nama lengkap, atau asal nama yang tampil. */
const diMesin = (pin, full) => (!machineName(pin) ? 'Belum ada nama di mesin' : full ? `Di mesin: ${machineName(pin)}` : 'Nama dari mesin');

/** Cari nama (di mesin atau lengkap) atau PIN: sembunyikan baris lain, tanpa menggambar ulang tabel. */
function filter() {
  const q = $('y-cari').value.trim().toLowerCase();
  for (const tr of $('y-daftar').rows) {
    const pin = tr.dataset.pin;
    if (pin) tr.hidden = !!q && !pin.includes(q) && !`${nameOf(pin)} ${machineName(pin)}`.toLowerCase().includes(q);
  }
}

function pullStatus() {
  const jobs = Object.values(data.pull);
  if (!jobs.length) return '';
  if (jobs.some((p) => !p.cmds)) return 'Menunggu daftar PIN dari mesin (±20 detik sampai 2 menit)…';
  const done = jobs.reduce((n, p) => n + p.done, 0);
  const total = jobs.reduce((n, p) => n + p.cmds.length, 0);
  return `Mengambil data karyawan: ${done} dari ${total}. Mesin menjawab ±20 detik per karyawan; aplikasi boleh ditutup, nanti dilanjutkan.`;
}

/** Daftar PIN yang tidak datang selama ini dianggap gagal (mis. mesin lama yang sudah dicabut). */
const WAIT_LIST_MS = 10 * 60_000;

async function startPull() {
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
    const waiting = r.status === 'pending' || r.status === 'sent';
    if (waiting && Date.now() - (p.at ?? 0) < WAIT_LIST_MS) return false;
    const pins = r.data?.pin_arr;
    if (waiting || r.status === 'timeout' || !pins) {
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
