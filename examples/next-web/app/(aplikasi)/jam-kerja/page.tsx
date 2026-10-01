'use client';
// Menu Jam kerja: jadwal utama dan jadwal lain (jadwal.tsx), dan aturan rekap untuk semua jadwal.
// Tersimpan di aplikasi.json dan langsung dipakai rekap.
import { Plus } from 'lucide-react';
import { useApp } from '@/components/aplikasi';
import { Isian } from '@/components/isian';
import { useUi } from '@/components/ui';
import { SCHEDULE_COLORS } from '@/lib/data';
import { DEFAULT_SCHEDULE } from '@/lib/rekap';
import { Jadwal } from './jadwal';

const RULES = [
  ['tolerance', 'Toleransi terlambat', 'menit', 'Menit terlambat tetap dihitung dari jam masuk. Contoh: masuk 08:00, toleransi 15, scan 08:20 = terlambat 20 menit.'],
  ['minGap', 'Scan kedua dihitung pulang bila minimal', 'menit setelah masuk', 'Scan yang lebih dekat dianggap scan ganda.'],
  ['overtimeMin', 'Lembur dihitung mulai', 'menit setelah jam pulang', 'Lembur di bawah batas ini dihitung 0. Hari yang dihitung lembur diatur per hari di jadwal.'],
] as const;

export default function JamKerja() {
  const { data, save } = useApp();
  const { notify } = useUi();

  function add() {
    save((d) => {
      const color = SCHEDULE_COLORS.find((c) => !d.schedules.some((s) => s.color === c)) ?? SCHEDULE_COLORS[d.schedules.length % SCHEDULE_COLORS.length];
      d.schedules.push({
        id: `j${Date.now().toString(36)}`,
        name: `Jadwal ${d.schedules.length + 2}`,
        color,
        days: structuredClone(d.schedule.days),
        overtime: [...d.schedule.overtime],
        overtimeMax: [...d.schedule.overtimeMax],
      });
    }).catch(() => {});
  }

  function setRule(key: (typeof RULES)[number][0], v: string) {
    const n = v.trim() === '' ? NaN : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 600) return notify('Isi menit dengan angka bulat 0–600.', true);
    save((d) => void (d.schedule[key] = n)).catch(() => {});
  }

  return (
    <section id="jam-kerja" aria-labelledby="judul-jam-kerja" className="form">
      <header className="kepala">
        <h1 id="judul-jam-kerja">Jam kerja</h1>
        <p>Tersimpan otomatis dan langsung dipakai rekap</p>
      </header>
      <div className="judul-tabel">
        <div>
          <h2>Jadwal</h2>
          <p className="muted kecil">
            Jadwal utama berlaku untuk semua karyawan, kecuali yang dipilihkan jadwal lain di menu Karyawan. Lembur dinyalakan per hari: di
            hari kerja dihitung setelah jam pulang, di hari libur seluruh jam kerja dihitung lembur. Maks. jam = lembur paling lama hari itu;
            kosong berarti tanpa batas. Bebas = datang dan pulang kapan saja: hadir bila scan, tanpa terlambat, pulang cepat, atau lembur.
            Bulatan warna di samping nama jadwal = warna jadwal di Hari ini.
          </p>
        </div>
        <button className="utama" title="Mis. paruh waktu atau shift" onClick={add}>
          <Plus />
          Tambah jadwal lain
        </button>
      </div>
      <div className="jadwal-grid">
        <Jadwal id="" />
        {data.schedules.map((s) => (
          <Jadwal key={s.id} id={s.id} />
        ))}
      </div>
      <h2 className="sub">Aturan rekap</h2>
      <p className="muted kecil">Berlaku untuk semua jadwal.</p>
      <div className="panel aturan">
        {RULES.map(([key, label, unit, help]) => (
          <label key={key} className="bidang">
            {label}{' '}
            <span className="satuan">
              <Isian type="number" min="0" max="600" value={String(data.schedule[key])} onCommit={(v) => setRule(key, v)} /> {unit}
            </span>
            <small>{help}</small>
          </label>
        ))}
      </div>
      <p>
        <button
          className="mini"
          // warna bukan aturan: tetap
          onClick={() => save((d) => void (d.schedule = { ...structuredClone(DEFAULT_SCHEDULE), color: d.schedule.color })).catch(() => {})}
        >
          Kembalikan jam kerja dan aturan ke nilai awal
        </button>
      </p>
    </section>
  );
}
