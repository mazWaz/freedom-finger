'use client';
// Semua scan hari ini (realtime, terlipat), dengan cari dan halaman. "Dihitung sebagai" menurut aturan
// rekap, bukan tombol mesin: sebelum 09:00 mesin selalu mencatat "Pulang".
import { useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { Halaman, pageOf } from '@/components/halaman';
import { VERIFY } from '@/lib/format';
import { scanRoles } from '@/lib/rekap';
import type { Scan } from '@/lib/types';
import { scanKey } from './orang';

const PER_PAGE = 20;

/**
 * `rows` = scan hari ini, terbaru dulu; `recent` = scan beberapa hari terakhir (arti scan, termasuk pulang jam bebas
 * lewat tengah malam); `fresh` = scan yang baru masuk sejak pemuatan sebelumnya.
 */
export function DaftarScan({ rows, recent, fresh }: { rows: Scan[]; recent: Scan[]; fresh: { keys: Set<string>; n: number } }) {
  const app = useApp();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = search.trim().toLowerCase();
  const found = rows.filter((l) => !q || l.pin.includes(q) || app.nameOf(l.pin).toLowerCase().includes(q));
  const roles = scanRoles(recent, app.data.schedule.minGap, app.shiftOn);
  const [list, n] = pageOf(found, page, PER_PAGE);
  return (
    <details className="lipat">
      <summary>
        Semua scan hari ini <span id="jumlah" className="redup">{rows.length ? `(${rows.length})` : ''}</span>
      </summary>
      <div className="controls">
        <input type="search" id="daftar-cari" placeholder="Cari nama atau PIN" aria-label="Cari scan hari ini" value={search}
          onChange={(e) => (setSearch(e.target.value), setPage(1))} />
      </div>
      <table>
        <thead>
          <tr><th>Jam</th><th>Nama</th><th>PIN</th><th>Dihitung sebagai</th><th>Verifikasi</th></tr>
        </thead>
        <tbody id="daftar">
          {list.map((l) => {
            const k = scanKey(l);
            return (
              <tr key={fresh.keys.has(k) ? `${k}:${fresh.n}` : k} className={fresh.keys.has(k) ? 'baru' : undefined}>
                <td>{l.scan_date.slice(11, 16)}</td>
                <td>{app.nameOf(l.pin)}</td>
                <td>{l.pin}</td>
                <td>{roles.get(`${l.pin} ${l.scan_date}`) ?? <span className="redup">–</span>}</td>
                <td>{l.manual ? 'Manual' : (VERIFY[String(l.verify)] ?? l.verify)}</td>
              </tr>
            );
          })}
          {!list.length && (
            <tr><td colSpan={5} className="muted">{rows.length ? 'Tidak ada scan yang cocok dengan pencarian.' : 'Belum ada scan hari ini.'}</td></tr>
          )}
        </tbody>
      </table>
      <Halaman total={found.length} page={n} size={PER_PAGE} onPage={setPage} label="Halaman scan hari ini" />
    </details>
  );
}
