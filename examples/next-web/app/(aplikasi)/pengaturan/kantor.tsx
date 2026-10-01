'use client';
// Blok Kantor (nama kantor untuk judul laporan, tersimpan saat diubah) dan Alamat untuk mesin (isian
// menu Jaringan mesin absensi) di menu Pengaturan.
import { useApp } from '@/components/aplikasi';
import { Isian } from '@/components/isian';

export function Kantor() {
  const { data, save } = useApp();
  return (
    <div className="blok">
      <header>
        <h2>Kantor</h2>
        <p>Nama ini tampil di judul laporan.</p>
      </header>
      <div className="isi">
        <label className="bidang">
          Nama kantor{' '}
          <Isian
            id="p-kantor"
            value={data.office}
            placeholder="Mis. PT Maju Jaya, Cabang Bekasi"
            onCommit={(v) => save((d) => void (d.office = v.trim())).catch(() => {})}
          />
        </label>
      </div>
    </div>
  );
}

export function AlamatMesin() {
  const { status } = useApp();
  return (
    <div className="blok">
      <header>
        <h2>Alamat untuk mesin</h2>
        <p>Isi di menu Jaringan mesin absensi. IP server Freedom Finger sebaiknya direservasi di router.</p>
      </header>
      <div className="isi">
        <dl className="info-mesin">
          <dt>Mode</dt>
          <dd>Internet</dd>
          <dt>Server IP</dt>
          <dd>{status.server_ip ?? 'IP server Freedom Finger (lihat pengaturan jaringannya)'}</dd>
          <dt>Server Port</dt>
          <dd>{status.port}</dd>
          <dt>Server Req</dt>
          <dd>Ya</dd>
        </dl>
      </div>
    </div>
  );
}
