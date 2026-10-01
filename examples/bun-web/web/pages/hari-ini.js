// Tab Hari ini: sebaran jam scan (paling atas; arahkan kursor ke titik untuk nama), papan absen (satu
// kartu per karyawan: tepat waktu, terlambat, izin, belum datang) dengan saring, cari, dan halaman,
// rincian satu karyawan di laci dengan tombol izin/koreksi, semua scan hari ini (realtime, terlipat,
// dengan cari dan halaman), status mesin, isian menu mesin, dan peringatan bila IP server berubah.
// Koreksi absen hari ini ikut dihitung seperti scan, sama dengan Rekap.
import { FingerprintPattern, createElement } from 'lucide';
import { backups, devices, logs, port, serverIp } from '../lib/api.js';
import { colorOf, data, deptOf, inRecap, knownPins, nameOf, scheduleName, scheduleOf, scheduleTag } from '../lib/data.js';
import { dayName, hhmm, monthName, period, today } from '../lib/format.js';
import { correctionScans, minutes, scanRoles, userPhoto, weekday } from '../lib/hitung-rekap.js';
import { $, esc, openDrawer, paginate } from '../lib/ui.js';
import { openForm } from './izin.js';
import { LABEL } from './rekap.js';

export const VERIFY = { 1: 'Jari', 2: 'Password', 3: 'Kartu', 4: 'Wajah' };
const KIND = { belum: 'Belum datang', telat: 'Terlambat', izin: 'Izin', tepat: 'Tepat waktu', luar: 'Di luar jadwal' };

/** localStorage yang tidak pernah melempar error (mode privat, penyimpanan penuh). */
function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
}

let shown = new Set(); // scan yang sudah tampil: yang baru disorot sebentar
let people = []; // karyawan di papan: {pin, kind, shift, scans, leave}
let filter = 'semua';
let rows = []; // semua scan hari ini, terbaru dulu
let freshRows = new Set(); // scan yang baru masuk sejak tampilan sebelumnya
const page = { cards: 1, rows: 1 };
const PER_PAGE = { cards: 24, rows: 20 };
const scanKey = (l) => `${l.cloud_id} ${l.pin} ${l.scan_date}`;
/** Cocok dengan kotak cari (nama atau PIN); `q` sudah huruf kecil. */
const matches = (pin, q) => !q || pin.includes(q) || nameOf(pin).toLowerCase().includes(q);

export function init() {
  $('saring').onclick = (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    filter = b.dataset.k;
    page.cards = 1;
    render(new Set());
  };
  $('papan-cari').oninput = () => {
    page.cards = 1;
    render(new Set());
  };
  $('daftar-cari').oninput = () => {
    page.rows = 1;
    table();
  };
  // titik sebaran: sorot semua scan orang yang sama (masuk dan pulangnya), sisanya meredup
  $('pita').onmouseover = (e) => {
    const pin = e.target.closest('.titik')?.dataset.pin;
    $('pita').classList.toggle('sorot', !!pin);
    for (const d of $('pita').querySelectorAll('.titik')) d.classList.toggle('ini', d.dataset.pin === pin);
  };
  $('pita').onmouseleave = () => $('pita').classList.remove('sorot');
  $('papan').onclick = (e) => {
    const b = e.target.closest('button[data-pin]');
    if (b) person(b.dataset.pin);
  };
}

export async function show() {
  const on = devices.filter((d) => d.connected).length;
  const ip = serverIp ?? 'IP server Freedom Finger';
  // isian menu mesin hanya perlu selama ada mesin yang belum/tidak terhubung
  $('isian').hidden = devices.length > 0 && on === devices.length;
  $('isian').textContent = `Isian di mesin (Menu → Jaringan): Mode Internet, Server IP ${ip}, Server Port ${port}, Server Req Ya.`;
  $('status-mesin').hidden = devices.length > 0 && on === devices.length; // semua terhubung: cukup di sidebar
  $('status-mesin').textContent = devices.length
    ? `${on} dari ${devices.length} mesin terhubung. Absen dari mesin yang terputus masuk setelah tersambung lagi.`
    : 'Belum ada mesin terhubung. Isi menu mesin seperti di bawah; mesin muncul di sini dalam ±2 menit.';
  // Mesin mengirim ke Server IP yang tetap: bila IP server berganti, mesin kehilangan tujuan
  const lastOk = storage('ip');
  if (on) storage('ip', ip);
  $('peringatan').hidden = !(devices.length && !on && lastOk && lastOk !== ip);
  $('peringatan').textContent = `IP server Freedom Finger berubah dari ${lastOk} menjadi ${ip}. Ubah Server IP di mesin ke ${ip}, ` +
    'lalu minta admin jaringan mereservasi IP server itu di router supaya tidak berubah lagi.';
  const day = today();
  $('tanggal').textContent = `${dayName(day)}, ${Number(day.slice(8))} ${monthName(day.slice(0, 7))}`;
  const list = [...(await logs(day, day)), ...correctionScans(data.corrections, day, day)];
  list.sort((a, b) => b.scan_date.localeCompare(a.scan_date));
  const freshList = shown.size ? list.filter((l) => !shown.has(scanKey(l))) : [];
  build(list, day);
  render(new Set(freshList.map((l) => l.pin)));
  rows = list;
  freshRows = new Set(freshList.map(scanKey));
  table();
  shown = new Set(list.map(scanKey));
}

/** Tabel semua scan hari ini: cari dan halaman. */
function table() {
  const q = $('daftar-cari').value.trim().toLowerCase();
  const found = rows.filter((l) => matches(l.pin, q));
  const roles = scanRoles(rows, data.schedule.minGap); // bukan tombol mesin: sebelum 09:00 mesin selalu mencatat "Pulang"
  $('jumlah').textContent = rows.length ? `(${rows.length})` : '';
  const [list, n] = paginate($('daftar-hal'), found, page.rows, PER_PAGE.rows, (n) => {
    page.rows = n;
    table();
  });
  page.rows = n;
  $('daftar').innerHTML = list
    .map((l) => `<tr${freshRows.has(scanKey(l)) ? ' class="baru"' : ''}><td>${l.scan_date.slice(11, 16)}</td>` +
      `<td>${esc(nameOf(l.pin))}</td><td>${esc(l.pin)}</td>` +
      `<td>${roles.get(`${l.pin} ${l.scan_date}`) ?? '<span class="redup">–</span>'}</td><td>${l.manual ? 'Manual' : (VERIFY[l.verify] ?? esc(l.verify))}</td></tr>`)
    .join('') || `<tr><td colspan="5" class="muted">${rows.length ? 'Tidak ada scan yang cocok dengan pencarian.' : 'Belum ada scan hari ini.'}</td></tr>`;
}

/** Status tiap karyawan hari ini. Terlambat = scan pertama lewat jam masuk + toleransi (sama dengan Rekap). */
function build(list, day) {
  const holiday = data.holidays.find((h) => h.date === day);
  const shift = (pin) => (holiday ? null : (scheduleOf(pin) ?? data.schedule).days[weekday(day)]);
  const scans = new Map(); // pin -> scan urut jam, {m, manual, verify, reason}
  for (const l of [...list].reverse()) {
    scans.set(l.pin, [...(scans.get(l.pin) ?? []), { m: minutes(l.scan_date, 11), manual: !!l.manual, verify: l.verify, reason: l.reason }]);
  }
  const leave = new Map(data.leaves.filter((l) => l.from <= day && day <= l.to).map((l) => [l.pin, l]));
  people = knownPins().filter(inRecap).map((pin) => {
    const s = shift(pin);
    const sc = scans.get(pin) ?? [];
    let kind;
    if (sc.length) kind = !s ? 'luar' : !s.free && sc[0].m > minutes(s.start) + data.schedule.tolerance ? 'telat' : 'tepat';
    else if (s) kind = leave.has(pin) ? 'izin' : 'belum';
    else return null; // tidak dijadwalkan dan tidak scan
    return { pin, kind, shift: s, scans: sc, leave: leave.get(pin) };
  }).filter(Boolean);
  const expected = people.filter((p) => p.shift).length;
  const came = people.filter((p) => p.shift && p.scans.length).length;
  $('ringkasan').hidden = false;
  $('ringkasan').innerHTML = expected
    ? `<b>${came}</b> dari ${expected} karyawan sudah datang.`
    : `${holiday ? `Hari ini libur${holiday.note ? `: ${esc(holiday.note)}` : ''}.` : 'Hari ini bukan hari kerja.'}` +
      (people.length ? ` ${people.length} orang tetap absen.` : '');
  const late = (pin) => people.find((p) => p.pin === pin)?.kind === 'telat';
  const dots = new Map(people.filter((p) => p.scans.length).map((p) => [p.pin, p.scans.map((x) => x.m)]));
  ribbon(dots, day, late);
}

const ORDER = ['belum', 'telat', 'izin', 'tepat', 'luar'];
const byName = (a, b) => nameOf(a.pin).localeCompare(nameOf(b.pin), 'id');

/** Saring dan papan. `fresh` = PIN yang baru scan: kartunya disorot sebentar. */
function render(fresh) {
  const count = (k) => people.filter((p) => p.kind === k).length;
  if (filter !== 'semua' && !count(filter)) filter = 'semua';
  $('saring').hidden = $('papan-cari').hidden = !people.length;
  $('saring').innerHTML = `<button data-k="semua" aria-pressed="${filter === 'semua'}">Semua <b>${people.length}</b></button>` +
    ORDER.filter(count).map((k) => `<button class="${k}" data-k="${k}" aria-pressed="${filter === k}"><i></i>${KIND[k]} <b>${count(k)}</b></button>`).join('');
  const q = $('papan-cari').value.trim().toLowerCase();
  const found = people.filter((p) => (filter === 'semua' || p.kind === filter) && matches(p.pin, q))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || byName(a, b));
  const [list, n] = paginate($('papan-hal'), found, page.cards, PER_PAGE.cards, (n) => {
    page.cards = n;
    render(new Set());
  });
  page.cards = n;
  $('papan').innerHTML = list.map((p) => card(p, fresh.has(p.pin))).join('') ||
    (q && people.length ? `<p class="kosong">Tidak ada karyawan yang cocok dengan "${esc($('papan-cari').value.trim())}".</p>`
      : knownPins().length ? '' : '<p class="kosong">Belum ada data karyawan. Ambil dari mesin di tab Karyawan.</p>');
}

/** Jam pulang: scan terakhir, bila cukup jauh dari scan pertama (lebih dekat = scan ganda). */
const out = (p) => (p.scans.length > 1 && p.scans.at(-1).m - p.scans[0].m >= data.schedule.minGap ? p.scans.at(-1) : null);
const lateBy = (p) => p.scans[0].m - minutes(p.shift.start);

function card(p, fresh) {
  const first = p.scans[0];
  const [jam, status] = {
    telat: () => [hhmm(first.m), `terlambat ${lateBy(p)} mnt`],
    tepat: () => [hhmm(first.m), p.shift.free ? 'jam bebas' : 'tepat waktu'],
    luar: () => [hhmm(first.m), 'di luar jadwal'],
    izin: () => [LABEL[p.leave.kind], ''],
    belum: () => ['belum datang', ''],
  }[p.kind]();
  const ket = [
    out(p) && `pulang ${hhmm(out(p).m)}`,
    first?.manual && 'koreksi manual',
    p.kind === 'izin' && p.leave.note,
    p.kind === 'belum' && (p.shift.free ? 'jam bebas' : `jadwal masuk ${p.shift.start}`),
  ].filter(Boolean).join(', ');
  return `<button class="kartu ${p.kind}${fresh ? ' baru' : ''}" data-pin="${esc(p.pin)}" ` +
    `aria-label="${esc(nameOf(p.pin))}: ${esc([jam, status, ket, data.schedules.length && `jadwal ${scheduleName(p.pin)}`].filter(Boolean).join(', '))}. ` +
    'Buka rincian">' +
    `<span class="nama-baris"><span class="nama">${esc(nameOf(p.pin))}</span>${scheduleTag(p.pin)}</span>` +
    `<span class="jam">${esc(jam)}${status ? `<span class="status">${status}</span>` : ''}</span>` +
    (ket ? `<span class="ket">${esc(ket)}</span>` : '') + '</button>';
}

/** Rincian satu karyawan di laci: status, scan hari ini, dan tombol izin/koreksi yang sudah terisi. */
function person(pin) {
  const p = people.find((x) => x.pin === pin);
  if (!p) return;
  const day = today();
  const status = {
    telat: () => `Terlambat ${lateBy(p)} menit`,
    tepat: () => (p.shift.free ? 'Sudah datang' : 'Datang tepat waktu'),
    luar: () => 'Absen di luar jadwal kerjanya',
    izin: () => `${LABEL[p.leave.kind]} ${period(p.leave.from, p.leave.to)}${p.leave.note ? `: ${p.leave.note}` : ''}`,
    belum: () => 'Belum datang',
  }[p.kind]();
  const via = (s) => (s.manual ? `koreksi manual${s.reason ? `: ${s.reason}` : ''}` : (VERIFY[s.verify] ?? 'scan mesin'));
  $('laci-orang').innerHTML =
    `<div class="orang-kepala"><div class="foto-orang" data-pin="${esc(pin)}" title="Belum ada foto dari mesin">${NO_PHOTO}</div>` +
    `<div><p class="kartu-status ${p.kind}"><b>${esc(status)}</b></p>` +
    `<p class="muted">${scheduleTag(pin)} ${!p.shift ? 'Tidak ada jadwal kerja hari ini' : p.shift.free ? 'Hari ini jam bebas' : `Jadwal hari ini ${p.shift.start}–${p.shift.end}`}</p></div></div>` +
    (p.scans.length
      ? `<ul class="scan-list">${p.scans.map((s) => `<li><b>${hhmm(s.m)}</b><span>${esc(via(s))}</span></li>`).join('')}</ul>`
      : '<p class="muted">Belum ada scan hari ini.</p>') +
    '<div class="tindakan">' +
    (p.leave ? '<button data-aksi="ubah-izin">Ubah catatan izin</button>' : '<button data-aksi="izin" class="utama">Catat izin, sakit, atau cuti</button>') +
    `<button data-aksi="koreksi"${p.leave ? ' class="utama"' : ''}>Tambah koreksi absen</button></div>` +
    '<p class="muted kecil">Koreksi untuk yang lupa scan, dihitung seperti scan biasa. Log di mesin tidak diubah.</p>';
  $('laci-orang').querySelector('.tindakan').onclick = (e) => {
    const a = e.target.closest('button')?.dataset.aksi;
    if (a === 'izin') openForm('leaves', { pin, from: day });
    if (a === 'ubah-izin') openForm('leaves', {}, p.leave.id);
    if (a === 'koreksi') openForm('corrections', { pin, date: day });
  };
  openDrawer('laci-orang', nameOf(pin), [`PIN ${pin}`, deptOf(pin)].filter(Boolean).join(', '));
  photoUrl(pin).then((url) => {
    const box = $('laci-orang').querySelector(`.foto-orang[data-pin="${CSS.escape(pin)}"]`); // laci belum pindah ke orang lain
    if (!url || !box) return;
    box.title = '';
    box.innerHTML = `<img src="${url}" alt="Foto ${esc(nameOf(pin))}">`;
  });
  $('laci-orang').querySelector('.tindakan .utama').focus();
}

/**
 * Foto karyawan yang dikirim mesin bersama data user (saat didaftarkan/diubah di mesin), dari cadangan
 * di database server (`get_backup`); mesin ini tidak mengirim foto saat absen. Yang sudah ketemu
 * disimpan; yang belum ada dicoba lagi saat laci dibuka lagi (mungkin baru diambil dari mesin).
 */
const photos = new Map(); // PIN -> blob URL
const NO_PHOTO = createElement(FingerprintPattern).outerHTML; // pengganti foto: sidik jari, ikon yang sama dengan menu Mesin
async function photoUrl(pin) {
  if (photos.has(pin)) return photos.get(pin);
  const jpg = (await backups(pin)).map((b) => userPhoto(b.body)).find(Boolean);
  if (jpg) photos.set(pin, URL.createObjectURL(new Blob([jpg], { type: 'image/jpeg' })));
  return photos.get(pin) ?? null;
}

/** Garis putus-putus, bergantian warna tiap jadwal yang memakai jam itu (satu jadwal = satu warna). */
const dashes = (colors) => `repeating-linear-gradient(to bottom, ${colors
  .map((c, i) => `${c} ${i * 7}px ${i * 7 + 4}px, transparent ${i * 7 + 4}px ${(i + 1) * 7}px`).join(', ')})`;
/** Bidang toleransi terlambat, dibagi rata atas-bawah bila jam masuknya dipakai beberapa jadwal. */
const bands = (colors) => `linear-gradient(to bottom, ${colors
  .map((c, i) => `color-mix(in srgb, ${c} 14%, transparent) ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`;

/**
 * Pita jam masuk: satu titik per scan di garis waktu hari ini. Scan pertama tiap orang = titik penuh
 * (merah bila terlambat), scan berikutnya = titik kosong. Garis jam masuk/pulang dari semua jadwal yang
 * berlaku hari ini (utama dan jadwal lain); jam yang tidak dipakai semua jadwal diberi nama jadwalnya.
 * Selalu tampil (juga sebelum ada scan), supaya letaknya di halaman tidak berpindah-pindah.
 */
function ribbon(scans, day, late) {
  const pita = $('pita');
  $('pita-legenda').hidden = !scans.size;
  $('pita-kosong').hidden = !!scans.size;
  const shifts = data.holidays.some((h) => h.date === day) ? [] : [{ ...data.schedule, name: 'Utama' }, ...data.schedules]
    // warna jadwal hanya bila ada jadwal lain; satu jadwal saja = hijau seperti biasa
    .filter((s) => s.days[weekday(day)]?.start).map((s) => ({ name: s.name, color: data.schedules.length ? colorOf(s) : 'var(--hijau)', ...s.days[weekday(day)] }));
  const starts = [...new Set(shifts.map((s) => s.start))];
  const all = [...scans.values()].flat();
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  const from = Math.floor(Math.min(6 * 60, ...all, ...starts.map((t) => minutes(t) - 60)) / 60) * 60;
  const to = Math.ceil(Math.max(20 * 60, ...all, now, ...shifts.map((s) => minutes(s.end) + 60)) / 60) * 60;
  const x = (m) => `${(((m - from) / (to - from)) * 100).toFixed(2)}%`;
  // satu garis per jam masuk/pulang; label yang saling menimpa ditumpuk ke atas, dekat tepi kanan dibalik ke kiri
  const lines = [['Masuk', 'start'], ['Pulang', 'end']].flatMap(([kind, key]) => [...new Set(shifts.map((s) => s[key]))].map((t) => {
    const used = shifts.filter((s) => s[key] === t);
    const names = used.map((s) => s.name);
    // titik warna jadwal (hanya bila ada jadwal lain), sama dengan tanda jadwal di kartu
    const dots = data.schedules.length ? used.map((s) => `<i style="--warna: ${s.color}"></i>`).join('') : '';
    const colors = used.map((s) => s.color);
    return { m: minutes(t), dots, colors, text: `${kind} ${t}${names.length < shifts.length ? ` (${names.join(', ')})` : ''}` };
  })).sort((a, b) => a.m - b.m);
  const labelEnds = [];
  for (const l of lines) {
    const at = (l.m - from) / (to - from);
    const w = (l.text.length * 6.6 + (l.dots.match(/<i/g)?.length ?? 0) * 10 + 10) / (pita.clientWidth || 700); // perkiraan lebar label
    l.flip = at + w > 1;
    const [a, b] = l.flip ? [at - w, at] : [at, at + w];
    l.row = labelEnds.findIndex((end) => end < a);
    if (l.row < 0) l.row = labelEnds.length;
    labelEnds[l.row] = b;
  }
  pita.style.marginTop = `${34 + Math.max(labelEnds.length - 1, 0) * 15}px`;
  // titik yang berdekatan ditumpuk ke atas supaya tidak saling menutupi
  const dots = [...scans].flatMap(([pin, ms]) => ms.map((m, i) => ({ pin, m, first: i === 0 }))).sort((a, b) => a.m - b.m);
  const lastInRow = [];
  const gap = (to - from) * 0.012;
  for (const d of dots) {
    d.row = lastInRow.findIndex((m) => d.m - m >= gap);
    if (d.row < 0) d.row = lastInRow.length;
    lastInRow[d.row] = d.m;
  }
  pita.style.height = `${Math.max(lastInRow.length, 1) * 13 + 8}px`;
  const hours = [];
  for (let h = from; h <= to; h += 120) hours.push(h);
  pita.innerHTML =
    starts.map((t) => `<div class="toleransi" style="left: ${x(minutes(t))}; width: ${x(from + data.schedule.tolerance)}; ` +
      `background: ${bands(shifts.filter((s) => s.start === t).map((s) => s.color))}"></div>`).join('') +
    lines.map((l) => `<div class="garis${l.flip ? ' balik' : ''}" style="left: ${x(l.m)}; top: ${-22 - l.row * 15}px; ` +
      `--c: ${l.colors.length === 1 ? l.colors[0] : 'var(--redup)'}; background: ${dashes(l.colors)}"><span>${l.dots}${esc(l.text)}</span></div>`).join('') +
    (now >= from && now <= to ? `<div class="sekarang" style="left: ${x(now)}" title="Sekarang ${hhmm(now)}"></div>` : '') +
    dots.map((d) => {
      const at = (d.m - from) / (to - from); // label dekat tepi: rata ke dalam supaya tidak terpotong
      return `<div class="titik${d.first ? (late(d.pin) ? ' telat' : '') : ' lagi'}${at < 0.12 ? ' kiri' : at > 0.82 ? ' kanan' : ''}" ` +
        `style="left: ${x(d.m)}; bottom: ${d.row * 13 + 4}px" data-pin="${esc(d.pin)}" ` +
        `data-tip="${esc(nameOf(d.pin))}, ${hhmm(d.m)}${d.first && late(d.pin) ? ' (terlambat)' : ''}"></div>`;
    }).join('') +
    hours.map((h) => `<span class="jam" style="left: ${x(h)}">${hhmm(h)}</span>`).join('');
}
