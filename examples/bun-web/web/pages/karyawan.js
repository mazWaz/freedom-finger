// Menu Karyawan: nama lengkap, departemen, jadwal, dan "ikut rekap" per PIN; tambah karyawan ke mesin;
// dan karyawan yang dihapus (bisa dipulihkan dari cadangan). Bagian lain menu ini:
// - karyawan-laci.js: laci per karyawan (nama di mesin, admin, daftarkan wajah/jari, hapus)
// - karyawan-ambil.js: ambil data karyawan dari mesin, berlanjut walau halaman ditutup
// - karyawan-bersama.js: kredensial dan perintah ke mesin yang dipakai bagian-bagian itu
// set_userinfo mengganti SELURUH data user: untuk orang yang sudah ada selalu kirim template.
import { createElement } from 'lucide';
import { backups, command, devices, loadUsers, machineName } from '../lib/api.js';
import { data, isRemoved, knownPins, nameOf, saveData, usedPins } from '../lib/data.js';
import { longDate, today } from '../lib/format.js';
import { enrolled } from '../lib/hitung-rekap.js';
import { $, MACHINE_ICON, ask, closeDrawer, esc, notify, openDrawer, waiting } from '../lib/ui.js';
import { pullStatus, startPull } from './karyawan-ambil.js';
import { NONE, credShort, creds, ok, refreshCreds, shortName, status } from './karyawan-bersama.js';
import { initLaci, openEnroll } from './karyawan-laci.js';

export { onEvent, resumePull } from './karyawan-ambil.js';

const MACHINE = createElement(MACHINE_ICON).outerHTML; // tombol baris: laci data di mesin

export function init() {
  $('y-ambil').onclick = startPull;
  $('y-cari').oninput = filter;
  $('y-tambah-buka').onclick = openAdd;
  const f = $('y-tambah');
  f.onsubmit = (e) => {
    e.preventDefault();
    add();
  };
  f.elements.batal.onclick = closeDrawer;
  f.elements.name.oninput = () => {
    const n = f.elements.name.value.trim();
    f.querySelector('[name=dimesin]').textContent = n.length > 15 ? `Di mesin tertulis "${shortName(n)}"` : 'Di mesin tertulis 15 huruf pertama';
  };
  $('y-daftar').onclick = (e) => {
    const b = e.target.closest('button[name=daftar]');
    if (b) openEnroll(b.closest('tr').dataset.pin);
  };
  initLaci(paintCreds);
  // akun uji dan sejenisnya: tidak tampil di Riwayat dan Rekap
  $('y-dihapus-daftar').onchange = (e) => {
    if (e.target.name !== 'recap') return;
    data.employees[e.target.closest('tr').dataset.pin].recap = e.target.checked;
    saveData('employees');
  };
  $('y-dihapus-daftar').onclick = (e) => {
    const b = e.target.closest('button[name=pulihkan]');
    if (b) restore(b.closest('tr').dataset.pin);
  };
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

export function show(reason) {
  const pins = knownPins();
  // cadangan berubah saat mesin mengirim data user; yang dihapus juga, untuk bagian Karyawan yang dihapus
  if (reason === 'open' || reason === 'users') loadCreds([...pins, ...usedPins().filter(isRemoved)]);
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
    paintCreds();
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
        `<td><span class="kred"><span></span><button type="button" class="mini ikon" name="daftar" aria-label="Data di mesin ${label}" title="Nama di mesin, admin, daftarkan, hapus">${MACHINE}</button></span></td>` +
        `<td class="tengah"><input type="checkbox" class="saklar" name="recap"${e.recap === false ? '' : ' checked'} aria-label="Ikut rekap ${label}"></td></tr>`;
    })
    .join('') || '<tr><td colspan="6" class="muted">Belum ada data karyawan. Tekan Ambil data dari mesin, atau Tambah karyawan.</td></tr>';
  paintCreds();
  filter();
}

// --- jari dan wajah yang terdaftar -------------------------------------------------------------

async function loadCreds(pins) {
  await Promise.all(pins.map(refreshCreds));
  paintCreds();
}
function paintCreds() {
  for (const tr of $('y-daftar').rows) {
    const c = creds.get(tr.dataset.pin);
    const box = tr.querySelector('.kred > span');
    if (!box || !c) continue;
    box.innerHTML = credShort(c) ? `<b>${credShort(c)}</b>` : 'Belum ada';
  }
  paintRemoved();
}

// --- tambah karyawan ----------------------------------------------------------------------------

function openAdd() {
  const f = $('y-tambah');
  f.reset();
  f.elements.schedule.innerHTML = [{ id: '', name: 'Utama' }, ...data.schedules].map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  // PIN berikutnya setelah yang terbesar yang pernah dipakai (juga karyawan yang sudah dihapus)
  f.elements.pin.value = String(Math.max(0, ...usedPins().map(Number).filter(Number.isFinite)) + 1);
  f.querySelector('[role=status]').hidden = true;
  f.elements.name.oninput();
  openDrawer('y-tambah', 'Tambah karyawan', 'Masuk ke mesin, lalu daftarkan wajah atau jari');
  f.elements.name.focus();
}

async function add() {
  const f = $('y-tambah').elements;
  const say = (text, error) => status($('y-tambah').querySelector('[role=status]'), text, error);
  const pin = f.pin.value.trim();
  const name = f.name.value.trim();
  if (knownPins().includes(pin)) return say(`PIN ${pin} sudah dipakai ${nameOf(pin)}. Pilih PIN lain.`, true);
  if (usedPins().includes(pin)) {
    return say(`PIN ${pin} pernah dipakai ${nameOf(pin)} (sudah dihapus). Riwayat absennya akan tercampur; pilih PIN lain, atau pulihkan ${nameOf(pin)} ` +
      'di bagian Karyawan yang dihapus.', true);
  }
  const on = devices.filter((d) => d.connected);
  if (!on.length) return say('Belum ada mesin yang terhubung. Lihat isian menu mesin di Hari ini.', true);
  try {
    // set_userinfo mengganti seluruh data user: PIN yang ternyata sudah ada di mesin akan kehilangan jari dan wajahnya
    for (const d of on) {
      waiting(`Memeriksa PIN ${pin} di mesin (±20 detik sampai 2 menit)…`);
      const r = ok(await command(d.cloud_id, 'get_all_pin'));
      if (!r.data?.pin_arr) throw new Error('Mesin tidak mengirim daftar PIN. Coba lagi.');
      if (r.data.pin_arr.includes(pin)) throw new Error(`PIN ${pin} sudah ada di mesin, tetapi datanya belum diambil ke aplikasi. Pilih PIN lain, atau tekan Ambil data dari mesin.`);
    }
    for (const d of on) {
      waiting(`Menambahkan ${name} ke mesin…`);
      ok(await command(d.cloud_id, 'set_userinfo', { data: { pin, name: shortName(name), privilege: f.privilege.value } }));
      // server baru mencatat hak aksesnya setelah membaca user ini; tanpa itu saklar Admin di laci tampil mati
      if (f.privilege.value !== '1') {
        waiting('Memeriksa hak akses di mesin…');
        ok(await command(d.cloud_id, 'get_userinfo', { pin }));
      }
    }
    await loadUsers();
    data.employees[pin] = { name, dept: f.dept.value.trim(), recap: true, schedule: f.schedule.value || undefined, added: today() };
    await saveData('employees');
    notify(`${name} ditambahkan ke mesin dengan PIN ${pin}.`);
    openEnroll(pin);
  } catch (e) {
    say(e.message, true);
  } finally {
    waiting();
  }
}

/** Bagian "Karyawan yang dihapus" di bawah tabel, dengan cadangan yang ikut kembali bila dipulihkan. */
function paintRemoved(pins = usedPins().filter(isRemoved)) {
  $('y-dihapus').hidden = !pins.length;
  $('y-dihapus').querySelector('summary').textContent = `Karyawan yang dihapus (${pins.length})`;
  $('y-dihapus-daftar').innerHTML = pins.map((pin) => {
    const c = creds.get(pin);
    return `<tr data-pin="${esc(pin)}"><td class="pin">${esc(pin)}</td><td>${esc(nameOf(pin))}</td>` +
      `<td>${esc(longDate(data.employees[pin].removed.slice(0, 10)))}</td><td>${c ? credShort(c) || 'Tanpa jari atau wajah' : '…'}</td>` +
      `<td class="tengah"><input type="checkbox" class="saklar" name="recap"${data.employees[pin].recap === false ? '' : ' checked'} ` +
      `aria-label="Ikut rekap ${esc(nameOf(pin))}"></td>` +
      `<td class="kanan"><button type="button" class="mini" name="pulihkan">Pulihkan</button></td></tr>`;
  }).join('');
}

/**
 * Kirim lagi ke mesin dari cadangan (nama, hak akses, jari, wajah, kartu, password, foto). PIN dicek dulu:
 * bila sudah dipakai orang lain di mesin, set_userinfo akan menimpa data orang itu.
 */
async function restore(pin) {
  const say = (text, error) => status($('y-dihapus').querySelector('[role=status]'), text, error);
  const on = devices.filter((d) => d.connected);
  if (!on.length) return say('Belum ada mesin yang terhubung. Lihat isian menu mesin di Hari ini.', true);
  const name = nameOf(pin);
  const saved = await backups(pin);
  const back = credShort(saved[0] ? enrolled(saved[0].body) : NONE);
  const yes = await ask(`Pulihkan ${name} (PIN ${pin}) ke mesin?\n\nYang ikut kembali: ${back || 'tanpa jari atau wajah'}` +
    `${saved[0]?.privilege === '2' ? ', dan hak admin mesin' : ''}. Setelah itu dia bisa absen lagi.`,
  { title: 'Pulihkan karyawan', kind: 'info', okLabel: 'Pulihkan', cancelLabel: 'Batal' });
  if (!yes) return;
  $('y-dihapus').querySelector('[role=status]').hidden = true;
  try {
    for (const d of on) {
      waiting(`Memeriksa PIN ${pin} di mesin (±20 detik sampai 2 menit)…`);
      const pins = ok(await command(d.cloud_id, 'get_all_pin')).data?.pin_arr;
      if (!pins) throw new Error('Mesin tidak mengirim daftar PIN. Coba lagi.');
      if (pins.includes(pin)) throw new Error(`PIN ${pin} sedang dipakai di mesin ${d.cloud_id}. ${name} tidak dipulihkan supaya data di mesin tidak tertimpa.`);
    }
    for (const d of on) {
      // cadangan mesin itu sendiri; mesin yang belum punya (mis. mesin baru) memakai cadangan terbaru
      const b = saved.find((x) => x.cloud_id === d.cloud_id) ?? saved[0];
      waiting(`Memulihkan ${name} ke mesin…`);
      ok(await command(d.cloud_id, 'set_userinfo', {
        data: b ? { pin, name: b.name || shortName(name), privilege: b.privilege, template: b.template } : { pin, name: shortName(name), privilege: '1' },
      }));
    }
    delete data.employees[pin].removed;
    await saveData('employees');
    notify(`${name} dipulihkan ke mesin${back ? ` dengan ${back}` : ', tanpa jari atau wajah: daftarkan lewat tombol mesin di barisnya'}.`);
  } catch (e) {
    say(e.message, true);
  } finally {
    waiting();
  }
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
