'use client';
// Menu Rekap: satu baris per karyawan untuk satu bulan (atau rentang), klik untuk rincian per hari.
// Hitungannya di lib/rekap.ts (recapAll di lib/rekap-app.ts); menu ini hanya mengambil scan,
// menampilkan, dan meng-export.
import { CalendarClock, Clock, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { useCatatan } from '@/components/form-catatan';
import { PilihRentang } from '@/components/tanggal';
import { useUi } from '@/components/ui';
import { byPin } from '@/lib/data';
import { exportCsv, exportXlsx } from '@/lib/export';
import { lastMonths, longDate, monthName, monthRange, today } from '@/lib/format';
import { addDays, correctionScans } from '@/lib/rekap';
import { recapAll } from '@/lib/rekap-app';
import type { Scan } from '@/lib/types';
import { Rincian } from './rincian';
import { Ringkasan } from './ringkasan';
import { anyOvertime, daysTable, summaryTable, titleOf } from './tabel';

export default function Rekap() {
  const app = useApp();
  const { notify } = useUi();
  const router = useRouter();
  const catatan = useCatatan();
  const [month, setMonth] = useState(() => lastMonths(1)[0]); // "YYYY-MM", atau 'custom' = rentang sendiri
  const [[from, to], setRange] = useState(() => monthRange(lastMonths(1)[0]));
  const [scans, setScans] = useState<Scan[]>([]);
  const [detail, setDetail] = useState<string | null>(null); // PIN yang rinciannya dibuka
  const seq = useRef(0); // hanya jawaban permintaan terakhir yang dipakai
  const { logs, logsTick, data } = app;

  useEffect(() => {
    const my = ++seq.current;
    (from && to && from <= to ? logs(from, to) : Promise.resolve([])).then(
      (list) => my === seq.current && setScans(list),
      (e: Error) => my === seq.current && notify(`Gagal memuat rekap: ${e.message}`, true),
    );
  }, [from, to, logs, logsTick, notify]);

  const result = useMemo(() => {
    if (!from || !to) return [];
    const all = [...scans, ...correctionScans(data.corrections, from, to)]; // koreksi manual dihitung sebagai scan
    // karyawan yang dikenal ditambah PIN yang punya scan, kecuali yang tidak ikut rekap
    const pins = [...new Set([...app.knownPins(), ...all.map((s) => s.pin)])].filter((pin) => app.inRecap(pin)).sort(byPin);
    return recapAll(app, all, pins, from, to).sort((a, b) => byPin(a.pin, b.pin));
  }, [app, data.corrections, scans, from, to]);

  const r = detail ? result.find((x) => x.pin === detail) : undefined;
  const pin = r ? r.pin : null;
  const overtime = anyOvertime(app);
  const file = `rekap-absen-${from}_${to}`;
  async function xlsx() {
    const err = await exportXlsx(`${file}.xlsx`, [summaryTable(app, result, from, to), daysTable(app, result, from, to)]);
    notify(err ?? `Diunduh: ${file}.xlsx`, !!err);
  }
  function csv() {
    const name = `${file}${pin ? `-pin-${pin}` : ''}.csv`;
    exportCsv(name, pin ? daysTable(app, result, from, to, pin) : summaryTable(app, result, from, to));
    notify(`Diunduh: ${name}`);
  }

  // dua kalimat: sampai kapan dihitung (hanya bila periode belum lewat semua), lalu aturan yang dipakai
  const s = data.schedule;
  const now = today();
  const last = [to, addDays(now, -1)].sort()[0];
  const pending = to === now ? 'Hari ini baru dihitung besok.' : 'Hari ini dan seterusnya belum dihitung.';
  const counted = from > last ? (from === now ? pending : 'Periode ini belum dimulai.')
    : last < to ? <>Dihitung sampai kemarin, <b>{longDate(last)}</b>. {pending}</> : null;

  return (
    <section id="rekap" aria-labelledby="judul-rekap" className={overtime ? undefined : 'tanpa-lembur'}>
      <header className="kepala">
        <h1 id="judul-rekap">Rekap</h1>
        <p>Per karyawan, dari scan, izin, dan koreksi</p>
      </header>
      <div className="controls">
        <select
          id="k-bulan"
          aria-label="Bulan"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            if (e.target.value !== 'custom') setRange(monthRange(e.target.value));
          }}
        >
          {lastMonths(13).map((ym) => (
            <option key={ym} value={ym}>{monthName(ym)}</option>
          ))}
          <option value="custom">Pilih tanggal</option>
        </select>
        <PilihRentang
          from={from}
          to={to}
          label="Rentang tanggal"
          onChange={(a, b) => {
            setMonth('custom');
            setRange([a, b]);
          }}
        />
        <span className="grup kanan" role="group" aria-label="Simpan atau cetak">
          <button onClick={xlsx}><FileSpreadsheet />Excel</button>
          <button onClick={csv}><FileText />CSV</button>
          <button onClick={() => window.print()}><Printer />Cetak</button>
        </span>
      </div>
      <p className="print-title" id="k-judul">{titleOf(app, from, to, pin)}</p>
      <div id="k-info" className="keterangan no-print">
        {counted && (
          <p>
            <CalendarClock />
            <span>{counted}</span>
          </p>
        )}
        <p>
          <Clock />
          <span>
            {s.tolerance ? <>Terlambat bila masuk lebih dari <b>{s.tolerance} menit</b> setelah jam masuk.</> : 'Terlambat bila masuk setelah jam masuk.'}{' '}
            {!overtime ? <>Lembur <b>tidak dihitung</b>.</>
              : <>Lembur dihitung mulai <b>{s.overtimeMin} menit</b> setelah jam pulang, di hari yang lemburnya aktif.</>}
          </span>
          <button onClick={() => router.push('/jam-kerja')}>Ubah aturan rekap</button>
        </p>
      </div>
      {r ? (
        <Rincian r={r} onBack={() => setDetail(null)} onForm={(list, date) => catatan.open(list, list === 'leaves' ? { pin: r.pin, from: date } : { pin: r.pin, date })} />
      ) : (
        <Ringkasan result={result} from={from} to={to} onOpen={setDetail} />
      )}
      {catatan.laci}
    </section>
  );
}
