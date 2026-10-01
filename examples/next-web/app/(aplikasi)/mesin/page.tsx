'use client';
// Menu Mesin: satu kartu per mesin (kartu.tsx), cari mesin di jaringan, dan panduan hubungkan mesin.
// Mesin mengambil perintah ±20 detik sampai 2 menit kemudian, jadi setiap perintah tampil "menunggu
// mesin" sampai selesai; perintah yang berjalan disimpan di aplikasi.json (tetap terlihat setelah dibuka ulang).
import { useEffect, useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { useCariMesin } from '@/components/cari-mesin';
import { api } from '@/lib/api';
import { Kartu, type DeviceInfo } from './kartu';

export default function Mesin() {
  const { devices, setGuide } = useApp();
  const cari = useCariMesin();
  const [info, setInfo] = useState<Record<string, DeviceInfo | null>>({});

  // daftar mesin diperbarui tiap menit: ambil juga jam dan info tiap mesin
  useEffect(() => {
    let stale = false;
    Promise.all(devices.map((d) => api<DeviceInfo>('get_device', { cloud_id: d.cloud_id }).catch(() => null))).then((list) => {
      if (!stale) setInfo(Object.fromEntries(devices.map((d, i) => [d.cloud_id, list[i]])));
    });
    return () => void (stale = true);
  }, [devices]);

  return (
    <section id="mesin" aria-labelledby="judul-mesin">
      <header className="kepala">
        <h1 id="judul-mesin">Mesin</h1>
        <p>Jam mesin disetel otomatis bila selisihnya lebih dari 2 menit</p>
      </header>
      <div>
        {devices.length ? (
          devices.map((d) => <Kartu key={d.cloud_id} d={d} g={info[d.cloud_id]} />)
        ) : (
          <p className="kosong">Belum ada mesin yang pernah terhubung. Lihat isian menu mesin di menu Hari ini, atau cari mesin di bawah.</p>
        )}
      </div>
      <h2>Cari mesin di jaringan</h2>
      <p className="muted">Mencari mesin di jaringan kantor lewat port 5005, beserta petunjuk isian menunya.</p>
      <div className="controls">
        <button onClick={cari.search}>Cari mesin</button>
        <button onClick={() => setGuide(true)}>Panduan hubungkan mesin</button>
      </div>
      <div>{cari.hasil}</div>
    </section>
  );
}
