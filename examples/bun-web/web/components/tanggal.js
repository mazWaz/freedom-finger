// Pemilih tanggal dan rentang tanggal: tampil "1 Januari 2026" dengan kalender berbahasa Indonesia,
// apa pun bahasa OS-nya (tampilan <input type="date"> bawaan mengikuti OS/WebView).
// <input type="date"> di index.html tetap menjadi tempat nilai (YYYY-MM-DD, disembunyikan), jadi tab
// lain tetap membaca/mengisi `.value`, `required`, dan `change` seperti biasa. Rentang = input dari
// dengan `data-sampai="<id input sampai>"`, dengan rentang cepat (1 minggu, 1 bulan, …); `change`-nya
// dikirim sekali, di input dari.
import { Calendar, ChevronLeft, ChevronRight, createElement } from 'lucide';
import { longDate, monthName, ranges, today } from '../lib/format.js';
import { addDays, addMonths, weekday } from '../lib/hitung-rekap.js';
import { $ } from '../lib/ui.js';

const HEAD = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const PREV = createElement(ChevronLeft).outerHTML;
const NEXT = createElement(ChevronRight).outerHTML;
const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

const pop = Object.assign(document.createElement('div'), { id: 'kalender', className: 'kalender', popover: 'auto' });
pop.setAttribute('role', 'dialog');
pop.setAttribute('aria-label', 'Kalender');
/** Pemilih yang sedang terbuka: {btn, inputs, month: "YYYY-MM", start: awal rentang yang baru diklik, focus} */
let cur = null;

export function init() {
  const ends = new Set([...document.querySelectorAll('input[data-sampai]')].map((i) => i.dataset.sampai));
  for (const input of document.querySelectorAll('input[type="date"]')) {
    if (!ends.has(input.id)) enhance(input, input.dataset.sampai && $(input.dataset.sampai));
  }
  pop.onclick = click;
  pop.onkeydown = keys;
  pop.addEventListener('toggle', (e) => {
    cur.btn.setAttribute('aria-expanded', e.newState === 'open');
    // ditutup dengan Esc (fokus di kalender hilang): kembalikan ke tombolnya
    if (e.newState === 'closed' && (!document.activeElement || document.activeElement === document.body)) cur.btn.focus();
  });
  document.body.append(pop);
}

function enhance(from, to) {
  const inputs = to ? [from, to] : [from];
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'pilih-tanggal' });
  btn.setAttribute('popovertarget', pop.id); // hanya supaya klik tombol ini tidak dihitung klik di luar kalender
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  const text = document.createElement('span');
  btn.append(createElement(Calendar), text);
  from.before(btn); // sebelum input: <label> di sekitarnya menunjuk tombol ini
  const label = from.getAttribute('aria-label');
  const paint = () => {
    const [a, b] = inputs.map((i) => i.value);
    text.textContent = !a ? (to ? 'Pilih rentang tanggal' : 'Pilih tanggal') : !to || a === b ? longDate(a) : `${longDate(a)} – ${longDate(b)}`;
    if (label) btn.setAttribute('aria-label', `${label}: ${text.textContent}`);
  };
  const picker = { btn, inputs };
  for (const i of inputs) {
    i.hidden = true;
    Object.defineProperty(i, 'value', { get: () => native.get.call(i), set: (v) => (native.set.call(i, v), paint()) });
    i.focus = (o) => btn.focus(o);
    // wajib diisi tapi kosong saat form dikirim: input tersembunyi tak bisa menampilkan pesan, buka kalendernya
    i.addEventListener('invalid', (e) => {
      e.preventDefault();
      if (i.form.querySelector('input:invalid, select:invalid') === i) show(picker);
    });
  }
  from.form?.addEventListener('reset', () => setTimeout(paint));
  btn.onclick = (e) => {
    e.preventDefault(); // buka/tutup diatur di sini, bukan oleh popovertarget
    if (pop.matches(':popover-open') && cur.btn === btn) pop.hidePopover();
    else show(picker);
  };
  paint();
}

function show(picker) {
  if (pop.matches(':popover-open')) pop.hidePopover();
  cur?.btn.setAttribute('aria-expanded', 'false');
  cur = { ...picker, month: (picker.inputs[0].value || today()).slice(0, 7), start: null, focus: null };
  (picker.btn.closest('dialog') ?? document.body).append(pop); // di luar laci (dialog modal), kalender tak bisa diklik
  draw();
  pop.showPopover();
  const r = picker.btn.getBoundingClientRect();
  const { width, height } = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`;
  pop.style.top = `${r.bottom + 4 + height > innerHeight - 8 ? Math.max(8, r.top - 4 - height) : r.bottom + 4}px`;
  pop.querySelector('.hari [tabindex="0"]').focus();
}

/** Gambar ulang kalender; `focus` = selector yang diberi fokus sesudahnya. */
function draw(focus) {
  const { inputs, month, start } = cur;
  const [a, b = a] = start ? [start] : inputs.map((i) => i.value);
  const t = today();
  const first = `${month}-01`;
  const roving = [cur.focus, start, a, t].find((d) => d?.startsWith(month)) ?? first; // satu-satunya hari yang kena Tab
  let days = '';
  for (let i = 0, d = addDays(first, -((weekday(first) + 6) % 7)); i < 42; i++, d = addDays(d, 1)) {
    const ends = d === a || d === b;
    const cls = [d.startsWith(month) ? '' : 'lain', d === t ? 'ini' : '', ends ? 'pilih' : a < d && d < b ? 'antara' : ''];
    days += `<button type="button" data-d="${d}" class="${cls.join(' ').trim()}" tabindex="${d === roving ? 0 : -1}" ` +
      `aria-label="${longDate(d)}"${ends ? ' aria-pressed="true"' : ''}${d === t ? ' aria-current="date"' : ''}>${Number(d.slice(8))}</button>`;
  }
  const [va, vb] = inputs.map((i) => i.value);
  const presets = inputs.length < 2 ? '' : `<div class="preset">${Object.entries(ranges())
    .map(([name, [f, s]]) => `<button type="button" data-rentang="${f} ${s}"${f === va && s === vb ? ' aria-pressed="true"' : ''}>${name}</button>`)
    .join('')}</div>`;
  const foot = inputs.length > 1
    ? `<p class="petunjuk">${start ? `Mulai ${longDate(start)}. Pilih tanggal akhir.` : 'Klik tanggal awal, lalu tanggal akhir.'}</p>`
    : `<div class="bawah"><button type="button" data-d="${t}">Hari ini</button>${inputs[0].required ? '' : '<button type="button" data-d="">Kosongkan</button>'}</div>`;
  pop.innerHTML = `${presets}<div class="bulan">
    <header><button type="button" data-geser="-1" aria-label="Bulan sebelumnya">${PREV}</button><b aria-live="polite">${monthName(month)}</b>` +
    `<button type="button" data-geser="1" aria-label="Bulan berikutnya">${NEXT}</button></header>
    <div class="hari">${HEAD.map((h) => `<span aria-hidden="true">${h}</span>`).join('')}${days}</div>${foot}</div>`;
  if (focus) pop.querySelector(focus)?.focus();
}

function click(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.geser) {
    cur.month = addMonths(`${cur.month}-01`, Number(b.dataset.geser)).slice(0, 7);
    return draw(`[data-geser="${b.dataset.geser}"]`);
  }
  if (b.dataset.rentang) return set(...b.dataset.rentang.split(' '));
  if (!('d' in b.dataset)) return;
  const d = b.dataset.d;
  if (cur.inputs.length === 1) return set(d);
  if (!cur.start) {
    Object.assign(cur, { start: d, focus: d, month: d.slice(0, 7) });
    return draw(`[data-d="${d}"]`);
  }
  set(...[cur.start, d].sort());
}

/** Panah: pindah hari (atas/bawah = seminggu), ganti bulan bila perlu. */
function keys(e) {
  const d = e.target.closest('.hari [data-d]')?.dataset.d;
  if (!d || !(e.key in STEP)) return;
  e.preventDefault();
  const next = addDays(d, STEP[e.key]);
  Object.assign(cur, { focus: next, month: next.slice(0, 7) });
  draw(`[data-d="${next}"]`);
}

function set(...values) {
  cur.inputs.forEach((input, i) => (input.value = values[i]));
  pop.hidePopover();
  cur.btn.focus();
  cur.inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
}
