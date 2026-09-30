// Tab Rekap: satu baris per karyawan untuk satu bulan (atau rentang), klik untuk rincian per hari.
// Hitungannya di hitung-rekap.js; tab ini hanya mengambil scan, menampilkan, dan meng-export.
import {
  $, byPin, data, dayName, deptOf, dmy, duration, esc, exportCsv, exportXlsx, hhmm, inRecap, knownPins, lastMonths,
  logs, monthName, monthRange, nameOf, period, print, reportTitle, scheduleName, scheduleOf, today, DAY_NAMES,
} from './app.js';
import { LEAVE_KINDS, addDays, correctionScans, recap } from './hitung-rekap.js';

export const LABEL = { hadir: 'Hadir', alpa: 'Alpa', libur: 'Libur', izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti', dinas: 'Dinas luar' };

let scans = [];
let loaded = ''; // rentang yang scan-nya sudah diambil
let seq = 0; // hanya jawaban permintaan terakhir yang dipakai
let result = []; // hasil recap()
let detail = null; // PIN yang rinciannya dibuka

export function init() {
  $('k-bulan').innerHTML = `${lastMonths(13).map((ym) => `<option value="${ym}">${monthName(ym)}</option>`).join('')}` +
    '<option value="custom">Pilih tanggal</option>';
  const setMonth = () => ([$('k-dari').value, $('k-sampai').value] = monthRange($('k-bulan').value));
  $('k-bulan').onchange = () => {
    if ($('k-bulan').value === 'custom') return;
    setMonth();
    show('open');
  };
  $('k-dari').onchange = $('k-sampai').onchange = () => {
    $('k-bulan').value = 'custom';
    show('open');
  };
  const open = (e) => {
    const tr = e.target.closest('tr[data-pin]');
    if (tr && (e.type === 'click' || e.key === 'Enter')) {
      detail = tr.dataset.pin;
      render();
      $('k-kembali').focus();
    }
  };
  $('k-daftar').onclick = $('k-daftar').onkeydown = open;
  $('k-kembali').onclick = () => {
    detail = null;
    render();
  };
  $('k-xlsx').onclick = () => exportXlsx(`${file()}.xlsx`, [summary(), days()]);
  $('k-csv').onclick = () => exportCsv(`${file()}${detail ? `-pin-${detail}` : ''}.csv`, detail ? days(detail) : summary());
  $('k-cetak').onclick = () => print($('k-judul'), (detail ? days(detail) : summary()).title);
  setMonth();
}

const file = () => `rekap-absen-${$('k-dari').value}_${$('k-sampai').value}`;

export async function show(reason) {
  const [from, to] = [$('k-dari').value, $('k-sampai').value];
  if (reason === 'open' || reason === 'logs' || loaded !== `${from} ${to}`) {
    const my = ++seq;
    const list = from && to && from <= to ? await logs(from, to) : [];
    if (my !== seq) return;
    scans = list;
    loaded = `${from} ${to}`;
  }
  const all = [...scans, ...correctionScans(data.corrections, from, to)]; // koreksi manual dihitung sebagai scan
  // karyawan yang dikenal ditambah PIN yang punya scan, kecuali yang tidak ikut rekap
  const pins = [...new Set([...knownPins(), ...all.map((s) => s.pin)])].filter(inRecap).sort(byPin);
  // satu hitungan per jadwal (utama dan jadwal lain), aturan toleransi/lembur sama
  const groups = new Map();
  for (const pin of pins) {
    const s = scheduleOf(pin) ?? data.schedule;
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(pin);
  }
  result = !(from && to) ? [] : [...groups]
    .flatMap(([s, ps]) => recap({ scans: all, pins: ps, schedule: { ...data.schedule, days: s.days }, holidays: data.holidays, leaves: data.leaves,
      from, to, today: today() }))
    .sort((a, b) => byPin(a.pin, b.pin));
  render();
}

/** "Senin–Jumat 08:00–17:00, Sabtu 08:00–13:00" */
function scheduleText(days) {
  const groups = [];
  [1, 2, 3, 4, 5, 6, 0].forEach((i, k) => {
    const t = days[i] && `${days[i].start}–${days[i].end}`;
    const g = groups.at(-1);
    if (t && g?.t === t && g.k === k - 1) Object.assign(g, { to: i, k });
    else if (t) groups.push({ from: i, to: i, k, t });
  });
  const name = (g) => (g.from === g.to ? DAY_NAMES[g.from] : `${DAY_NAMES[g.from]}–${DAY_NAMES[g.to]}`);
  return groups.map((g) => `${name(g)} ${g.t}`).join(', ') || 'belum ada hari kerja';
}

const times = (n, min) => (n ? `${n}× · ${min} mnt` : '');
const leaveDays = (t) => t.izin + t.sakit + t.cuti + t.dinas;
/** Keterangan hari: libur, catatan izin, koreksi manual beserta alasannya, dan temuan rekap. */
function note(d, pin) {
  const leave = LEAVE_KINDS.includes(d.status) && data.leaves.find((l) => l.pin === pin && l.from <= d.date && d.date <= l.to)?.note;
  return [
    d.note,
    leave,
    ...data.corrections.filter((c) => c.pin === pin && c.date === d.date).sort((a, b) => a.time.localeCompare(b.time))
      .map((c) => `Manual ${c.time}: ${c.reason}`),
    d.noOut && 'Lupa absen pulang',
    d.status === 'libur' && d.in != null && d.out == null && 'Scan di hari libur tanpa pulang',
    d.status === 'libur' && d.overtime && 'Lembur hari libur',
  ].filter(Boolean).join('; ');
}

function render() {
  const [from, to] = [$('k-dari').value, $('k-sampai').value];
  const s = data.schedule;
  const last = [to, addDays(today(), -1)].sort()[0];
  $('k-info').textContent = (from > last
    ? 'Periode ini belum bisa dihitung: tanggalnya belum lewat. '
    : `Dihitung ${period(from, last)}${last < to ? ' (hari ini dan sesudahnya belum dihitung)' : ''}. `) +
    `Jam kerja ${data.schedules.length ? [{ name: 'Utama', days: s.days }, ...data.schedules].map((x) => `${x.name} ${scheduleText(x.days)}`).join('; ') : scheduleText(s.days)}` +
    `; toleransi terlambat ${s.tolerance} menit; lembur ${s.overtimeOn === false ? 'tidak dihitung' : `mulai ${s.overtimeMin} menit`}. Ubah di Pengaturan.`;
  $('rekap').classList.toggle('tanpa-lembur', s.overtimeOn === false);
  $('rekap').classList.toggle('tanpa-dept', !result.some((x) => deptOf(x.pin)));
  const r = detail && result.find((x) => x.pin === detail);
  if (detail && !r) detail = null;
  $('k-ringkasan').hidden = !!r;
  $('k-rincian').hidden = !r;
  if (!r) {
    $('k-daftar').innerHTML = result
      .map(({ pin, total: t }) => `<tr data-pin="${esc(pin)}" tabindex="0" class="klik" title="Lihat rincian per hari">` +
        `<td>${esc(nameOf(pin))}</td><td class="dept">${esc(deptOf(pin))}</td><td class="num">${t.workDays}</td><td class="num">${t.present}</td>` +
        `<td class="num${t.late ? ' merah' : ''}">${times(t.late, t.lateMin)}</td><td class="num">${times(t.early, t.earlyMin)}</td>` +
        `<td class="num">${t.noOut || ''}</td><td class="num${t.absent ? ' merah' : ''}">${t.absent || ''}</td><td class="num" title="${LEAVE_KINDS.filter((k) => t[k]).map((k) => `${LABEL[k]} ${t[k]}`).join(' · ')}">${leaveDays(t) || ''}</td>` +
        `<td class="num">${duration(t.hours)}</td><td class="num lembur">${duration(t.overtime)}</td></tr>`)
      .join('') || '<tr><td colspan="11" class="muted">Belum ada karyawan. Ambil data karyawan di tab Karyawan.</td></tr>';
    return;
  }
  $('k-nama').textContent = `${nameOf(r.pin)} · PIN ${r.pin}${data.schedules.length ? ` · jadwal ${scheduleName(r.pin)}` : ''}`;
  $('k-hari').innerHTML = r.days
    .map((d) => `<tr class="${d.status}"><td>${dayName(d.date).slice(0, 3)}, ${dmy(d.date)}</td><td>${hhmm(d.in)}</td><td>${hhmm(d.out)}</td>` +
      `<td>${LABEL[d.status]}</td><td class="num${d.late ? ' merah' : ''}">${d.late || ''}</td><td class="num">${d.early || ''}</td>` +
      `<td class="num">${duration(d.hours)}</td><td class="num lembur">${duration(d.overtime)}</td><td>${esc(note(d, r.pin))}</td></tr>`)
    .join('');
}

/** Tanpa kolom Lembur bila lembur tidak dihitung. */
function withoutOvertime(t) {
  if (data.schedule.overtimeOn !== false) return t;
  const keep = t.columns.map((c) => !c.title.startsWith('Lembur'));
  return { ...t, columns: t.columns.filter((_, i) => keep[i]), rows: t.rows.map((r) => r.filter((_, i) => keep[i])) };
}

/** Ringkasan per karyawan untuk export. */
function summary() {
  const [from, to] = [$('k-dari').value, $('k-sampai').value];
  const int = (title, width = 10) => ({ title, kind: 'int', width });
  return withoutOvertime({
    name: 'Ringkasan',
    title: reportTitle('Rekap absensi', from, to),
    columns: [
      { title: 'PIN', kind: 'text', width: 8 }, { title: 'Nama', kind: 'text', width: 28 }, { title: 'Departemen', kind: 'text', width: 16 },
      { title: 'Jadwal', kind: 'text', width: 14 }, int('Hari kerja'), int('Hadir'), int('Terlambat (kali)'), int('Terlambat (menit)'), int('Pulang cepat (kali)'),
      int('Pulang cepat (menit)'), int('Lupa absen pulang'), int('Alpa'), int('Izin'), int('Sakit'), int('Cuti'), int('Dinas luar'),
      { title: 'Jam kerja (jam)', kind: 'hours', width: 11 }, { title: 'Lembur (jam)', kind: 'hours', width: 11 },
    ],
    rows: result.map(({ pin, total: t }) => [pin, nameOf(pin), deptOf(pin), scheduleName(pin), t.workDays, t.present, t.late, t.lateMin, t.early, t.earlyMin,
      t.noOut, t.absent, t.izin, t.sakit, t.cuti, t.dinas, t.hours, t.overtime]),
  });
}

/** Rincian per hari: semua karyawan, atau satu PIN. */
function days(pin) {
  const [from, to] = [$('k-dari').value, $('k-sampai').value];
  const list = pin ? result.filter((r) => r.pin === pin) : result;
  return withoutOvertime({
    name: 'Rincian',
    title: reportTitle(pin ? `Rincian absensi ${nameOf(pin)} (PIN ${pin})` : 'Rincian absensi', from, to),
    columns: [
      { title: 'PIN', kind: 'text', width: 8 }, { title: 'Nama', kind: 'text', width: 28 }, { title: 'Tanggal', kind: 'date', width: 12 },
      { title: 'Hari', kind: 'text', width: 9 }, { title: 'Masuk', kind: 'time', width: 8 }, { title: 'Pulang', kind: 'time', width: 8 },
      { title: 'Status', kind: 'text', width: 10 }, { title: 'Terlambat (menit)', kind: 'int', width: 10 },
      { title: 'Pulang cepat (menit)', kind: 'int', width: 10 }, { title: 'Jam kerja (jam)', kind: 'hours', width: 10 },
      { title: 'Lembur (jam)', kind: 'hours', width: 10 }, { title: 'Keterangan', kind: 'text', width: 30 },
    ],
    rows: list.flatMap((r) => r.days.map((d) => [r.pin, nameOf(r.pin), d.date, dayName(d.date), d.in, d.out, LABEL[d.status], d.late,
      d.early, d.hours, d.overtime, note(d, r.pin)])),
  });
}
