'use client';
// Rekap: satu baris per karyawan, dengan strip bulan (satu batang per hari seperti lubang kartu absen).
// Klik baris (atau Enter) untuk rincian per hari.
import { useApp } from '@/components/aplikasi';
import { LABEL, dayName, dmy, duration } from '@/lib/format';
import { LEAVE_KINDS, addDays, type RecapResult, type RecapTotal } from '@/lib/rekap';
import type { LeaveKind } from '@/lib/types';

const STRIP_MAX_DAYS = 62;

/** Berapa kali, dengan total jam:menit di bawahnya. */
const times = (n: number, min: number) =>
  n ? (
    <span className="dua">
      {n}×<small>{duration(min)}</small>
    </span>
  ) : null;
const leaveDays = (t: RecapTotal) => t.izin + t.sakit + t.cuti + t.dinas;

/** Hari yang belum dihitung berupa garis. */
function Strip({ r, from, to }: { r: RecapResult; from: string; to: string }) {
  if (addDays(from, STRIP_MAX_DAYS) <= to) return null;
  const byDate = new Map(r.days.map((d) => [d.date, d]));
  const bars = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const d = byDate.get(date);
    const kind = !d ? 'nanti' : d.status === 'hadir' ? (d.late ? 'telat' : 'hadir') : LEAVE_KINDS.includes(d.status as LeaveKind) ? 'izin' : d.status;
    const what = !d ? 'belum dihitung' : `${LABEL[d.status]}${d.late ? `, terlambat ${d.late} menit` : ''}`;
    bars.push(<i key={date} className={kind} title={`${dayName(date).slice(0, 3)} ${dmy(date)}: ${what}`}></i>);
  }
  return <span className="strip">{bars}</span>;
}

export function Ringkasan({ result, from, to, onOpen }: { result: RecapResult[]; from: string; to: string; onOpen: (pin: string) => void }) {
  const app = useApp();
  return (
    <div id="k-ringkasan">
      <table>
        <thead>
          <tr>
            <th>Karyawan</th>
            <th className="num">Hadir</th>
            <th className="num">Terlambat</th>
            <th className="num">Pulang cepat</th>
            <th className="num">Lupa pulang</th>
            <th className="num">Alpa</th>
            <th className="num">Izin</th>
            <th className="num">Jam kerja</th>
            <th className="num lembur">Lembur</th>
          </tr>
        </thead>
        <tbody id="k-daftar">
          {result.length ? (
            result.map((r) => {
              const t = r.total;
              const dept = app.deptOf(r.pin);
              return (
                <tr
                  key={r.pin}
                  tabIndex={0}
                  className="klik"
                  title="Lihat rincian per hari"
                  onClick={() => onOpen(r.pin)}
                  onKeyDown={(e) => e.key === 'Enter' && onOpen(r.pin)}
                >
                  <td>
                    <span className="nama-rekap">
                      {app.nameOf(r.pin)}
                      {dept && <small>{dept}</small>}
                    </span>
                    <Strip r={r} from={from} to={to} />
                  </td>
                  <td className="num">
                    {t.present}
                    <small className="dari">/{t.workDays}</small>
                  </td>
                  <td className={`num${t.late ? ' merah' : ''}`}>{times(t.late, t.lateMin)}</td>
                  <td className="num">{times(t.early, t.earlyMin)}</td>
                  <td className={`num${t.noOut ? ' merah' : ''}`}>{t.noOut || ''}</td>
                  <td className={`num${t.absent ? ' merah' : ''}`}>{t.absent || ''}</td>
                  <td className="num" title={LEAVE_KINDS.filter((k) => t[k]).map((k) => `${LABEL[k]} ${t[k]}`).join(' · ')}>{leaveDays(t) || ''}</td>
                  <td className="num">{duration(t.hours)}</td>
                  <td className="num lembur">{duration(t.overtime)}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={9} className="muted">Belum ada karyawan. Ambil data karyawan di menu Karyawan.</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="legenda-strip muted no-print">
        <i className="hadir"></i>hadir <i className="telat"></i>terlambat <i className="alpa"></i>alpa <i className="izin"></i>izin, sakit, cuti{' '}
        <i className="libur"></i>libur
      </p>
      <p className="muted kecil no-print">Klik nama untuk rincian per hari. Terlambat dan pulang cepat: berapa kali, dengan total jam:menit di bawahnya.</p>
    </div>
  );
}
