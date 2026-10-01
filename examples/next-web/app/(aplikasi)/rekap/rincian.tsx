'use client';
// Rekap satu karyawan per hari. Hari alpa atau lupa pulang: izin/koreksi langsung dari sini, nama dan
// tanggal sudah terisi.
import { useApp } from '@/components/aplikasi';
import { LABEL, dayName, dmy, duration, hhmm } from '@/lib/format';
import type { RecapResult } from '@/lib/rekap';
import { note } from './tabel';

type Props = { r: RecapResult; onBack: () => void; onForm: (list: 'leaves' | 'corrections', date: string) => void };

export function Rincian({ r, onBack, onForm }: Props) {
  const app = useApp();
  const t = r.total;
  const info = [
    <>PIN <b>{r.pin}</b></>,
    app.data.schedules.length > 0 && <>Jadwal <b>{app.scheduleName(r.pin)}</b></>,
    <>Hadir <b>{t.present}</b> dari {t.workDays} hari kerja</>,
    t.late > 0 && <>Terlambat <b>{t.late}×</b></>,
    t.absent > 0 && <>Alpa <b>{t.absent}</b></>,
    t.noOut > 0 && <>Lupa pulang <b>{t.noOut}</b></>,
  ];
  return (
    <div id="k-rincian">
      <div className="rincian-kepala no-print">
        <button id="k-kembali" onClick={onBack} autoFocus>← Semua karyawan</button>
        <h2 id="k-nama">{app.nameOf(r.pin)}</h2>
      </div>
      <p id="k-hari-info" className="meta no-print">
        {info.map((x, i) => x && <span key={i}>{x}</span>)}
      </p>
      <table>
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Masuk</th>
            <th>Pulang</th>
            <th>Status</th>
            <th className="num">Terlambat (mnt)</th>
            <th className="num">Pulang cepat (mnt)</th>
            <th className="num">Jam kerja</th>
            <th className="num lembur">Lembur</th>
            <th>Keterangan</th>
            <th className="no-print"><span className="sr-only">Tindakan</span></th>
          </tr>
        </thead>
        <tbody id="k-hari">
          {r.days.map((d) => (
            <tr key={d.date} className={d.status}>
              <td>{dayName(d.date).slice(0, 3)}, {dmy(d.date)}</td>
              <td>{hhmm(d.in)}</td>
              <td>{hhmm(d.out)}</td>
              <td><span className={`lencana ${d.status}`}>{LABEL[d.status]}</span></td>
              <td className={`num${d.late ? ' merah' : ''}`}>{d.late || ''}</td>
              <td className="num">{d.early || ''}</td>
              <td className="num">{duration(d.hours)}</td>
              <td className="num lembur">{duration(d.overtime)}</td>
              <td>{note(app, d, r.pin)}</td>
              <td className="aksi no-print">
                {/* alpa: bisa izin (sakit/cuti) atau lupa scan; lupa pulang: koreksi jam pulang */}
                {d.status === 'alpa' ? (
                  <>
                    <button className="mini" onClick={() => onForm('leaves', d.date)}>Catat izin</button>
                    <button className="mini" onClick={() => onForm('corrections', d.date)}>Koreksi</button>
                  </>
                ) : d.noOut ? (
                  <button className="mini" onClick={() => onForm('corrections', d.date)}>Koreksi pulang</button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
