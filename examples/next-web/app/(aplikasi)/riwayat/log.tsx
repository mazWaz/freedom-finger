'use client';
// Riwayat "Semua scan": tiap scan dikelompokkan per hari, terbaru dulu. Baris halaman lain hanya
// disembunyikan (tr.luar), supaya Cetak tetap berisi semua scan.
import { useApp } from '@/components/aplikasi';
import { Halaman, pageOf } from '@/components/halaman';
import { dayName, monthName } from '@/lib/format';
import type { Scan } from '@/lib/types';
import { rolesOf, verify } from './tabel';

const PER_PAGE = 50;

/** `all` = scan termasuk tepi rentang (untuk arti scan), `every` = scan rentang ini, `list` = yang cocok dengan pencarian. */
export function Log({ all, every, list, page, onPage }: { all: Scan[]; every: Scan[]; list: Scan[]; page: number; onPage: (n: number) => void }) {
  const app = useApp();
  const role = rolesOf(app, all);
  const manual = list.filter((l) => l.manual).length;
  const [, n] = pageOf(list, page, PER_PAGE);
  const [first, end] = [(n - 1) * PER_PAGE, n * PER_PAGE];
  // satu judul per hari; baris hanya jam, nama (PIN di bawahnya), arti scan, dan verifikasi
  const perDay = new Map<string, number>();
  for (const l of list) perDay.set(l.scan_date.slice(0, 10), (perDay.get(l.scan_date.slice(0, 10)) ?? 0) + 1);
  const title = (d: string, cls: string, key: string) => (
    <tr key={key} className={cls}>
      <th colSpan={5}>
        {dayName(d)}, {Number(d.slice(8))} {monthName(d.slice(0, 7))}
        <span>{perDay.get(d)} scan</span>
      </th>
    </tr>
  );
  let day = '';
  const rows = list.flatMap((l, i) => {
    const d = l.scan_date.slice(0, 10);
    const out = i < first || i >= end ? ' luar' : '';
    // hari yang berlanjut dari halaman sebelumnya: judulnya diulang di atas halaman ini (hanya di layar)
    const head = d !== day ? title(d, `hari${out}`, `h${i}`) : i === first ? title(d, 'hari no-print', `h${i}`) : null;
    day = d;
    const cls = `${l.manual ? 'manual' : ''}${out}`.trim();
    return [
      head,
      <tr key={i} className={cls || undefined}>
        <td className="jam">{l.scan_date.slice(11, 16)}</td>
        <td>
          <span className="dua">
            {app.nameOf(l.pin)}
            <small>PIN {l.pin}</small>
          </span>
        </td>
        <td>{role(l) || <span className="redup">–</span>}</td>
        <td>
          {l.manual ? (
            <>
              <span className="lencana">Manual</span>
              <span>{l.reason}</span>
            </>
          ) : (
            verify(l)
          )}
        </td>
        <td className="mesin">{l.cloud_id}</td>
      </tr>,
    ];
  });

  return (
    <div id="r-scan">
      <p id="r-info" className="meta">
        <span>
          <b>{list.length}</b> scan{list.length === every.length ? '' : ` dari ${every.length}`}
        </span>
        {manual > 0 && (
          <span>
            <b>{manual}</b> koreksi manual
          </span>
        )}
      </p>
      <table className="log">
        <thead>
          <tr>
            <th className="jam">Jam</th>
            <th>Nama</th>
            <th>Dihitung sebagai</th>
            <th>Verifikasi</th>
            <th className="mesin">Mesin</th>
          </tr>
        </thead>
        <tbody id="r-daftar">
          {rows.length ? (
            rows
          ) : (
            <tr>
              <td colSpan={5} className="muted">
                {every.length ? 'Tidak ada scan yang cocok dengan pencarian.' : 'Belum ada scan di rentang ini.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Halaman total={list.length} page={n} size={PER_PAGE} onPage={onPage} label="Halaman scan" className="no-print" />
    </div>
  );
}
