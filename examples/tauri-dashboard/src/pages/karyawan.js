// Tab Karyawan: nama lengkap, departemen, dan "ikut rekap" per PIN, serta ambil data karyawan dari
// mesin. Mesin hanya menjawab satu perintah setiap ±20 detik, jadi pengambilan berjalan lama; antrean
// perintahnya ada di server dan kemajuannya di aplikasi.json, sehingga tetap berlanjut walau
// aplikasi ditutup atau PC dimatikan.
// Tambah karyawan (cek PIN di mesin, lalu set_userinfo) dan, di laci per karyawan: nama di mesin dan hak
// admin, daftarkan wajah/jari/kartu/password (reg_online: layar daftar terbuka di mesin; hasilnya masuk ke
// cadangan di server, lihat backups), dan hapus dari mesin. Karyawan yang dihapus bisa dipulihkan dari
// cadangan itu. set_userinfo mengganti SELURUH data user: untuk orang yang sudah ada selalu kirim template.
import { ask } from '@tauri-apps/plugin-dialog';
import { createElement } from 'lucide';
import { backups, call, command, devices, loadUsers, machineName, users } from '../lib/api.js';
import { byPin, data, isRemoved, knownPins, nameOf, saveData, usedPins } from '../lib/data.js';
import { longDate, today } from '../lib/format.js';
import { enrolled } from '../lib/hitung-rekap.js';
import { $, MACHINE_ICON, closeDrawer, esc, notify, openDrawer, waiting } from '../lib/ui.js';
import { REJECT } from './mesin.js';

const PASSWORD = 10; // backup_number: jari 0-9, password 10, kartu 11, wajah 12
const CARD = 11;
const FACE = 12;
const FINGERS = Array.from({ length: 10 }, (_, i) => `Jari ${i + 1}`);
const what = (no) => ({ [PASSWORD]: 'Password', [CARD]: 'Kartu', [FACE]: 'Wajah' })[no] ?? FINGERS[no];
/** Sudah terdaftar menurut enrolled(): nomor jari, password, kartu, atau wajah. */
const got = (c, no) => ({ [PASSWORD]: c.password, [CARD]: c.card, [FACE]: c.face })[no] ?? c.fingers.includes(no);
/** Nama di mesin: 15 huruf pertama (batas mesin), tanpa spasi di ujung. */
const shortName = (name) => name.slice(0, 15).trim();
const NONE = { fingers: [], password: false, card: false, face: false };
const creds = new Map(); // PIN -> enrolled(): gabungan cadangan semua mesin
const credText = (c) => [...c.fingers.map((n) => FINGERS[n]), c.face && 'wajah', c.card && 'kartu', c.password && 'password'].filter(Boolean).join(', ');
/** Ringkas untuk tabel: "2 jari, wajah, kartu". */
const credShort = (c) => [c.fingers.length && `${c.fingers.length} jari`, c.face && 'wajah', c.card && 'kartu', c.password && 'password']
  .filter(Boolean).join(', ');
/** User terbaru di server untuk PIN ini (nama dan hak akses di mesin), dari semua mesin. */
const latestUser = (pin) => users.filter((u) => u.pin === pin).sort((a, b) => a.updated.localeCompare(b.updated)).at(-1);
/** Mesin tempat PIN ini satu-satunya admin: tanpa admin, siapa pun bisa membuka menu mesin. */
const soleAdmin = (pin) => users.filter((u) => u.pin === pin && u.privilege === '2' && !users.some((o) =>
  o.cloud_id === u.cloud_id && o.pin !== pin && o.privilege === '2' && !isRemoved(o.pin))).map((u) => u.cloud_id);
/**
 * Mesin terhubung yang punya PIN ini. Belum tercatat di mana pun (baru ditambah, belum mendaftar) = semua
 * mesin terhubung. Perintah untuk PIN yang tidak ada di mesin tidak dijawab (menunggu 5 menit).
 */
function targets(pin) {
  const on = devices.filter((d) => d.connected);
  if (!on.length) throw new Error('Belum ada mesin yang terhubung. Lihat isian menu mesin di Hari ini.');
  const has = on.filter((d) => users.some((u) => u.cloud_id === d.cloud_id && u.pin === pin));
  return has.length ? has : on;
}
/** Pesan di paragraf status `p` (merah bila `error`). */
function status(p, text, error = false) {
  p.textContent = text;
  p.className = error ? 'catatan' : 'catatan info';
  p.hidden = false;
}
/** Hasil perintah yang berhasil, atau Error dengan pesan untuk pengguna. */
function ok(r) {
  if (r.status === 'done' && r.result_code === 'OK') return r;
  throw new Error(r.status === 'offline' ? 'Mesin terputus sebelum mengambil perintah ini. Perintahnya tetap menunggu dan dijalankan saat mesin tersambung lagi.'
    : r.status === 'timeout' ? 'Mesin tidak menjawab. Pastikan mesin terhubung, lalu coba lagi.'
      : `Mesin menolak: ${REJECT[r.result_code] ?? r.result_code}.`);
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
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
  const pane = $('y-laci-daftar');
  pane.onclick = (e) => {
    const b = e.target.closest('button');
    if (b?.name === 'hapus') remove(enrollPin);
    else if (b?.name === 'simpan-mesin') saveMachine(enrollPin);
    else if (b?.dataset.no) enroll(enrollPin, Number(b.dataset.no === 'jari' ? pane.querySelector('[name=jari]').value : b.dataset.no));
  };
  pane.oninput = (e) => {
    if (e.target.name === 'dimesin') lettersLeft();
    // hapus baru bisa setelah PIN diketik ulang
    else if (e.target.name === 'konfirmasi') pane.querySelector('[name=hapus]').disabled = e.target.value.trim() !== enrollPin;
  };
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
async function refreshCreds(pin) {
  const all = (await backups(pin)).map((b) => enrolled(b.body));
  const any = (k) => all.some((c) => c[k]);
  creds.set(pin, { fingers: [...new Set(all.flatMap((c) => c.fingers))].sort((a, b) => a - b), password: any('password'), card: any('card'), face: any('face') });
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

// --- laci per karyawan: nama di mesin, admin, daftarkan, hapus -----------------------------------

let enrollPin = null; // PIN yang lacinya terbuka

function openEnroll(pin) {
  enrollPin = pin;
  renderEnroll();
  openDrawer('y-laci-daftar', nameOf(pin), `PIN ${pin}`);
  refreshCreds(pin).then(() => {
    if (enrollPin === pin && !$('y-laci-daftar').hidden) renderEnroll();
    paintCreds();
  });
}

function renderEnroll() {
  const pin = enrollPin;
  const c = creds.get(pin) ?? NONE;
  const on = devices.filter((d) => d.connected);
  const free = FINGERS.findIndex((_, i) => !c.fingers.includes(i));
  const name = machineName(pin) || shortName(data.employees[pin]?.name ?? '');
  $('y-laci-daftar').innerHTML =
    `<div class="bidang">Terdaftar di mesin<p class="kred"><b>${esc(credText(c) || 'Belum ada wajah, jari, kartu, atau password')}</b></p></div>` +
    `<p class="catatan${on.length ? ' info' : ''}" role="status"${on.length ? ' hidden' : ''}>${on.length ? '' : 'Belum ada mesin yang terhubung. Lihat isian menu mesin di Hari ini.'}</p>` +
    (on.length > 1 ? `<label class="bidang">Mesin <select name="mesin">${on.map((d) => `<option>${esc(d.cloud_id)}</option>`).join('')}</select></label>` : '') +
    '<h3>Di mesin</h3>' +
    `<label class="bidang">Nama di mesin <input name="dimesin" maxlength="15" value="${esc(name)}" autocomplete="off"><small name="sisa"></small></label>` +
    `<label class="bidang centang"><input type="checkbox" class="saklar" name="admin"${latestUser(pin)?.privilege === '2' ? ' checked' : ''}> Admin mesin</label>` +
    '<p class="muted kecil">Admin bisa membuka menu mesin: menambah dan menghapus karyawan, mengubah pengaturan, dan menghapus data absen. ' +
    'Bila mesin tidak punya admin sama sekali, siapa pun bisa membuka menunya.</p>' +
    '<div><button type="button" name="simpan-mesin">Simpan ke mesin</button></div>' +
    '<h3>Daftarkan</h3>' +
    `<p class="muted">Minta ${esc(nameOf(pin))} berdiri di depan mesin, lalu pilih yang didaftarkan. Layar pendaftaran terbuka sendiri ` +
    'di mesin ±20 detik sampai 2 menit kemudian. Kartu ditempelkan di mesin; password diketik sendiri di mesin, tidak lewat aplikasi.</p>' +
    `<div class="tindakan"><button type="button" class="utama" data-no="${FACE}">${c.face ? 'Daftarkan ulang wajah' : 'Daftarkan wajah'}</button>` +
    `<div class="baris-jari"><select name="jari" aria-label="Jari">${FINGERS.map((f, i) =>
      `<option value="${i}"${i === (free < 0 ? 0 : free) ? ' selected' : ''}>${f}${c.fingers.includes(i) ? ' (sudah terdaftar)' : ''}</option>`).join('')}</select>` +
    '<button type="button" data-no="jari">Daftarkan jari</button></div>' +
    `<div class="baris-jari rata"><button type="button" data-no="${CARD}">${c.card ? 'Ganti kartu' : 'Daftarkan kartu'}</button>` +
    `<button type="button" data-no="${PASSWORD}">${c.password ? 'Ganti password' : 'Atur password'}</button></div></div>` +
    '<div class="hapus-karyawan">' +
    (soleAdmin(pin).length ? `<p class="catatan">${esc(nameOf(pin))} adalah admin terakhir di mesin. Bila dihapus, siapa pun bisa membuka menu mesin; ` +
      'jadikan orang lain admin dulu.</p>' : '') +
    `<div class="baris-jari"><input name="konfirmasi" inputmode="numeric" autocomplete="off" placeholder="Ketik PIN ${esc(pin)}" ` +
    `aria-label="Ketik PIN ${esc(pin)} untuk menghapus"><button type="button" name="hapus" class="bahaya">Hapus dari mesin</button></div>` +
    '<p class="muted kecil">Orang ini tidak bisa absen lagi. Riwayat absennya tetap ada, dan cadangan jari/wajahnya tetap tersimpan di aplikasi, ' +
    'jadi bisa dipulihkan.</p></div>';
  lettersLeft();
  // selama menunggu mesin seluruh halaman terkunci (waiting); di sini cukup: tanpa mesin terhubung, tombol mati
  for (const el of $('y-laci-daftar').querySelectorAll('button, select, input')) el.disabled = !on.length;
  $('y-laci-daftar').querySelector('[name=hapus]').disabled = true;
}

/** Sisa huruf nama di mesin (maksimal 15). */
function lettersLeft() {
  const pane = $('y-laci-daftar');
  const n = 15 - pane.querySelector('[name=dimesin]').value.length;
  pane.querySelector('[name=sisa]').textContent = `Sisa ${n} huruf. Nama lengkap di aplikasi tidak ikut berubah.`;
}

/** Pesan di laci, bila laci PIN ini yang terbuka. */
function tell(pin, text, error) {
  if (pin === enrollPin) status($('y-laci-daftar').querySelector('[role=status]'), text, error);
}

// --- nama di mesin dan admin ---------------------------------------------------------------------

/**
 * set_userinfo mengganti seluruh data user, jadi data TERBARU diambil dulu dari mesin (get_userinfo, bukan
 * cadangan lama) dan template-nya (jari, wajah, kartu, password, foto) dikirim ulang bersama nama dan hak
 * akses baru. Sesudahnya dibaca lagi: server mencatat nama baru, dan kredensialnya dipastikan tetap sama.
 */
async function saveMachine(pin) {
  const pane = $('y-laci-daftar');
  const name = pane.querySelector('[name=dimesin]').value.trim();
  const admin = pane.querySelector('[name=admin]').checked;
  if (!name) return tell(pin, 'Isi nama di mesin.', true);
  if (name === machineName(pin) && admin === (latestUser(pin)?.privilege === '2')) return tell(pin, 'Tidak ada yang berubah.');
  if (!admin && soleAdmin(pin).length && !await ask(`${nameOf(pin)} adalah admin terakhir di mesin. Tanpa admin, siapa pun bisa membuka menu mesin: ` +
    'menambah dan menghapus karyawan, mengubah pengaturan, dan menghapus data absen.\n\nTetap cabut hak admin?',
  { title: 'Admin terakhir', kind: 'warning', okLabel: 'Cabut admin', cancelLabel: 'Batal' })) {
    pane.querySelector('[name=admin]').checked = true;
    return;
  }
  let fingers;
  try {
    for (const d of targets(pin)) {
      waiting('Mengambil data terbaru dari mesin (±20 detik sampai 2 menit)…');
      const now = ok(await command(d.cloud_id, 'get_userinfo', { pin })).data;
      if (!now?.template) throw new Error('Mesin tidak mengirim data lengkapnya, jadi tidak ada yang diubah.');
      // kosong = hak akses tetap seperti di mesin (juga subadmin)
      const privilege = admin === (now.privilege === '2') ? '' : admin ? '2' : '1';
      waiting('Menyimpan nama dan hak akses ke mesin…');
      ok(await command(d.cloud_id, 'set_userinfo', { data: { pin, name, privilege, template: now.template } }));
      waiting('Memeriksa hasilnya di mesin…');
      const after = ok(await command(d.cloud_id, 'get_userinfo', { pin })).data;
      if (['finger', 'face', 'password', 'rfid'].some((k) => after?.[k] !== now[k])) {
        throw new Error(`Data di mesin berubah sesudah disimpan: jari ${now.finger} → ${after?.finger}, wajah ${now.face} → ${after?.face}. ` +
          'Periksa di mesin; bila perlu daftarkan ulang.');
      }
      fingers = now.finger;
    }
    await loadUsers();
    await refreshCreds(pin);
    if (pin === enrollPin) renderEnroll();
    const text = `Nama di mesin untuk PIN ${pin}: ${name}${admin ? ', admin mesin' : ''}. Jari sebelum dan sesudah: ${fingers}; ` +
      'wajah, kartu, dan password tidak berubah.';
    tell(pin, text);
    notify(text);
  } catch (e) {
    tell(pin, e.message, true);
  } finally {
    waiting();
  }
}

// --- hapus dari mesin dan pulihkan ---------------------------------------------------------------

/** Konfirmasinya PIN yang diketik ulang di laci (tombol mati sampai cocok). */
async function remove(pin) {
  const name = nameOf(pin);
  try {
    // hanya mesin yang punya data orang ini: DELETE_USER untuk PIN yang tidak ada tidak dijawab mesin
    for (const d of targets(pin)) {
      waiting(`Menghapus ${name} dari mesin (±20 detik sampai 2 menit)…`);
      ok(await command(d.cloud_id, 'delete_userinfo', { pin }));
    }
    data.employees[pin] = { ...data.employees[pin], removed: `${today()} ${new Date().toTimeString().slice(0, 8)}` };
    await saveData('employees');
    if (pin === enrollPin) closeDrawer();
    notify(`${name} dihapus dari mesin. Riwayat absennya tetap ada.`);
  } catch (e) {
    tell(pin, e.message, true);
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

// --- daftarkan wajah, jari, kartu, atau password ------------------------------------------------

async function enroll(pin, no) {
  const pane = $('y-laci-daftar');
  const cloud_id = pane.querySelector('[name=mesin]')?.value ?? devices.find((d) => d.connected)?.cloud_id;
  if (!cloud_id) return tell(pin, 'Belum ada mesin yang terhubung.', true);
  const label = what(no);
  const who = nameOf(pin);
  try {
    const before = (await backups(pin)).find((b) => b.cloud_id === cloud_id)?.updated;
    waiting(`Menunggu mesin (±20 detik sampai 2 menit). Minta ${who} bersiap di depan mesin.`);
    ok(await command(cloud_id, 'reg_online', { pin, verification: no }));
    waiting(`Layar pendaftaran ${label.toLowerCase()} terbuka di mesin. ` + ({
      [CARD]: `Minta ${who} menempelkan kartunya di mesin.`,
      [PASSWORD]: `Minta ${who} mengetik password di mesin, lalu ikuti petunjuk di layar mesin.`,
    }[no] ?? 'Ikuti petunjuk di layar mesin.'));
    // mesin mengirim data user setelah pendaftaran berhasil; server menyimpannya sebagai cadangan
    for (const start = Date.now(); ; ) {
      await sleep(3000);
      const b = (await backups(pin)).find((x) => x.cloud_id === cloud_id);
      if (b && b.updated !== before) {
        const done = got(enrolled(b.body), no);
        await refreshCreds(pin);
        paintCreds();
        if (pin === enrollPin && !pane.hidden) renderEnroll();
        tell(pin, done ? `${label} ${who} terdaftar.` : `Data dari mesin masuk, tetapi ${label.toLowerCase()} belum tercatat. Coba lagi.`, !done);
        notify(done ? `${label} ${who} terdaftar di mesin.` : `Pendaftaran ${label.toLowerCase()} ${who} belum berhasil.`, !done);
        return;
      }
      if (Date.now() - start > 3 * 60_000) throw new Error('Belum ada data dari mesin. Bila pendaftaran dibatalkan atau gagal di mesin, coba lagi.');
    }
  } catch (e) {
    tell(pin, e.message, true);
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
