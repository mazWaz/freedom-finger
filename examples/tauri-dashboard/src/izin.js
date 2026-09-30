// Tab Izin & koreksi: izin, sakit, cuti, dan dinas luar per karyawan, serta koreksi absen untuk yang
// lupa scan. Keduanya hanya disimpan di aplikasi.json; log mesin dan tabel `logs` server tidak pernah
// diubah, supaya data asli mesin tetap utuh sebagai bukti. Rekap dan Riwayat membacanya dari `data`.
// Form-nya ada di laci (panel samping) dan bisa dibuka dari tab lain lewat `openForm`, sudah terisi
// nama dan tanggal (mis. dari kartu karyawan di Hari ini).
import { ask } from '@tauri-apps/plugin-dialog';
import { $, byPin, closeDrawer, data, dmy, esc, knownPins, nameOf, notify, openDrawer, paginate, period, saveData, today } from './app.js';
import { LEAVE_KINDS } from './hitung-rekap.js';
import { LABEL } from './rekap.js';

const FORMS = { leaves: 'i-izin', corrections: 'i-koreksi' }; // daftar di `data` -> form; tabelnya `<form>-daftar`
const editing = {}; // daftar -> id catatan yang sedang diubah
const PER_PAGE = 10;
const page = { leaves: 1, corrections: 1 }; // halaman tabel yang terbuka, terbaru dulu
const TITLE = { leaves: ['Catat izin', 'Ubah catatan izin'], corrections: ['Koreksi absen', 'Ubah koreksi absen'] };

/** Isian form -> catatan, atau pesan kesalahan. */
const READ = {
  leaves(f, id) {
    const v = { id, pin: f.pin.value, kind: f.kind.value, from: f.from.value, to: f.to.value || f.from.value, note: f.note.value.trim() };
    if (v.to < v.from) return 'Tanggal sampai tidak boleh sebelum tanggal mulai.';
    // recap() memakai catatan pertama yang cocok: jangan ada dua catatan di hari yang sama
    const clash = data.leaves.find((l) => l.id !== id && l.pin === v.pin && l.from <= v.to && v.from <= l.to);
    if (clash) return `${nameOf(v.pin)} sudah punya catatan ${LABEL[clash.kind]} ${period(clash.from, clash.to)}. Ubah catatan itu saja.`;
    return v;
  },
  corrections(f, id) {
    const v = { id, pin: f.pin.value, date: f.date.value, time: f.time.value.slice(0, 5), reason: f.reason.value.trim() };
    if (!v.reason) return 'Alasan koreksi wajib diisi.';
    if (v.date > today()) return 'Koreksi hanya untuk hari ini atau tanggal yang sudah lewat.';
    if (data.corrections.some((c) => c.id !== id && c.pin === v.pin && c.date === v.date && c.time === v.time)) return 'Koreksi yang sama sudah ada.';
    return v;
  },
};

const describe = {
  leaves: (l) => `${LABEL[l.kind]} ${nameOf(l.pin)} ${period(l.from, l.to)}`,
  corrections: (c) => `koreksi ${nameOf(c.pin)} ${dmy(c.date)} ${c.time}`,
};

export function init() {
  $('i-jenis').innerHTML = LEAVE_KINDS.map((k, i) => `<label><input type="radio" name="kind" value="${k}"${i ? '' : ' checked'} /> ${LABEL[k]}</label>`).join('');
  $('i-baru-izin').onclick = () => openForm('leaves');
  $('i-baru-koreksi').onclick = () => openForm('corrections');
  for (const [list, id] of Object.entries(FORMS)) {
    const f = $(id);
    f.onsubmit = (e) => {
      e.preventDefault();
      save(list);
    };
    f.elements.batal.onclick = closeDrawer;
    $(`${id}-daftar`).onclick = (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) (b.name === 'ubah' ? openForm(list, {}, b.dataset.id) : remove(list, b.dataset.id));
    };
  }
}

/** Pilihan karyawan, juga PIN yang punya catatan tetapi sudah tidak ada di mesin (supaya tetap bisa diubah). */
function fillPins(select) {
  const pins = [...new Set([...knownPins(), ...data.leaves.map((l) => l.pin), ...data.corrections.map((c) => c.pin)])].sort(byPin);
  const opts = pins.map((pin) => `<option value="${esc(pin)}">${esc(nameOf(pin))}${nameOf(pin) === `PIN ${pin}` ? '' : ` · PIN ${esc(pin)}`}</option>`).join('');
  if (select.dataset.opts !== opts) {
    select.innerHTML = `<option value="">Pilih karyawan</option>${opts}`;
    select.dataset.opts = opts;
  }
}

/**
 * Buka form di laci. `preset` mengisi kolom (mis. `{pin, from}` dari kartu Hari ini); `id` = ubah
 * catatan yang sudah ada.
 */
export function openForm(list, preset = {}, id = null) {
  const f = $(FORMS[list]);
  fillPins(f.elements.pin);
  f.reset();
  editing[list] = id;
  const v = id ? data[list].find((x) => x.id === id) : preset;
  for (const [k, val] of Object.entries(v ?? {})) if (k !== 'id' && f.elements[k]) f.elements[k].value = val; // radio: RadioNodeList.value memilih
  f.elements.simpan.textContent = id ? 'Simpan perubahan' : 'Simpan';
  openDrawer(FORMS[list], TITLE[list][id ? 1 : 0], v?.pin ? nameOf(v.pin) : '');
  // kolom pertama yang belum terisi; izin yang nama dan tanggalnya sudah ada: pilih jenisnya
  const e = f.elements;
  const next = (list === 'leaves' ? [e.pin, e.from] : [e.pin, e.date, e.time, e.reason]).find((el) => !el.value);
  (next ?? f.querySelector('input[name="kind"]:checked') ?? e.simpan).focus();
}

export function show() {
  const buttons = (list, v) => ['ubah', 'hapus']
    .map((b) => `<button name="${b}"${b === 'hapus' ? ' class="bahaya"' : ''} data-id="${esc(v.id)}" aria-label="${b === 'ubah' ? 'Ubah' : 'Hapus'} ${esc(describe[list](v))}">${b === 'ubah' ? 'Ubah' : 'Hapus'}</button>`)
    .join(' ');
  const [leaves, nl] = paginate($('i-izin-hal'), [...data.leaves].sort((a, b) => b.from.localeCompare(a.from)), page.leaves, PER_PAGE, (n) => {
    page.leaves = n;
    show();
  });
  page.leaves = nl;
  $('i-izin-daftar').innerHTML = leaves
    .map((l) => `<tr><td>${period(l.from, l.to)}</td><td>${esc(nameOf(l.pin))}</td><td>${LABEL[l.kind]}</td><td>${esc(l.note)}</td>` +
      `<td class="num">${buttons('leaves', l)}</td></tr>`)
    .join('') || '<tr><td colspan="5" class="muted">Belum ada catatan. Tekan Catat izin, atau buka kartu karyawan di Hari ini.</td></tr>';
  const byTime = (a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`);
  const [corrections, nc] = paginate($('i-koreksi-hal'), [...data.corrections].sort(byTime), page.corrections, PER_PAGE, (n) => {
    page.corrections = n;
    show();
  });
  page.corrections = nc;
  $('i-koreksi-daftar').innerHTML = corrections
    .map((c) => `<tr><td>${dmy(c.date)}</td><td>${c.time}</td><td>${esc(nameOf(c.pin))}</td><td>${esc(c.reason)}</td>` +
      `<td class="num">${buttons('corrections', c)}</td></tr>`)
    .join('') || '<tr><td colspan="5" class="muted">Belum ada koreksi.</td></tr>';
}

async function save(list) {
  const v = READ[list]($(FORMS[list]).elements, editing[list] ?? Date.now().toString(36));
  if (typeof v === 'string') return notify(v, true);
  const was = data[list];
  data[list] = [...was.filter((x) => x.id !== v.id), v];
  try {
    await saveData();
  } catch {
    data[list] = was; // saveData sudah menampilkan pesan gagal; isian form tetap ada
    return;
  }
  editing[list] = null;
  closeDrawer();
  notify(`Tersimpan: ${describe[list](v)}.`);
}

async function remove(list, id) {
  const v = data[list].find((x) => x.id === id);
  if (!(await ask(`Hapus ${describe[list](v)}?`, { title: 'Hapus catatan', kind: 'warning', okLabel: 'Hapus', cancelLabel: 'Batal' }))) return;
  data[list] = data[list].filter((x) => x !== v);
  saveData();
}
