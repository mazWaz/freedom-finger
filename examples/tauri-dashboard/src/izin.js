// Tab Izin & koreksi: izin, sakit, cuti, dan dinas luar per karyawan, serta koreksi absen untuk yang
// lupa scan. Keduanya hanya disimpan di aplikasi.json; log mesin dan tabel `logs` server tidak pernah
// diubah, supaya data asli mesin tetap utuh sebagai bukti. Rekap dan Riwayat membacanya dari `data`.
import { ask } from '@tauri-apps/plugin-dialog';
import { $, byPin, data, dmy, esc, knownPins, nameOf, notify, period, saveData, today } from './app.js';
import { LEAVE_KINDS } from './hitung-rekap.js';
import { LABEL } from './rekap.js';

const FORMS = { leaves: 'i-izin', corrections: 'i-koreksi' }; // daftar di `data` -> form; tabelnya `<form>-daftar`
const editing = {}; // daftar -> id catatan yang sedang diubah

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
  $('i-izin').elements.kind.innerHTML = LEAVE_KINDS.map((k) => `<option value="${k}">${LABEL[k]}</option>`).join('');
  for (const [list, id] of Object.entries(FORMS)) {
    const f = $(id);
    f.onsubmit = (e) => {
      e.preventDefault();
      save(list);
    };
    f.elements.batal.onclick = () => reset(list);
    $(`${id}-daftar`).onclick = (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) (b.name === 'ubah' ? edit : remove)(list, b.dataset.id);
    };
  }
}

export function show() {
  // juga PIN yang punya catatan tetapi sudah tidak ada di mesin, supaya catatannya tetap bisa diubah
  const pins = [...new Set([...knownPins(), ...data.leaves.map((l) => l.pin), ...data.corrections.map((c) => c.pin)])].sort(byPin);
  const opts = pins.map((pin) => `<option value="${esc(pin)}">${esc(nameOf(pin))}${nameOf(pin) === `PIN ${pin}` ? '' : ` · PIN ${esc(pin)}`}</option>`).join('');
  for (const id of Object.values(FORMS)) {
    const s = $(id).elements.pin;
    if (s.dataset.opts === opts) continue;
    const keep = s.value;
    s.innerHTML = `<option value="">Pilih karyawan</option>${opts}`;
    s.value = keep;
    s.dataset.opts = opts;
  }
  const buttons = (list, v) => ['ubah', 'hapus']
    .map((b) => `<button name="${b}"${b === 'hapus' ? ' class="bahaya"' : ''} data-id="${esc(v.id)}" aria-label="${b === 'ubah' ? 'Ubah' : 'Hapus'} ${esc(describe[list](v))}">${b === 'ubah' ? 'Ubah' : 'Hapus'}</button>`)
    .join(' ');
  $('i-izin-daftar').innerHTML = [...data.leaves]
    .sort((a, b) => b.from.localeCompare(a.from))
    .map((l) => `<tr><td>${period(l.from, l.to)}</td><td>${esc(nameOf(l.pin))}</td><td>${LABEL[l.kind]}</td><td>${esc(l.note)}</td>` +
      `<td class="num">${buttons('leaves', l)}</td></tr>`)
    .join('') || '<tr><td colspan="5" class="muted">Belum ada catatan.</td></tr>';
  $('i-koreksi-daftar').innerHTML = [...data.corrections]
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
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
  reset(list);
  notify(`Tersimpan: ${describe[list](v)}.`);
}

function edit(list, id) {
  const v = data[list].find((x) => x.id === id);
  const f = $(FORMS[list]).elements;
  for (const el of f) if (el.name in v) el.value = v[el.name];
  editing[list] = id;
  f.batal.hidden = false;
  f.simpan.textContent = 'Simpan perubahan';
  f.pin.focus();
}

async function remove(list, id) {
  const v = data[list].find((x) => x.id === id);
  if (!(await ask(`Hapus ${describe[list](v)}?`, { title: 'Hapus catatan', kind: 'warning', okLabel: 'Hapus', cancelLabel: 'Batal' }))) return;
  data[list] = data[list].filter((x) => x !== v);
  if (editing[list] === id) reset(list);
  saveData();
}

function reset(list) {
  const f = $(FORMS[list]);
  f.reset();
  editing[list] = null;
  f.elements.batal.hidden = true;
  f.elements.simpan.textContent = 'Simpan';
}
