'use client';
// Menu Riwayat, dua tampilan untuk rentang tanggal terpilih, keduanya bisa dicari, di-export, dan dicetak:
// - Per hari (bawaan): daftar hadir (matriks.tsx), berwarna menurut hitungan yang sama dengan Rekap.
// - Semua scan (log.tsx): tiap scan dikelompokkan per hari, bisa dipilih per mesin.
// Koreksi absen (menu Izin & koreksi) ikut dihitung dan bertanda "manual", kecuali saat satu mesin dipilih.
import { FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { PilihRentang } from '@/components/tanggal';
import { useUi } from '@/components/ui';
import { exportCsv, exportXlsx, reportTitle } from '@/lib/export';
import { ranges } from '@/lib/format';
import { correctionScans } from '@/lib/rekap';
import type { Scan } from '@/lib/types';
import { Log } from './log';
import { Matriks } from './matriks';
import { logTable, matches, sheet, sheetTable } from './tabel';

export default function Riwayat() {
  const app = useApp();
  const { notify } = useUi();
  const [[from, to], setRange] = useState(() => ranges()['Bulan ini']);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'hari' | 'scan'>('hari'); // 'hari' = daftar hadir per hari, 'scan' = semua scan
  const [picked, setPicked] = useState(''); // mesin terpilih; hanya di tampilan Semua scan
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Scan[]>([]); // hasil get_attlog untuk rentang terpilih, terbaru dulu
  const [loaded, setLoaded] = useState(''); // rentang yang log-nya sudah tampil
  const seq = useRef(0); // hanya jawaban permintaan terakhir yang dipakai (ganti rentang cepat-cepat)
  const { devices, logs, logsTick } = app;
  // daftar hadir selalu dari semua mesin
  const machine = view === 'scan' && devices.some((d) => d.cloud_id === picked) ? picked : '';

  useEffect(() => {
    if (!from || !to) return;
    const my = ++seq.current;
    (from <= to ? logs(from, to, machine || undefined) : Promise.resolve([])).then(
      (list) => {
        if (my !== seq.current) return;
        setRows(list.sort((a, b) => b.scan_date.localeCompare(a.scan_date)));
        setLoaded(`${from} ${to}`);
      },
      (e: Error) => my === seq.current && notify(`Gagal memuat riwayat: ${e.message}`, true),
    );
  }, [from, to, machine, logs, logsTick, notify]);

  /** Scan mesin ditambah koreksi manual, terbaru dulu. */
  const every = useMemo(
    () => (machine ? rows : [...rows, ...correctionScans(app.data.corrections, from, to)].sort((a, b) => b.scan_date.localeCompare(a.scan_date))),
    [machine, rows, app.data.corrections, from, to],
  );
  const query = q.trim().toLowerCase();
  const list = useMemo(() => {
    const match = matches(app, query);
    return every.filter((l) => match(l.pin));
  }, [app, every, query]);
  const grid = useMemo(() => (view === 'hari' ? sheet(app, every, from, to, query) : null), [app, view, every, from, to, query]);

  const current = () => (grid ? sheetTable(app, grid, from, to) : logTable(app, every, list, from, to));
  const file = `riwayat-absen-${from}_${to}`;
  async function xlsx() {
    const err = await exportXlsx(`${file}.xlsx`, [current()]);
    notify(err ?? `Diunduh: ${file}.xlsx`, !!err);
  }
  function csv() {
    exportCsv(`${file}.csv`, current());
    notify(`Diunduh: ${file}.csv`);
  }

  return (
    <section id="riwayat" aria-labelledby="judul-riwayat" className={devices.length < 2 ? 'satu-mesin' : undefined}>
      <header className="kepala">
        <h1 id="judul-riwayat">Riwayat absen</h1>
        <p>Dari scan mesin, izin, dan koreksi manual</p>
      </header>
      <div className="controls">
        <PilihRentang
          from={from}
          to={to}
          label="Rentang tanggal"
          onChange={(a, b) => {
            setRange([a, b]);
            setPage(1);
          }}
        />
        <input
          type="search"
          id="r-cari"
          placeholder="Cari nama atau PIN"
          aria-label="Cari nama atau PIN"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <span className="grup pilih-tampilan" role="group" aria-label="Tampilan">
          <button aria-pressed={view === 'hari'} onClick={() => setView('hari')}>Per hari</button>
          <button aria-pressed={view === 'scan'} onClick={() => setView('scan')}>Semua scan</button>
        </span>
        {devices.length > 1 && view === 'scan' && (
          <select
            id="r-mesin"
            aria-label="Mesin"
            value={machine}
            onChange={(e) => {
              setPicked(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Semua mesin</option>
            {devices.map((d) => (
              <option key={d.cloud_id} value={d.cloud_id}>{d.cloud_id}</option>
            ))}
          </select>
        )}
        <span className="grup kanan" role="group" aria-label="Simpan atau cetak">
          <button onClick={xlsx}><FileSpreadsheet />Excel</button>
          <button onClick={csv}><FileText />CSV</button>
          <button onClick={() => window.print()}><Printer />Cetak</button>
        </span>
      </div>
      <p className="print-title" id="r-judul">{reportTitle(app.data.office, 'Riwayat absen', from, to)}</p>
      {grid ? <Matriks sheet={grid} range={loaded} q={q.trim()} /> : <Log every={every} list={list} page={page} onPage={setPage} />}
    </section>
  );
}
