'use client';
// Satu kartu jadwal di menu Jam kerja (utama, atau jadwal lain seperti paruh waktu). Tiap hari: sakelar
// kerja, jam masuk–pulang atau jam bebas (hari libur: tulisan Libur), sakelar lembur, dan lembur maksimal
// (tampil hanya bila lembur hari itu aktif; jam bebas tanpa lembur). Tersimpan saat diubah.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { Isian } from '@/components/isian';
import { useUi } from '@/components/ui';
import { colorOf } from '@/lib/data';
import { DAY_NAMES } from '@/lib/format';
import type { AppData, OtherSchedule, Schedule } from '@/lib/types';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Senin dulu

/** Jadwal utama (`''`) atau jadwal lain; keduanya punya `days`. */
export const pick = (d: AppData, id: string): Schedule | OtherSchedule => (id ? d.schedules.find((s) => s.id === id)! : d.schedule);

/** Warna jadwal (tanda jadwal di Hari ini); disimpan sebentar setelah berhenti menggeser, bukan tiap gerakan. */
function Warna({ id, label }: { id: string; label: string }) {
  const { data, save } = useApp();
  const color = colorOf(pick(data, id));
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <input
      type="color"
      value={draft ?? color}
      aria-label={`Warna jadwal ${label}`}
      title="Warna jadwal di Hari ini"
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          save((d) => void (pick(d, id).color = v)).catch(() => {});
          setDraft(null);
        }, 500);
      }}
    />
  );
}

function Hari({ id, i, label }: { id: string; i: number; label: string }) {
  const { data, save } = useApp();
  const { notify } = useUi();
  const s = pick(data, id);
  const d = s.days[i];
  const l = `${label} ${DAY_NAMES[i]}`;

  function setDay(work: boolean, free: boolean, start = d?.start ?? '', end = d?.end ?? '') {
    // hari yang baru dijadikan hari kerja memakai jam hari kerja lain
    const base = s.days.find((x) => x?.start) ?? { start: '08:00', end: '17:00' };
    const [a, b] = [start || base.start!, end || base.end!];
    if (work && !free && a >= b) return notify(`${DAY_NAMES[i]}: jam pulang harus setelah jam masuk.`, true);
    save((x) => void (pick(x, id).days[i] = !work ? null : free ? { free: true } : { start: a, end: b })).catch(() => {});
  }

  function setMax(v: string) {
    v = v.trim();
    if (v && !(Number(v) > 0 && Number(v) <= 24)) return notify('Isi lembur maksimal 0,5 sampai 24 jam, atau kosongkan untuk tanpa batas.', true);
    save((x) => void (pick(x, id).overtimeMax[i] = Math.round(Number(v) * 60))).catch(() => {}); // menit; kosong = 0 = tanpa batas
  }

  const free = !!d?.free;
  return (
    <div className={`hari-kerja${d ? '' : ' off'}${free ? ' bebas' : ''}`}>
      <span className="nama-hari">{DAY_NAMES[i]}</span>
      <input type="checkbox" className="saklar" name="work" checked={!!d} aria-label={`${l} hari kerja`} onChange={(e) => setDay(e.target.checked, free)} />
      <span className="rentang">
        <span className="jam-isi">
          <Isian type="time" name="start" value={d?.start ?? ''} aria-label={`${l} jam masuk`} onCommit={(v) => setDay(true, false, v)} /> –{' '}
          <Isian type="time" name="end" value={d?.end ?? ''} aria-label={`${l} jam pulang`} onCommit={(v) => setDay(true, false, undefined, v)} />
        </span>
        <label className="bebas-pilih" title="Datang dan pulang kapan saja: tidak ada terlambat, pulang cepat, atau lembur">
          <input type="checkbox" name="free" checked={free} aria-label={`${l} jam bebas`} onChange={(e) => setDay(true, e.target.checked)} /> Bebas
        </label>
      </span>
      <span className="libur-teks">Libur</span>
      <input
        type="checkbox"
        className="saklar"
        name="ot"
        checked={!!s.overtime[i]}
        aria-label={`${l} hitung lembur`}
        title={d ? 'Hitung lembur setelah jam pulang' : 'Kerja di hari libur ini seluruhnya dihitung lembur'}
        onChange={(e) => {
          const on = e.target.checked;
          save((x) => void (pick(x, id).overtime[i] = on)).catch(() => {});
        }}
      />
      <Isian
        type="number"
        name="otmax"
        min="0.5"
        max="24"
        step="0.5"
        value={s.overtimeMax[i] ? String(s.overtimeMax[i] / 60) : ''}
        placeholder="bebas"
        aria-label={`${l} lembur maksimal, jam`}
        title="Lembur paling lama hari itu; kosong = tanpa batas"
        onCommit={setMax}
      />
    </div>
  );
}

/** Kartu jadwal; `id` kosong = jadwal utama. */
export function Jadwal({ id }: { id: string }) {
  const { data, save } = useApp();
  const { ask } = useUi();
  const s = pick(data, id);
  const label = id ? (s as OtherSchedule).name : 'Utama';

  async function remove() {
    const pins = Object.keys(data.employees).filter((pin) => data.employees[pin].schedule === id);
    if (!(await ask(`Hapus jadwal "${label}"? ${pins.length} karyawan kembali ke jadwal Utama.`, { title: 'Hapus jadwal' }))) return;
    save((d) => {
      d.schedules = d.schedules.filter((x) => x.id !== id);
      for (const pin of pins) delete d.employees[pin].schedule;
    }).catch(() => {});
  }

  return (
    <div className="panel jadwal-kartu">
      <header>
        <Warna id={id} label={label} />
        {id ? (
          <>
            <Isian
              className="senyap"
              name="sname"
              value={label}
              aria-label="Nama jadwal"
              onCommit={(v) => save((d) => void ((pick(d, id) as OtherSchedule).name = v.trim() || 'Tanpa nama')).catch(() => {})}
            />
            <button className="mini bahaya" onClick={remove}>Hapus</button>
          </>
        ) : (
          <div>
            <h3>Utama</h3>
            {data.schedules.length > 0 && <p>Untuk karyawan tanpa jadwal lain</p>}
          </div>
        )}
      </header>
      <div className="hari-kerja judul-kolom" aria-hidden="true">
        <span></span>
        <span>Kerja</span>
        <span>Jam kerja</span>
        <span>Lembur</span>
        <span>Maks. jam</span>
      </div>
      {ORDER.map((i) => (
        <Hari key={i} id={id} i={i} label={label} />
      ))}
    </div>
  );
}
