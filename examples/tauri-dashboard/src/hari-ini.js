// Tab Hari ini: siapa yang sudah absen dan siapa yang terlambat (ringkasan dan pita jam masuk), absen
// hari ini (realtime), status mesin, isian menu mesin, dan peringatan bila IP PC ini berubah.
import { invoke } from '@tauri-apps/api/core';
import { $, data, dayName, devices, esc, hhmm, inRecap, knownPins, logs, monthName, nameOf, port, scheduleOf, today } from './app.js';
import { minutes, weekday } from './hitung-rekap.js';
import { LABEL } from './rekap.js';

export const STATUS = ['Masuk', 'Pulang'];
export const VERIFY = { 1: 'Jari', 2: 'Password', 3: 'Kartu', 4: 'Wajah' };

/** localStorage yang tidak pernah melempar error (mode privat, penyimpanan penuh). */
function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
}

let shown = new Set();

export async function show() {
  const on = devices.filter((d) => d.connected).length;
  const ip = (await invoke('lan_ip')) ?? 'IP komputer ini';
  $('isian').textContent = `Isian di mesin (Menu → Jaringan): Mode Internet, Server IP ${ip}, Server Port ${port}, Server Req Ya.`;
  $('status-mesin').className = on ? 'ok' : 'off';
  $('status-mesin').hidden = devices.length > 0 && on === devices.length; // semua terhubung: cukup di sidebar
  $('status-mesin').textContent = devices.length
    ? `${on} dari ${devices.length} mesin terhubung.`
    : 'Belum ada mesin terhubung. Isi menu mesin seperti di bawah; mesin muncul di sini dalam ±2 menit.';
  // Mesin mengirim ke Server IP yang tetap: bila IP komputer ini berganti, mesin kehilangan tujuan
  const lastOk = storage('ip');
  if (on) storage('ip', ip);
  $('peringatan').hidden = !(devices.length && !on && lastOk && lastOk !== ip);
  $('peringatan').textContent = `IP komputer ini berubah dari ${lastOk} menjadi ${ip}. Ubah Server IP di mesin ke ${ip}, ` +
    'lalu minta admin jaringan mereservasi IP komputer ini di router supaya tidak berubah lagi.';
  const day = today();
  $('tanggal').textContent = `${dayName(day)}, ${Number(day.slice(8))} ${monthName(day.slice(0, 7))}`;
  const list = await logs(day, day);
  list.sort((a, b) => b.scan_date.localeCompare(a.scan_date));
  summary(list, day);
  const key = (l) => `${l.cloud_id} ${l.pin} ${l.scan_date}`;
  $('jumlah').textContent = list.length ? `(${list.length})` : '';
  $('daftar').innerHTML = list
    .map((l) => `<tr${shown.size && !shown.has(key(l)) ? ' class="baru"' : ''}><td>${l.scan_date.slice(11, 16)}</td>` +
      `<td>${esc(nameOf(l.pin))}</td><td>${esc(l.pin)}</td>` +
      `<td>${STATUS[l.status_scan] ?? esc(l.status_scan)}</td><td>${VERIFY[l.verify] ?? esc(l.verify)}</td></tr>`)
    .join('') || '<tr><td colspan="5" class="muted">Belum ada scan hari ini.</td></tr>';
  shown = new Set(list.map(key));
}

/** Ringkasan kehadiran, pita jam masuk, dan nama yang terlambat, izin, atau belum absen. */
function summary(list, day) {
  const holiday = data.holidays.find((h) => h.date === day);
  const shift = (pin) => (holiday ? null : (scheduleOf(pin) ?? data.schedule).days[weekday(day)]);
  const scans = new Map(); // pin -> menit scan, urut
  for (const l of [...list].reverse()) scans.set(l.pin, [...(scans.get(l.pin) ?? []), minutes(l.scan_date, 11)]);
  const expected = knownPins().filter((pin) => inRecap(pin) && shift(pin));
  const leave = new Map(data.leaves.filter((l) => l.from <= day && day <= l.to).map((l) => [l.pin, l.kind]));
  const late = (pin) => shift(pin) && scans.get(pin)[0] > minutes(shift(pin).start) + data.schedule.tolerance;
  const present = expected.filter((pin) => scans.has(pin));
  const lateList = present.filter(late);
  const onLeave = expected.filter((pin) => leave.has(pin) && !scans.has(pin));
  const notYet = expected.filter((pin) => !scans.has(pin) && !leave.has(pin));

  $('ringkasan').innerHTML = !expected.length
    ? (holiday ? `Hari ini libur${holiday.note ? `: ${esc(holiday.note)}` : ''}.` : 'Hari ini bukan hari kerja.') +
      (scans.size ? ` ${scans.size} orang tetap absen.` : '')
    : `<b>${present.length}</b> dari ${expected.length} karyawan sudah absen` +
      (lateList.length ? `, <span class="merah">${lateList.length} terlambat</span>` : '') + '.';
  const names = (label, pins, extra = () => '') => (pins.length
    ? `<p class="daftar-nama"><span>${label}:</span> ${pins.map((pin) => `${esc(nameOf(pin))}${extra(pin)}`).join(', ')}</p>` : '');
  $('nama-hari-ini').innerHTML =
    names('Terlambat', lateList, (pin) => ` (${hhmm(scans.get(pin)[0])})`) +
    names('Izin', onLeave, (pin) => ` (${LABEL[leave.get(pin)].toLowerCase()})`) +
    names('Belum absen', notYet);
  ribbon(scans, day, late);
}

/**
 * Pita jam masuk: satu titik per scan di garis waktu hari ini. Scan pertama tiap orang = titik penuh
 * (merah bila terlambat), scan berikutnya = titik kosong. Garis jam masuk/pulang dari jadwal utama.
 */
function ribbon(scans, day, late) {
  const pita = $('pita');
  pita.hidden = $('pita-legenda').hidden = !scans.size;
  if (!scans.size) return;
  const main = data.holidays.some((h) => h.date === day) ? null : data.schedule.days[weekday(day)];
  const all = [...scans.values()].flat();
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  const from = Math.floor(Math.min(6 * 60, ...all, main ? minutes(main.start) - 60 : Infinity) / 60) * 60;
  const to = Math.ceil(Math.max(20 * 60, ...all, now, main ? minutes(main.end) + 60 : 0) / 60) * 60;
  const x = (m) => `${(((m - from) / (to - from)) * 100).toFixed(2)}%`;
  // titik yang berdekatan ditumpuk ke atas supaya tidak saling menutupi
  const dots = [...scans].flatMap(([pin, ms]) => ms.map((m, i) => ({ pin, m, first: i === 0 }))).sort((a, b) => a.m - b.m);
  const lastInRow = [];
  const gap = (to - from) * 0.012;
  for (const d of dots) {
    d.row = lastInRow.findIndex((m) => d.m - m >= gap);
    if (d.row < 0) d.row = lastInRow.length;
    lastInRow[d.row] = d.m;
  }
  pita.style.height = `${lastInRow.length * 13 + 8}px`;
  const hours = [];
  for (let h = from; h <= to; h += 120) hours.push(h);
  pita.innerHTML =
    (main ? `<div class="toleransi" style="left: ${x(minutes(main.start))}; width: ${x(from + data.schedule.tolerance)}"></div>` +
      `<div class="garis" style="left: ${x(minutes(main.start))}"><span>Masuk ${main.start}</span></div>` +
      `<div class="garis" style="left: ${x(minutes(main.end))}"><span>Pulang ${main.end}</span></div>` : '') +
    (now >= from && now <= to ? `<div class="sekarang" style="left: ${x(now)}" title="Sekarang ${hhmm(now)}"></div>` : '') +
    dots.map((d) => `<div class="titik${d.first ? (late(d.pin) ? ' telat' : '') : ' lagi'}" style="left: ${x(d.m)}; bottom: ${d.row * 13 + 4}px" ` +
      `title="${esc(nameOf(d.pin))} ${hhmm(d.m)}${d.first && late(d.pin) ? ', terlambat' : ''}"></div>`).join('') +
    hours.map((h) => `<span class="jam" style="left: ${x(h)}">${hhmm(h)}</span>`).join('');
}
