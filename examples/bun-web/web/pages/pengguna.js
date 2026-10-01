// Pengguna aplikasi web, bagian dari menu Pengaturan: daftar user, tambah, hapus, dan ganti kata sandi
// sendiri. Semua user setara. Kata sandi hanya diperiksa dan disimpan (sebagai hash) oleh server web.
import { user, weak } from '../components/masuk.js';
import { request } from '../lib/api.js';
import { longDate } from '../lib/format.js';
import { $, ask, closeDrawer, esc, notify, openDrawer } from '../lib/ui.js';

export function init() {
  $('u-tambah-buka').onclick = () => {
    $('u-tambah').reset();
    openDrawer('u-tambah', 'Tambah pengguna', 'Bisa memakai semua menu aplikasi');
    $('u-tambah').elements.name.focus();
  };
  $('u-tambah').elements.batal.onclick = closeDrawer;
  $('u-tambah').onsubmit = add;
  $('u-daftar').onclick = (e) => {
    const b = e.target.closest('button[data-user]');
    if (b) remove(b.dataset.user);
  };
  $('p-sandi-buka').onclick = () => {
    $('p-sandi').reset();
    openDrawer('p-sandi', 'Ganti kata sandi', `User ${user}`);
    $('p-sandi').elements.lama.focus();
  };
  $('p-sandi').elements.batal.onclick = closeDrawer;
  $('p-sandi').onsubmit = changePassword;
}

export async function show() {
  const list = await request('/app/users').then((r) => r.data, (e) => notify(`Gagal memuat pengguna: ${e.message}`, true));
  if (!list) return;
  $('u-daftar').innerHTML = list.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.name === user ? ' <span class="redup">(Anda)</span>' : ''}</td>` +
    `<td>${esc(longDate(u.created.slice(0, 10)))}</td><td class="kanan">` +
    `${u.name === user ? '' : `<button class="mini bahaya" data-user="${esc(u.name)}" aria-label="Hapus user ${esc(u.name)}">Hapus</button>`}</td></tr>`).join('');
}

async function add(e) {
  e.preventDefault();
  const f = $('u-tambah').elements;
  const name = f.name.value.trim().toLowerCase();
  const problem = weak(f.sandi.value, f.ulang.value);
  if (problem) return notify(problem, true);
  try {
    await request('/app/users', 'POST', { name, password: f.sandi.value });
    closeDrawer();
    notify(`User ${name} ditambahkan. Beri tahu orangnya user dan kata sandinya.`);
    show();
  } catch (err) {
    notify(err.message, true);
  }
}

async function remove(name) {
  const yes = await ask(`Hapus user ${name}? Orang itu tidak bisa masuk lagi, dan sesinya yang sedang terbuka langsung berakhir.`,
    { title: 'Hapus pengguna', okLabel: 'Hapus' });
  if (!yes) return;
  try {
    await request(`/app/users/${encodeURIComponent(name)}`, 'DELETE');
    notify(`User ${name} dihapus.`);
    show();
  } catch (err) {
    notify(err.message, true);
  }
}

/** Kata sandi sendiri; perangkat lain yang login dengan user ini harus masuk lagi. */
async function changePassword(e) {
  e.preventDefault();
  const f = $('p-sandi').elements;
  const problem = weak(f.baru.value, f.ulang.value);
  if (problem) return notify(problem, true);
  try {
    await request('/app/password', 'POST', { old: f.lama.value, password: f.baru.value });
    $('p-sandi').reset();
    closeDrawer();
    notify('Kata sandi sudah diganti. Perangkat lain dengan user ini harus masuk lagi.');
  } catch (err) {
    notify(err.message, true);
  }
}
