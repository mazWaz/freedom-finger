// Menu Jam kerja, Hari libur, Backup, dan Pengaturan (nama kantor, kata sandi): satu modul untuk
// empat menu, semuanya digambar saat salah satunya dibuka. Tersimpan di aplikasi.json dan langsung
// dipakai rekap.
import { invoke } from '@tauri-apps/api/core';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { $, DAY_NAMES, closeDrawer, data, dayName, dmy, esc, monthName, notify, openDrawer, port, saveData, today } from './app.js';
import { DEFAULT_SCHEDULE, addDays } from './hitung-rekap.js';

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
    if (e.target.name === 'sname') {
      s.name = e.target.value.trim() || 'Tanpa nama';
      return saveData();
    }
    const tr = e.target.closest('[data-day]');
    const q = (k) => tr.querySelector(`[name=${k}]`);
    // hari yang baru dijadikan hari kerja memakai jam hari kerja lain
    const base = s.days.find(Boolean) ?? { start: '08:00', end: '17:00' };
    const [start, end] = [q('start').value || base.start, q('end').value || base.end];
    if (q('work').checked && start >= end) return notify(`${DAY_NAMES[tr.dataset.day]}: jam pulang harus setelah jam masuk.`, true);
    s.days[tr.dataset.day] = q('work').checked ? { start, end } : null;
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
  $('p-lembur-aktif').onchange = () => {
    data.schedule.overtimeOn = $('p-lembur-aktif').checked;
    saveData();
    show();
  };
  $('p-jadwal-tambah').onclick = () => {
    const name = `Jadwal ${data.schedules.length + 2}`;
    data.schedules.push({ id: `j${Date.now().toString(36)}`, name, days: structuredClone(data.schedule.days) });
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
    data.schedule = structuredClone(DEFAULT_SCHEDULE);
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
  // satu kartu per jadwal; tiap hari: sakelar kerja, lalu jam masuk–pulang (hari libur: tulisan Libur)
  const rows = (days, label) => ORDER.map((i) => {
    const d = days[i];
    const l = `${label} ${DAY_NAMES[i]}`;
    return `<div class="hari-kerja${d ? '' : ' off'}" data-day="${i}"><span class="nama-hari">${DAY_NAMES[i]}</span>` +
      `<input type="checkbox" class="saklar" name="work"${d ? ' checked' : ''} aria-label="${esc(l)} hari kerja">` +
      `<span class="rentang"><input type="time" name="start" value="${d?.start ?? ''}" aria-label="${esc(l)} jam masuk"> – ` +
      `<input type="time" name="end" value="${d?.end ?? ''}" aria-label="${esc(l)} jam pulang"></span><span class="libur-teks">Libur</span></div>`;
  }).join('');
  const others = data.schedules.map((s) => `<div class="panel jadwal-kartu" data-sched="${esc(s.id)}"><header>` +
    `<input class="senyap" name="sname" value="${esc(s.name)}" aria-label="Nama jadwal">` +
    `<button data-hapus="${esc(s.id)}" class="mini bahaya">Hapus</button></header>${rows(s.days, s.name)}</div>`);
  $('p-jadwal').innerHTML = `<div class="panel jadwal-kartu" data-sched=""><header><div><h3>Utama</h3>` +
    `${others.length ? '<p>Untuk karyawan tanpa jadwal lain</p>' : ''}</div></header>${rows(data.schedule.days, 'Utama')}</div>${others.join('')}`;
  for (const [key, id] of Object.entries(NUMBERS)) $(id).value = data.schedule[key];
  $('p-lembur-aktif').checked = data.schedule.overtimeOn !== false;
  $('p-lembur').disabled = data.schedule.overtimeOn === false;
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
