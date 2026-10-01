// Bagian tampilan yang dipakai semua tab: elemen, pesan, laci (modal), layar tunggu, dan halaman tabel.
import { ChevronLeft, ChevronRight, createElement } from 'lucide';
import { pad } from './format.js';

export const $ = (id) => document.getElementById(id);
// PIN dan nama datang dari mesin (atau siapa pun di LAN yang meniru mesin): jangan masuk HTML mentah
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --- halaman ----------------------------------------------------------------------------------

const PREV = createElement(ChevronLeft).outerHTML;
const NEXT = createElement(ChevronRight).outerHTML;

/**
 * Satu halaman dari `list` (`page` mulai 1, dijaga di dalam batas) dan tombol halamannya di `nav`:
 * "1–24 dari 57  ‹ 1 … 4 5 6 … 9 ›". Klik tombol memanggil `go(halaman)`; satu halaman saja = `nav`
 * disembunyikan. Hasil: [isi halaman, halaman yang dipakai].
 */
export function paginate(nav, list, page, size, go) {
  const last = Math.max(1, Math.ceil(list.length / size));
  page = Math.min(Math.max(page, 1), last);
  const near = [...new Set([1, page - 1, page, page + 1, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const btn = (n, text, label) => `<button type="button" data-hal="${n}" aria-label="${label ?? `Halaman ${n}`}"` +
    `${!label && n === page ? ' aria-current="page"' : ''}${n < 1 || n > last ? ' disabled' : ''}>${text}</button>`;
  nav.hidden = last < 2;
  nav.innerHTML = `<span>${(page - 1) * size + 1}–${Math.min(page * size, list.length)} dari ${list.length}</span>` +
    btn(page - 1, PREV, 'Halaman sebelumnya') +
    near.map((n, i) => `${n - (near[i - 1] ?? n) > 1 ? '<span aria-hidden="true">…</span>' : ''}${btn(n, n)}`).join('') +
    btn(page + 1, NEXT, 'Halaman berikutnya');
  nav.onclick = (e) => {
    const b = e.target.closest('button[data-hal]');
    if (!b) return;
    go(Number(b.dataset.hal));
    nav.querySelector('[aria-current="page"]')?.focus(); // tombolnya baru digambar ulang: fokus jangan hilang
  };
  return [list.slice((page - 1) * size, page * size), page];
}

// --- pesan untuk pengguna ---------------------------------------------------------------------

let hideTimer;
export function notify(text, error = false) {
  const p = $('pesan');
  p.textContent = text;
  p.className = error ? 'off' : 'ok';
  p.hidden = false;
  p.title = 'Klik untuk menutup';
  p.onclick = () => (p.hidden = true);
  clearTimeout(hideTimer);
  // pesan gagal tampil lebih lama agar sempat dibaca, tapi tetap hilang sendiri
  hideTimer = setTimeout(() => (p.hidden = true), error ? 20_000 : 8000);
}

/**
 * Laci (modal di tengah layar, `<dialog>`: fokus terkunci di dalam, Esc menutup): tampilkan satu isi
 * (`laci-orang`, `i-izin`, `y-laci-daftar`, …) dengan judul. Dipakai semua tab.
 */
export function openDrawer(pane, title, sub = '') {
  const d = $('laci');
  for (const el of d.querySelectorAll('.laci-isi')) el.hidden = el.id !== pane;
  $('laci-judul').textContent = title;
  $('laci-sub').textContent = sub;
  $('laci-sub').hidden = !sub;
  if (!d.open) d.showModal();
}
export const closeDrawer = () => $('laci').close();

/** Gambar mesin absensi bergaya Lucide (badan, layar, sensor jari); Lucide tidak punya ikon ini. */
export const MACHINE_ICON = [
  ['rect', { x: '5', y: '2', width: '14', height: '20', rx: '2' }],
  ['rect', { x: '8', y: '5', width: '8', height: '6', rx: '1' }],
  ['path', { d: 'M10 18.5v-2a2 2 0 0 1 4 0v2' }],
];

let waitStart = 0;
let waitTimer;
// Esc selama menunggu: diabaikan. Membatalkan `cancel` saja tidak cukup: Chromium menutup paksa pada Esc
// kedua, dan ikut menutup laci di bawahnya
addEventListener('keydown', (e) => {
  if (waitStart && e.key === 'Escape') e.preventDefault();
}, true);
/**
 * Layar tunggu selama menunggu mesin: spinner, pesan langkahnya, dan lama menunggu. Seluruh halaman
 * terkunci (`<dialog>` modal paling atas, juga di atas laci), dan Esc tidak menutupnya. Tanpa `text`: tutup.
 */
export function waiting(text) {
  const d = $('tunggu');
  if (!text) {
    waitStart = 0;
    clearInterval(waitTimer);
    return d.close();
  }
  $('tunggu-teks').textContent = text;
  if (waitStart) return;
  if (!d.querySelector('svg')) d.querySelector('.putar').append(createElement(MACHINE_ICON));
  d.oncancel = (e) => e.preventDefault();
  waitStart = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - waitStart) / 1000);
    $('tunggu-lama').textContent = `Sudah menunggu ${Math.floor(s / 60)}:${pad(s % 60)}`;
  };
  tick();
  waitTimer = setInterval(tick, 1000);
  d.showModal();
}
