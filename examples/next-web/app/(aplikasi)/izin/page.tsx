'use client';
// Menu Izin & koreksi: izin, sakit, cuti, dan dinas luar per karyawan, serta koreksi absen untuk yang
// lupa scan. Keduanya hanya disimpan di aplikasi.json; log mesin tidak pernah diubah, supaya data asli
// mesin tetap utuh sebagai bukti. Rekap dan Riwayat membacanya dari data aplikasi. Form-nya di
// components/form-catatan.tsx, juga dibuka dari Hari ini dan Rekap.
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { describe, useCatatan, type Kind } from '@/components/form-catatan';
import { Halaman, pageOf } from '@/components/halaman';
import { useUi } from '@/components/ui';
import { LABEL, dmy, period } from '@/lib/format';
import type { Correction, Leave } from '@/lib/types';

const PER_PAGE = 10;

export default function Izin() {
  const app = useApp();
  const { ask } = useUi();
  const catatan = useCatatan();
  const [page, setPage] = useState({ leaves: 1, corrections: 1 }); // terbaru dulu
  const allLeaves = [...app.data.leaves].sort((a, b) => b.from.localeCompare(a.from));
  const allCorrections = [...app.data.corrections].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  const [leaves, nl] = pageOf(allLeaves, page.leaves, PER_PAGE);
  const [corrections, nc] = pageOf(allCorrections, page.corrections, PER_PAGE);

  async function remove(list: Kind, v: Leave | Correction) {
    if (!(await ask(`Hapus ${describe(app, list, v)}?`, { title: 'Hapus catatan', okLabel: 'Hapus', cancelLabel: 'Batal' }))) return;
    app.save((d) => {
      if (list === 'leaves') d.leaves = d.leaves.filter((x) => x.id !== v.id);
      else d.corrections = d.corrections.filter((x) => x.id !== v.id);
    }).catch(() => {});
  }

  const buttons = (list: Kind, v: Leave | Correction) => (
    <td className="num">
      <button name="ubah" aria-label={`Ubah ${describe(app, list, v)}`} onClick={() => catatan.open(list, {}, v.id)}>Ubah</button>{' '}
      <button name="hapus" className="bahaya" aria-label={`Hapus ${describe(app, list, v)}`} onClick={() => remove(list, v)}>Hapus</button>
    </td>
  );

  return (
    <section id="izin" aria-labelledby="judul-izin">
      <header className="kepala">
        <h1 id="judul-izin">Izin &amp; koreksi</h1>
        <p>Disimpan di aplikasi ini saja; log absen di mesin tidak pernah diubah</p>
      </header>
      <div className="judul-tabel">
        <div>
          <h2>Izin, sakit, cuti, dinas luar</h2>
          <p className="muted">Hari kerja dengan catatan ini tidak dihitung alpa, walau ada scan.</p>
        </div>
        <button id="i-baru-izin" className="utama" onClick={() => catatan.open('leaves')}><Plus />Catat izin</button>
      </div>
      <table>
        <thead>
          <tr><th>Tanggal</th><th>Nama</th><th>Jenis</th><th>Keterangan</th><th></th></tr>
        </thead>
        <tbody id="i-izin-daftar">
          {leaves.map((l) => (
            <tr key={l.id}>
              <td>{period(l.from, l.to)}</td><td>{app.nameOf(l.pin)}</td><td>{LABEL[l.kind]}</td><td>{l.note}</td>
              {buttons('leaves', l)}
            </tr>
          ))}
          {!leaves.length && <tr><td colSpan={5} className="muted">Belum ada catatan. Tekan Catat izin, atau buka kartu karyawan di Hari ini.</td></tr>}
        </tbody>
      </table>
      <Halaman total={allLeaves.length} page={nl} size={PER_PAGE} onPage={(n) => setPage((p) => ({ ...p, leaves: n }))} label="Halaman izin" />
      <div className="judul-tabel">
        <div>
          <h2>Koreksi absen</h2>
          <p className="muted">Untuk karyawan yang lupa scan. Koreksi dihitung di Rekap seperti scan biasa, dan tampil bertanda &quot;manual&quot; di Riwayat.</p>
        </div>
        <button id="i-baru-koreksi" onClick={() => catatan.open('corrections')}><Plus />Koreksi absen</button>
      </div>
      <table>
        <thead>
          <tr><th>Tanggal</th><th>Jam</th><th>Nama</th><th>Alasan</th><th></th></tr>
        </thead>
        <tbody id="i-koreksi-daftar">
          {corrections.map((c) => (
            <tr key={c.id}>
              <td>{dmy(c.date)}</td><td>{c.time}</td><td>{app.nameOf(c.pin)}</td><td>{c.reason}</td>
              {buttons('corrections', c)}
            </tr>
          ))}
          {!corrections.length && <tr><td colSpan={5} className="muted">Belum ada koreksi.</td></tr>}
        </tbody>
      </table>
      <Halaman total={allCorrections.length} page={nc} size={PER_PAGE} onPage={(n) => setPage((p) => ({ ...p, corrections: n }))} label="Halaman koreksi" />
      {catatan.laci}
    </section>
  );
}
