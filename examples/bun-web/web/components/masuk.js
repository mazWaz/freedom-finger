// Layar login: user dan kata sandi diperiksa server web (server/auth.ts); halaman tidak menyimpan
// kata sandi apa pun. Saat belum ada user sama sekali, form yang sama membuat user pertama. Kelola user
// dan ganti kata sandi ada di menu Pengaturan (pages/pengguna.js).
import { $ } from '../lib/ui.js';

export const MIN_PASSWORD = 8;
/** User yang sedang login. */
export let user = null;

/** Pesan kesalahan untuk kata sandi baru, atau kosong bila boleh dipakai. */
export const weak = (a, b) => (a.length < MIN_PASSWORD ? `Kata sandi minimal ${MIN_PASSWORD} karakter.` : a !== b ? 'Kedua kata sandi tidak sama.' : '');

function wrong(text) {
  $('masuk-salah').textContent = text;
  $('masuk-salah').hidden = !text;
}

function enter(name) {
  user = name;
  $('user-aktif').textContent = name;
  document.body.classList.remove('belum-masuk');
  return name;
}

/** Selesai bila sudah login (sesi lama masih berlaku, atau lewat form); hasilnya nama user. */
export async function login() {
  const me = await fetch('/app/me').then((r) => r.json()).catch(() => null);
  if (me?.success) return enter(me.user);
  if (!me) {
    $('masuk-teks').textContent = 'Server web tidak bisa dihubungi. Periksa servernya, lalu muat ulang halaman ini.';
    $('masuk-teks').className = 'merah';
    return new Promise(() => {});
  }
  const setup = !!me.setup;
  const f = $('masuk-form').elements;
  $('masuk-teks').textContent = setup ? 'Belum ada pengguna. Buat user pertama untuk aplikasi ini.' : 'Masuk dengan user dan kata sandi Anda.';
  $('masuk-ulang').hidden = !setup;
  f.ulang.required = setup;
  f.sandi.autocomplete = setup ? 'new-password' : 'current-password';
  f.buka.textContent = setup ? 'Buat user dan masuk' : 'Masuk';
  $('masuk-lupa').hidden = setup;
  f.name.disabled = f.sandi.disabled = f.buka.disabled = false;
  f.name.focus();
  return new Promise((resolve) => {
    $('masuk-form').onsubmit = async (e) => {
      e.preventDefault();
      const problem = setup ? weak(f.sandi.value, f.ulang.value) : '';
      if (problem) return wrong(problem);
      f.buka.disabled = true;
      try {
        const r = await fetch(setup ? '/app/setup' : '/app/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: f.name.value.trim().toLowerCase(), password: f.sandi.value }),
        });
        const j = await r.json();
        if (!j.success) {
          f.sandi.select();
          return wrong(j.message);
        }
        wrong('');
        $('masuk-form').reset();
        resolve(enter(j.user));
      } catch (err) {
        wrong(`Server web tidak bisa dihubungi: ${err.message}`);
      } finally {
        f.buka.disabled = false;
      }
    };
  });
}

export async function logout() {
  await fetch('/app/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}
