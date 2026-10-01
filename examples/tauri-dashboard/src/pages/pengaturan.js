// Menu Jam kerja, Hari libur, Backup, dan Pengaturan (nama kantor, kata sandi): satu modul untuk
// empat menu, semuanya digambar saat salah satunya dibuka. Tersimpan di aplikasi.json dan langsung
// dipakai rekap.
import { invoke } from '@tauri-apps/api/core';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { port } from '../lib/api.js';
import { SCHEDULE_COLORS, colorOf, data, saveData } from '../lib/data.js';
import { DAY_NAMES, dayName, dmy, monthName, today } from '../lib/format.js';
import { DEFAULT_SCHEDULE, addDays } from '../lib/hitung-rekap.js';
import { $, closeDrawer, esc, notify, openDrawer } from '../lib/ui.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Senin dulu
const NUMBERS = { tolerance: 'p-toleransi', overtimeMin: 'p-lembur', minGap: 'p-jarak' };
/** Peringatan bila backup terakhir lebih lama dari ini (hari). */
const BACKUP_WARN_DAYS = 7;

export function init() {
  // ganti kata sandi di laci; pemeriksaan dan penyimpanannya di kunci.js
  $('p-sandi-buka').onclick = () => {
    $('p-sandi').reset();
    openDrawer('p-sandi', 'Ganti kata sandi');
    $('p-sandi').elements.lama.focus();
  };
  $('p-sandi').elements.batal.onclick = closeDrawer;
  $('p-kantor').onchange = () => {
    data.office = $('p-kantor').value.trim();
    saveData();
  };
  $('p-jadwal').onchange = (e) => {
    const s = schedule(e.target.closest('[data-sched]').dataset.sched);
    if (e.target.name === 'warna') {
      s.color = e.target.value;
      return saveData();
    }
    if (e.target.name === 'sname') {
      s.name = e.target.value.trim() || 'Tanpa nama';
      return saveData();
    }
    const tr = e.target.closest('[data-day]');
    if (e.target.name === 'ot') {
      s.overtime[tr.dataset.day] = e.target.checked;
      return saveData();
    }
    if (e.target.name === 'otmax') {
      const v = e.target.value.trim();
      if (v && !(Number(v) > 0 && Number(v) <= 24)) return notify('Isi lembur maksimal 0,5 sampai 24 jam, atau kosongkan untuk tanpa batas.', true);
      s.overtimeMax[tr.dataset.day] = Math.round(Number(v) * 60); // menit; kosong = 0 = tanpa batas
      return saveData();
    }
    const q = (k) => tr.querySelector(`[name=${k}]`);
    // hari yang baru dijadikan hari kerja memakai jam hari kerja lain
    const base = s.days.find((d) => d?.start) ?? { start: '08:00', end: '17:00' };
    const [start, end] = [q('start').value || base.start, q('end').value || base.end];
    const free = q('free').checked;
    if (q('work').checked && !free && start >= end) return notify(`${DAY_NAMES[tr.dataset.day]}: jam pulang harus setelah jam masuk.`, true);
    s.days[tr.dataset.day] = !q('work').checked ? null : free ? { free: true } : { start, end };
    saveData();
    show();
  };
  $('p-jadwal').onclick = async (e) => {
    const id = e.target.closest('button[data-hapus]')?.dataset.hapus;
    if (!id) return;
    const s = schedule(id);
    const pins = Object.keys(data.employees).filter((pin) => data.employees[pin].schedule === id);
    if (!(await ask(`Hapus jadwal "${s.name}"? ${pins.length} karyawan kembali ke jadwal Utama.`, { title: 'Hapus jadwal', kind: 'warning' }))) return;
    data.schedules = data.schedules.filter((x) => x !== s);
    for (const pin of pins) delete data.employees[pin].schedule;
    saveData();
    show();
  };
  $('p-jadwal-tambah').onclick = () => {
    const name = `Jadwal ${data.schedules.length + 2}`;
    const color = SCHEDULE_COLORS.find((c) => !data.schedules.some((s) => s.color === c)) ?? SCHEDULE_COLORS[data.schedules.length % SCHEDULE_COLORS.length];
    data.schedules.push({ id: `j${Date.now().toString(36)}`, name, color, days: structuredClone(data.schedule.days), overtime: [...data.schedule.overtime], overtimeMax: [...data.schedule.overtimeMax] });
    saveData();
    show();
  };
  for (const [key, id] of Object.entries(NUMBERS)) {
    $(id).onchange = () => {
      const n = $(id).value.trim() === '' ? NaN : Number($(id).value);
      if (!Number.isInteger(n) || n < 0 || n > 600) return notify('Isi menit dengan angka bulat 0–600.', true);
      data.schedule[key] = n;
      saveData();
    };
  }
  $('p-libur-tambah').onclick = () => {
    const date = $('p-libur-tanggal').value;
    if (!date) return notify('Pilih tanggal hari libur.', true);
    data.holidays = [...data.holidays.filter((h) => h.date !== date), { date, note: $('p-libur-ket').value.trim() }];
    data.holidays.sort((a, b) => a.date.localeCompare(b.date));
    $('p-libur-ket').value = '';
    saveData();
    show();
  };
  $('p-libur').onclick = (e) => {
    const date = e.target.closest('button[data-date]')?.dataset.date;
    if (!date) return;
    data.holidays = data.holidays.filter((h) => h.date !== date);
    saveData();
    show();
  };
  $('p-jadwal-awal').onclick = () => {
    data.schedule = { ...structuredClone(DEFAULT_SCHEDULE), color: data.schedule.color }; // warna bukan aturan: tetap
    saveData();
    show();
  };
  $('p-folder-ganti').onclick = async () => {
    const dir = await open({ directory: true, defaultPath: await backupFolder() });
    if (!dir) return;
    data.backup.folder = dir;
    await saveData(null);
    renderBackup();
  };
  $('p-backup').onclick = () => backupNow(true);
  $('p-pulihkan').onclick = restore;
}

/** Digambar ulang hanya saat tab dibuka atau setelah perubahan di tab ini, supaya isian yang sedang
 * diketik tidak hilang. */
export function show(reason = 'open') {
  if (reason !== 'open') return;
  $('p-kantor').value = data.office;
  // warna jadwal: tanda jadwal di Hari ini
  const swatch = (s, label) => `<input type="color" name="warna" value="${colorOf(s)}" aria-label="Warna jadwal ${esc(label)}" title="Warna jadwal di Hari ini">`;
  // satu kartu per jadwal; tiap hari: sakelar kerja, jam masuk–pulang atau jam bebas (hari libur: tulisan Libur),
  // sakelar lembur, dan lembur maksimal (tampil hanya bila lembur hari itu aktif; jam bebas tanpa lembur)
  const rows = (s, label) => '<div class="hari-kerja judul-kolom" aria-hidden="true"><span></span><span>Kerja</span><span>Jam kerja</span>' +
    '<span>Lembur</span><span>Maks. jam</span></div>' + ORDER.map((i) => {
    const d = s.days[i];
    const l = `${label} ${DAY_NAMES[i]}`;
    return `<div class="hari-kerja${d ? '' : ' off'}${d?.free ? ' bebas' : ''}" data-day="${i}"><span class="nama-hari">${DAY_NAMES[i]}</span>` +
      `<input type="checkbox" class="saklar" name="work"${d ? ' checked' : ''} aria-label="${esc(l)} hari kerja">` +
      `<span class="rentang"><span class="jam-isi"><input type="time" name="start" value="${d?.start ?? ''}" aria-label="${esc(l)} jam masuk"> – ` +
      `<input type="time" name="end" value="${d?.end ?? ''}" aria-label="${esc(l)} jam pulang"></span><label class="bebas-pilih" ` +
      `title="Datang dan pulang kapan saja: tidak ada terlambat, pulang cepat, atau lembur"><input type="checkbox" name="free"${d?.free ? ' checked' : ''} aria-label="${esc(l)} jam bebas"> Bebas</label>` +
      '</span><span class="libur-teks">Libur</span>' +
      `<input type="checkbox" class="saklar" name="ot"${s.overtime[i] ? ' checked' : ''} aria-label="${esc(l)} hitung lembur" ` +
      `title="${d ? 'Hitung lembur setelah jam pulang' : 'Kerja di hari libur ini seluruhnya dihitung lembur'}">` +
      `<input type="number" name="otmax" min="0.5" max="24" step="0.5" value="${s.overtimeMax[i] ? s.overtimeMax[i] / 60 : ''}" placeholder="bebas" ` +
      `aria-label="${esc(l)} lembur maksimal, jam" title="Lembur paling lama hari itu; kosong = tanpa batas"></div>`;
  }).join('');
  const others = data.schedules.map((s) => `<div class="panel jadwal-kartu" data-sched="${esc(s.id)}"><header>` +
    `${swatch(s, s.name)}<input class="senyap" name="sname" value="${esc(s.name)}" aria-label="Nama jadwal">` +
    `<button data-hapus="${esc(s.id)}" class="mini bahaya">Hapus</button></header>${rows(s, s.name)}</div>`);
  $('p-jadwal').innerHTML = `<div class="panel jadwal-kartu" data-sched=""><header>${swatch(data.schedule, 'Utama')}<div><h3>Utama</h3>` +
    `${others.length ? '<p>Untuk karyawan tanpa jadwal lain</p>' : ''}</div></header>${rows(data.schedule, 'Utama')}</div>${others.join('')}`;
  for (const [key, id] of Object.entries(NUMBERS)) $(id).value = data.schedule[key];
  const t = today();
  const days = (h) => Math.round((Date.parse(h.date) - Date.parse(t)) / 86_400_000);
  const when = (n) => (n === 0 ? 'hari ini' : n > 0 ? `${n} hari lagi` : `${-n} hari lalu`);
  const item = (h) => `<li><span class="tgl"><b>${Number(h.date.slice(8))}</b><span>${monthName(h.date.slice(0, 7)).slice(0, 3)}</span></span>` +
    `<span class="dua">${esc(h.note || 'Libur')}<small>${dayName(h.date)}, ${dmy(h.date)}, ${when(days(h))}</small></span>` +
    `<button data-date="${h.date}" class="mini bahaya" aria-label="Hapus libur ${dmy(h.date)}">Hapus</button></li>`;
  const next = data.holidays.filter((h) => h.date >= t);
  const past = data.holidays.filter((h) => h.date < t).reverse();
  $('p-libur').innerHTML = (next.length ? `<ul class="libur-list">${next.map(item).join('')}</ul>`
    : '<p class="muted">Belum ada hari libur yang akan datang. Tambahkan tanggal di atas.</p>') +
    (past.length ? `<details class="lipat"><summary>Sudah lewat (${past.length})</summary><ul class="libur-list lewat">${past.map(item).join('')}</ul></details>` : '');
  $('p-port').textContent = port;
  invoke('lan_ip').then((ip) => ($('p-ip').textContent = ip ?? 'IP komputer ini (lihat pengaturan jaringan)'));
  renderBackup();
}

// --- backup -----------------------------------------------------------------------------------

/** Jadwal utama (`''`) atau jadwal lain; keduanya punya `days`. */
const schedule = (id) => (id ? data.schedules.find((s) => s.id === id) : data.schedule);

const backupFolder = async () => data.backup.folder || invoke('default_backup_dir');

async function renderBackup() {
  $('p-folder').textContent = await backupFolder();
  const last = data.backup.last;
  const old = !last || last.slice(0, 10) < addDays(today(), -BACKUP_WARN_DAYS);
  $('p-backup-status').className = `status-backup${old ? ' off' : ''}`;
  $('p-backup-info').textContent = !last ? 'Belum pernah backup'
    : `Backup terakhir ${last.slice(0, 10) === today() ? 'hari ini' : dmy(last.slice(0, 10))}, pukul ${last.slice(11)}`;
  $('p-backup-sub').textContent = old
    ? `${last ? `Sudah lebih dari ${BACKUP_WARN_DAYS} hari. ` : ''}Periksa folder di bawah, lalu tekan Backup sekarang.`
    : 'Backup berikutnya dibuat otomatis besok saat aplikasi pertama kali hidup.';
}

/** Backup otomatis: sekali sehari saat aplikasi pertama kali hidup hari itu (PC tidak menyala 24 jam). */
export async function autoBackup() {
  if (data.backup.last.slice(0, 10) !== today()) await backupNow(false);
}

async function backupNow(manual) {
  try {
    const file = await invoke('backup', { folder: await backupFolder(), date: today() });
    data.backup.last = `${today()} ${new Date().toTimeString().slice(0, 5)}`;
    await saveData(null);
    if (manual) notify(`Backup tersimpan: ${file}`);
  } catch (e) {
    notify(`Backup gagal: ${e}. Periksa folder backup di menu Backup.`, true);
  }
  renderBackup();
}

async function restore() {
  const file = await open({ defaultPath: await backupFolder(), filters: [{ name: 'Backup Freedom Finger', extensions: ['db'] }] });
  if (!file) return;
  const yes = await ask(
    `Ganti semua data dengan backup ini?\n\n${file}\n\nData sekarang disimpan sebagai absensi-sebelum-pulih.db di folder data aplikasi (bisa dipulihkan lagi). ` +
      'Aplikasi akan mulai ulang. Absen yang masuk sesudah backup dibuat ditarik ulang dari mesin saat aplikasi hidup lagi.',
    { title: 'Pulihkan dari backup', kind: 'warning', okLabel: 'Pulihkan', cancelLabel: 'Batal' },
  );
  if (yes) await invoke('restore', { file }).catch((e) => notify(`Gagal memulihkan: ${e}`, true));
}
