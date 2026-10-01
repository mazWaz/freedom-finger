'use client';
// Panduan hubungkan mesin: cari mesin, isian menu mesin, tunggu terhubung, lalu ambil karyawan dan jam
// kerja. Terbuka sendiri bila belum pernah ada mesin (components/aplikasi.tsx), atau dari menu Mesin.
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useApp } from './aplikasi';
import { useCariMesin } from './cari-mesin';
import { Mesin } from './ikon';
import { Laci } from './laci';
import { useJobs } from './tugas';

export function Panduan() {
  const { guide, setGuide, devices, status, loadDevices } = useApp();
  const { startPull } = useJobs();
  const router = useRouter();
  const cari = useCariMesin();
  // server tidak mengirim event untuk mesin baru: tanya daftar mesin selama panduan terbuka
  useEffect(() => {
    if (!guide) return;
    const timer = setInterval(() => loadDevices().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [guide, loadDevices]);

  const on = devices.filter((d) => d.connected);
  const off = devices.filter((d) => !d.connected);
  const names = (list: typeof devices) => list.map((d) => d.device_name || d.cloud_id).join(', ');
  const fields = [['Mode', 'Internet'], ['Server IP', status.server_ip ?? 'IP server Freedom Finger (lihat pengaturan jaringannya)'],
    ['Server Port', String(status.port ?? '')], ['Server Req', 'Ya']];
  const go = (path: string) => {
    setGuide(false);
    router.push(path);
  };
  return (
    <Laci open={guide} title="Hubungkan mesin absensi" sub="Mesin muncul ±2 menit setelah menunya disimpan" onClose={() => setGuide(false)}>
      <div className="laci-isi">
        <ol className="langkah">
          <li>
            <h3>Nyalakan mesin dan cari</h3>
            <p className="muted">Mesin dan server Freedom Finger harus tersambung ke jaringan kantor yang sama.</p>
            <p><button type="button" onClick={cari.search}>Cari mesin</button></p>
            {cari.hasil}
          </li>
          <li>
            <h3>Isi menu mesin</h3>
            <p className="muted">Di mesin buka <b>Menu → Jaringan</b>, isi persis seperti ini, lalu simpan:</p>
            <dl className="info-mesin">
              {fields.map(([k, v]) => [<dt key={k}>{k}</dt>, <dd key={`${k}=`}><b>{v}</b></dd>])}
            </dl>
            <p className="muted kecil">Minta admin jaringan mereservasi IP server di router. Bila IP-nya berubah, mesin tidak bisa mengirim absen ke sana.</p>
          </li>
          <li>
            <h3>Tunggu mesin terhubung</h3>
            <div className="pd-tunggu">
              <div className={`putar${on.length ? ' selesai' : ''}`}>{on.length ? <Check /> : <Mesin />}</div>
              <p role="status">
                {on.length ? (
                  <><b>{names(on)} terhubung.</b> Absen dari mesin kini masuk ke aplikasi ini.</>
                ) : off.length ? `Menunggu… ${names(off)} pernah terhubung, tetapi sekarang terputus.` : 'Menunggu mesin menghubungi server Freedom Finger…'}
              </p>
            </div>
          </li>
          <li>
            <h3>Mulai pakai</h3>
            <div className="baris-jari rata">
              <button type="button" className="utama" disabled={!on.length} onClick={() => (go('/karyawan'), startPull())}>Ambil data karyawan</button>
              <button type="button" onClick={() => go('/jam-kerja')}>Atur jam kerja</button>
            </div>
          </li>
        </ol>
      </div>
    </Laci>
  );
}
