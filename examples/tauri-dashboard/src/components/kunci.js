// Kunci aplikasi: kata sandi dibuat saat aplikasi pertama kali dibuka, lalu diminta setiap aplikasi
// dibuka, lewat tombol Kunci, dan setelah jendela tersembunyi lebih dari 5 menit. Yang disimpan hanya
// hash PBKDF2 (WebCrypto) di aplikasi.json. Selama terkunci, server dan tugas latar (tarik log,
// backup) tetap berjalan.
// ponytail: hanya mengunci tampilan; orang yang bisa membuka folder data aplikasi tetap bisa membaca
// datanya atau menghapus "auth" di aplikasi.json (itu juga jalan keluar bila lupa kata sandi).
import { data, saveData } from '../lib/data.js';
import { $, closeDrawer, notify } from '../lib/ui.js';

const ITERATIONS = 310_000;
const MIN_LENGTH = 6;
const IDLE_MS = 5 * 60_000;

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return b64(new Uint8Array(bits));
}

async function makeAuth(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), iterations: ITERATIONS, hash: await derive(password, salt, ITERATIONS) };
}

const matches = async (password) => (await derive(password, unb64(data.auth.salt), data.auth.iterations)) === data.auth.hash;

/** Pesan kesalahan untuk kata sandi baru, atau kosong bila boleh dipakai. */
const weak = (a, b) => (a.length < MIN_LENGTH ? `Kata sandi minimal ${MIN_LENGTH} karakter.` : a !== b ? 'Kedua kata sandi tidak sama.' : '');

const form = () => $('kunci-form').elements;
let opened; // dipanggil setiap aplikasi terbuka

export function init(onOpen) {
  opened = onOpen;
  $('kunci-form').onsubmit = submit;
  $('tombol-kunci').onclick = lock;
  $('p-sandi').onsubmit = change;
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (data.auth && Date.now() - hiddenAt > IDLE_MS) lock();
  });
}

/** Data aplikasi sudah dimuat: minta kata sandi, atau minta dibuatkan bila belum ada. */
export function ready() {
  const f = form();
  const setup = !data.auth;
  $('kunci-kantor').textContent = data.office;
  $('kunci-kantor').hidden = !data.office;
  $('kunci-teks').textContent = setup
    ? 'Buat kata sandi untuk aplikasi ini. Kata sandi diminta setiap aplikasi dibuka.'
    : 'Masukkan kata sandi untuk membuka aplikasi.';
  $('kunci-ulang').hidden = !setup;
  f.ulang.required = setup;
  f.sandi.autocomplete = setup ? 'new-password' : 'current-password';
  f.buka.textContent = setup ? 'Simpan dan buka' : 'Buka';
  $('kunci-lupa').hidden = setup;
  f.sandi.disabled = f.buka.disabled = false;
  f.sandi.focus();
}

/** Aplikasi gagal mulai: tampilkan sebabnya di layar kunci juga. */
export function failed(text) {
  $('kunci-teks').textContent = text;
  $('kunci-teks').className = 'merah';
}

export function lock() {
  if (!data.auth) return;
  closeDrawer(); // panel modal membuat layar kunci tidak bisa diketik
  document.body.classList.add('terkunci');
  $('kunci-form').reset();
  ready();
}

function wrong(text) {
  $('kunci-salah').textContent = text;
  $('kunci-salah').hidden = !text;
}

async function submit(e) {
  e.preventDefault();
  const f = form();
  f.buka.disabled = true;
  try {
    if (!data.auth) {
      const problem = weak(f.sandi.value, f.ulang.value);
      if (problem) return wrong(problem);
      data.auth = await makeAuth(f.sandi.value);
      try {
        await saveData(null);
      } catch (err) {
        delete data.auth;
        return wrong(`Gagal menyimpan kata sandi: ${err}`);
      }
    } else if (!(await matches(f.sandi.value))) {
      f.sandi.select();
      return wrong('Kata sandi salah.');
    }
    wrong('');
    $('kunci-form').reset();
    document.body.classList.remove('terkunci');
    opened?.();
  } finally {
    f.buka.disabled = false;
  }
}

async function change(e) {
  e.preventDefault();
  const f = $('p-sandi').elements;
  if (!(await matches(f.lama.value))) return notify('Kata sandi sekarang salah.', true);
  const problem = weak(f.baru.value, f.ulang.value);
  if (problem) return notify(problem, true);
  data.auth = await makeAuth(f.baru.value);
  await saveData(null);
  $('p-sandi').reset();
  closeDrawer();
  notify('Kata sandi sudah diganti.');
}
