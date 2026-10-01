'use client';
// Cari mesin di jaringan kantor (`scan_devices`, lewat port 5005), beserta petunjuk isian menunya.
// Dipakai menu Mesin dan panduan hubungkan mesin: `const cari = useCariMesin()`, lalu `cari.search()`
// dan `{cari.hasil}`.
import { useState } from 'react';
import { api } from '@/lib/api';
import { useUi } from './ui';

type Found = { ip: string; mode: string; cloud_id?: string; note: string };
const MODE: Record<string, string> = { lokal: 'Mode Lokal', ditolak: 'Mode Lokal, password beda', diam: 'Kemungkinan mode Internet' };

export function useCariMesin() {
  const { notify, waiting } = useUi();
  const [found, setFound] = useState<Found[] | null>(null);

  async function search() {
    waiting('Mencari mesin di jaringan (sampai 10 detik)…');
    try {
      setFound(await api<Found[]>('scan_devices'));
    } catch (e) {
      setFound(null);
      notify(`Gagal mencari mesin: ${(e as Error).message}`, true);
    } finally {
      waiting();
    }
  }

  const hasil = !found ? null : found.length ? (
    <ul className="temuan">
      {found.map((f) => (
        <li key={f.ip}>
          <b>{f.ip}</b> · {MODE[f.mode] ?? f.mode}
          {f.cloud_id ? ` · ${f.cloud_id}` : ''}
          <span className="muted">{f.note}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">Tidak ada mesin ditemukan. Pastikan mesin menyala dan satu jaringan dengan server Freedom Finger.</p>
  );
  return { search, hasil };
}
