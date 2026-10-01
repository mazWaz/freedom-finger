'use client';
// Riwayat per hari: daftar hadir, karyawan ke bawah dan tanggal ke samping. Tiap sel jam masuk dan pulang,
// berwarna menurut hitungan yang sama dengan Rekap: terlambat, izin/sakit/cuti/dinas, tidak masuk, libur.
// Hari ini ikut tampil; yang belum scan hari ini belum dianggap tidak masuk.
import { useEffect, useRef } from 'react';
import { useApp } from '@/components/aplikasi';
import { dayName, longDate } from '@/lib/format';
import { lateText, shortDate, type Sheet } from './tabel';

export function Matriks({ sheet, range, q }: { sheet: Sheet; range: string; q: string }) {
  const app = useApp();
  const { pins, dates, now, cell: at } = sheet;
  const box = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef(''); // rentang yang tabelnya sudah digulir ke tanggal terakhir

  // rentang baru: tampilkan tanggal terakhir (biasanya hari ini) di ujung kanan; setelah itu posisi gulir pengguna dibiarkan
  useEffect(() => {
    if (scrolledFor.current === range || !box.current || !pins.length) return;
    box.current.scrollLeft = box.current.scrollWidth;
    scrolledFor.current = range;
  }, [range, pins.length]);

  const holidays = new Map(app.data.holidays.map((h) => [h.date, h.note]));
  return (
    <div id="r-hari">
      <div className="matriks-bungkus" ref={box}>
        <table className="matriks">
          <thead>
            {pins.length ? (
              <tr>
                <th>Karyawan</th>
                {dates.map((date) => {
                  // abu-abu bila libur untuk semua orang, hijau untuk hari ini; keterangan libur di title
                  const cls = [date === now && 'sekarang', pins.every((pin) => at(pin, date).kind === 'libur') && 'libur-semua'].filter(Boolean).join(' ');
                  const note = holidays.get(date) ?? (date === now ? 'hari ini' : '');
                  return (
                    <th key={date} scope="col" className={cls || undefined} title={`${dayName(date)} ${longDate(date)}${note ? `, ${note}` : ''}`}>
                      <b>{dayName(date).slice(0, 3)}</b>
                      {shortDate(date)}
                    </th>
                  );
                })}
              </tr>
            ) : (
              <tr>
                <th>Karyawan</th>
              </tr>
            )}
          </thead>
          <tbody>
            {pins.length ? (
              pins.map((pin) => {
                const name = app.nameOf(pin);
                return (
                  <tr key={pin}>
                    <th scope="row" title={`${name}, PIN ${pin}`}>{name}</th>
                    {dates.map((date) => {
                      const c = at(pin, date);
                      const outCls = [c.out === '?' && 'tanpa', c.early && 'cepat', c.manualOut && 'manual'].filter(Boolean).join(' ');
                      return (
                        <td key={date} className={c.kind || undefined} title={`${name}, ${dayName(date)} ${longDate(date)}: ${c.about}`}>
                          {c.in ? (
                            <>
                              <b className={c.manualIn ? 'manual' : undefined}>
                                {c.in}
                                {c.late ? (
                                  <>
                                    <small>{lateText(c.late)}</small>
                                    <span className="sr-only"> terlambat</span>
                                  </>
                                ) : null}
                              </b>
                              <span className={outCls || undefined}>
                                {c.out}
                                {c.out === '?' && <span className="sr-only"> tanpa absen pulang</span>}
                              </span>
                            </>
                          ) : (
                            c.text
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <th scope="row" className="kosong-sel">
                  {q ? `Tidak ada karyawan yang cocok dengan "${q}".` : 'Belum ada data karyawan. Ambil dari mesin di menu Karyawan.'}
                </th>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="legenda-sel redup no-print">
        <i className="telat"></i>terlambat<i className="izin"></i>izin, sakit, cuti
        <span>
          <b className="alpa">Alpa</b> tidak masuk
        </span>
        <i className="libur"></i>libur
        <span>
          <b>17:30</b> pulang cepat
        </span>
        <span>
          <b>?</b> tanpa pulang
        </span>
        <span>
          <u>10:00</u> koreksi manual
        </span>
      </p>
    </div>
  );
}
