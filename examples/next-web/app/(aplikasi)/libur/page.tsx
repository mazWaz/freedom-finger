'use client';
// Menu Hari libur: tanggal yang tidak dihitung alpa. Yang akan datang di atas, yang sudah lewat terlipat.
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { PilihTanggal } from '@/components/tanggal';
import { useUi } from '@/components/ui';
import { dayName, dmy, monthName, today } from '@/lib/format';
import type { Holiday } from '@/lib/types';

export default function Libur() {
  const { data, save } = useApp();
  const { notify } = useUi();
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');

  function add() {
    if (!date) return notify('Pilih tanggal hari libur.', true);
    save((d) => {
      d.holidays = [...d.holidays.filter((h) => h.date !== date), { date, note: note.trim() }];
      d.holidays.sort((a, b) => a.date.localeCompare(b.date));
    }).catch(() => {});
    setNote('');
  }

  const t = today();
  const days = (h: Holiday) => Math.round((Date.parse(h.date) - Date.parse(t)) / 86_400_000);
  const when = (n: number) => (n === 0 ? 'hari ini' : n > 0 ? `${n} hari lagi` : `${-n} hari lalu`);
  const item = (h: Holiday) => (
    <li key={h.date}>
      <span className="tgl">
        <b>{Number(h.date.slice(8))}</b>
        <span>{monthName(h.date.slice(0, 7)).slice(0, 3)}</span>
      </span>
      <span className="dua">
        {h.note || 'Libur'}
        <small>
          {dayName(h.date)}, {dmy(h.date)}, {when(days(h))}
        </small>
      </span>
      <button
        className="mini bahaya"
        aria-label={`Hapus libur ${dmy(h.date)}`}
        onClick={() => save((d) => void (d.holidays = d.holidays.filter((x) => x.date !== h.date))).catch(() => {})}
      >
        Hapus
      </button>
    </li>
  );
  const next = data.holidays.filter((h) => h.date >= t);
  const past = data.holidays.filter((h) => h.date < t).reverse();

  return (
    <section id="libur" aria-labelledby="judul-libur" className="form">
      <header className="kepala">
        <h1 id="judul-libur">Hari libur</h1>
        <p>Tidak dihitung alpa. Libur nasional belum terisi otomatis</p>
      </header>
      <div className="sempit">
        {/* div, bukan p: pemilih tanggal berisi kalender (div) */}
        <div className="controls panel tambah" style={{ margin: '10px 0' }}>
          <PilihTanggal value={date} onChange={setDate} label="Tanggal libur" />
          <input id="p-libur-ket" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Keterangan, mis. Tahun Baru" aria-label="Keterangan libur" />
          <button className="utama" onClick={add}>
            <Plus />
            Tambah
          </button>
        </div>
        {next.length ? (
          <ul className="libur-list">{next.map(item)}</ul>
        ) : (
          <p className="muted">Belum ada hari libur yang akan datang. Tambahkan tanggal di atas.</p>
        )}
        {past.length > 0 && (
          <details className="lipat">
            <summary>Sudah lewat ({past.length})</summary>
            <ul className="libur-list lewat">{past.map(item)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}
