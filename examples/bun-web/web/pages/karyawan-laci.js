// Laci per karyawan di menu Karyawan: nama dan hak admin di mesin, daftarkan wajah/jari/kartu/password
// (reg_online: layar daftar terbuka di mesin; hasilnya masuk ke cadangan di server), dan hapus dari mesin.
import { backups, command, devices, loadUsers, machineName } from '../lib/api.js';
import { data, nameOf, saveData } from '../lib/data.js';
import { today } from '../lib/format.js';
import { enrolled } from '../lib/hitung-rekap.js';
import { $, ask, closeDrawer, esc, notify, openDrawer, waiting } from '../lib/ui.js';
import {
  CARD, FACE, FINGERS, NONE, PASSWORD, credText, creds, got, latestUser, ok, refreshCreds, shortName, sleep, soleAdmin, status, targets, what,
} from './karyawan-bersama.js';

let changed = () => {}; // kredensial berubah: gambar ulang kolom di tabel karyawan

/** Tombol dan isian di laci; `onChange` dipanggil setelah kredensial seseorang berubah. */
export function initLaci(onChange) {
  changed = onChange;
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
}

// --- laci per karyawan: nama di mesin, admin, daftarkan, hapus -----------------------------------

let enrollPin = null; // PIN yang lacinya terbuka

export function openEnroll(pin) {
  enrollPin = pin;
  renderEnroll();
  openDrawer('y-laci-daftar', nameOf(pin), `PIN ${pin}`);
  refreshCreds(pin).then(() => {
    if (enrollPin === pin && !$('y-laci-daftar').hidden) renderEnroll();
    changed();
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

// --- hapus dari mesin -------------------------------------------------------------------------

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
        changed();
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
