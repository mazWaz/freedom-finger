'use client';
// Menu Karyawan: nama lengkap, departemen, jadwal, dan "ikut rekap" per PIN; tambah karyawan ke mesin;
// dan karyawan yang dihapus (bisa dipulihkan dari cadangan). Bagian lain menu ini:
// - tabel.tsx: tabel karyawan yang tersimpan otomatis
// - laci.tsx: laci per karyawan (nama di mesin, admin, daftarkan wajah/jari, hapus)
// - tambah.tsx, dihapus.tsx: tambah ke mesin, dan pulihkan yang dihapus
// - bersama.tsx: kredensial dan hasil perintah ke mesin yang dipakai bagian-bagian itu
// Ambil data dari mesin berjalan di latar (components/tugas.tsx), juga saat menu lain dibuka.
import { Download, FingerprintPattern, PenLine, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { Laci } from '@/components/laci';
import { useJobs } from '@/components/tugas';
import type { Enrolled } from '@/lib/rekap';
import { mergeCreds } from './bersama';
import { Dihapus } from './dihapus';
import { LaciKaryawan } from './laci';
import { TabelKaryawan } from './tabel';
import { TambahKaryawan } from './tambah';

export default function Karyawan() {
  const app = useApp();
  const { pullStatus, startPull } = useJobs();
  const [q, setQ] = useState('');
  const [creds, setCreds] = useState(new Map<string, Enrolled>()); // PIN -> jari, wajah, kartu, password dari cadangan
  const [adding, setAdding] = useState(false);
  const [machinePin, setMachinePin] = useState<string | null>(null); // PIN yang lacinya terbuka
  const pins = app.knownPins();
  const removed = app.usedPins().filter(app.isRemoved);

  const { backups } = app;
  const refreshCreds = useCallback(async (pin: string) => {
    const c = mergeCreds(await backups(pin));
    setCreds((m) => new Map(m).set(pin, c));
  }, [backups]);

  // cadangan berubah saat mesin mengirim data user; yang dihapus juga, untuk bagian Karyawan yang dihapus
  const all = [...pins, ...removed].join(',');
  useEffect(() => {
    if (all) for (const pin of all.split(',')) refreshCreds(pin).catch(() => {});
  }, [all, app.users, refreshCreds]);

  const openMachine = (pin: string) => {
    setMachinePin(pin);
    refreshCreds(pin).catch(() => {});
  };

  return (
    <section id="karyawan" aria-labelledby="judul-karyawan">
      <header className="kepala">
        <h1 id="judul-karyawan">Karyawan</h1>
        <p id="y-info">{pins.length} karyawan</p>
      </header>
      <p id="y-status" className="catatan info" role="status" hidden={!pullStatus}>{pullStatus}</p>
      <div className="keterangan">
        <p><PenLine /><span>Nama lengkap dan departemen yang diisi di sini dipakai di semua layar dan laporan. Tersimpan otomatis.</span></p>
        <p><FingerprintPattern /><span>Mesin hanya menyimpan nama sampai <b>15 karakter</b>, jadi tulis nama lengkapnya di sini.</span></p>
        <p><UserPlus /><span>Karyawan baru yang didaftarkan di mesin muncul di daftar ini dengan sendirinya.</span></p>
      </div>
      <div className="controls">
        <input type="search" id="y-cari" placeholder="Cari nama atau PIN" aria-label="Cari karyawan" value={q} onChange={(e) => setQ(e.target.value)} />
        <button id="y-ambil" className="kanan" disabled={!!pullStatus} onClick={startPull}><Download />Ambil data dari mesin</button>
        <button id="y-tambah-buka" className="utama" onClick={() => setAdding(true)}><UserPlus />Tambah karyawan</button>
      </div>
      <TabelKaryawan pins={pins} q={q.trim().toLowerCase()} creds={creds} onMachine={openMachine} />
      <Dihapus pins={removed} creds={creds} />
      <Laci open={adding} title="Tambah karyawan" sub="Masuk ke mesin, lalu daftarkan wajah atau jari" onClose={() => setAdding(false)}>
        <TambahKaryawan
          onCancel={() => setAdding(false)}
          onAdded={(pin) => {
            setAdding(false);
            openMachine(pin);
          }}
        />
      </Laci>
      <Laci open={!!machinePin} title={machinePin ? app.nameOf(machinePin) : ''} sub={machinePin ? `PIN ${machinePin}` : ''} onClose={() => setMachinePin(null)}>
        {machinePin && (
          <LaciKaryawan key={machinePin} pin={machinePin} creds={creds.get(machinePin)} refreshCreds={refreshCreds} onRemoved={() => setMachinePin(null)} />
        )}
      </Laci>
    </section>
  );
}
