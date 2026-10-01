'use client';
// Menu Hari ini: sebaran jam scan (paling atas; arahkan kursor ke titik untuk nama), papan absen (satu
// kartu per karyawan: tepat waktu, terlambat, izin, belum datang) dengan saring, cari, dan halaman,
// rincian satu karyawan di laci dengan tombol izin/koreksi, semua scan hari ini (realtime, terlipat),
// status mesin, isian menu mesin, dan peringatan bila IP server berubah.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { useCatatan } from '@/components/form-catatan';
import { dayName, monthName, today } from '@/lib/format';
import { LOOKBACK_DAYS, addDays, correctionScans, overnight } from '@/lib/rekap';
import type { Scan } from '@/lib/types';
import { DaftarScan } from './daftar-scan';
import { LaciOrang } from './laci-orang';
import { buildPeople, scanKey } from './orang';
import { Papan } from './papan';
import { Pita } from './pita';

/** localStorage yang tidak pernah melempar error (mode privat, penyimpanan penuh). */
function storage(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
  return null;
}

const minuteNow = () => new Date().getHours() * 60 + new Date().getMinutes();

export default function HariIni() {
  const app = useApp();
  const { data, devices, status, logs, logsTick } = app;
  const catatan = useCatatan();
  // jam sekarang di pita dan tanggal hari ini: diperbarui tiap menit (lewat tengah malam = hari baru)
  const [now, setNow] = useState(minuteNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(minuteNow()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const day = today();

  const [machine, setMachine] = useState<Scan[] | null>(null);
  useEffect(() => {
    let alive = true;
    logs(addDays(day, -LOOKBACK_DAYS), day).then((list) => alive && setMachine(list), () => {}); // beberapa hari: pulang jam bebas lewat tengah malam
    return () => {
      alive = false;
    };
  }, [logs, day, logsTick]);
  /** Scan beberapa hari terakhir (untuk overnight dan arti scan) dan scan hari ini saja, terbaru dulu. */
  const recent = useMemo(
    () => machine && [...machine, ...correctionScans(data.corrections, addDays(day, -LOOKBACK_DAYS), day)].sort((a, b) => b.scan_date.localeCompare(a.scan_date)),
    [machine, data.corrections, day],
  );
  const rows = useMemo(() => recent && recent.filter((l) => l.scan_date.startsWith(day)), [recent, day]);

  // scan yang belum pernah tampil sejak halaman dibuka: disorot sebentar
  const shown = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState({ keys: new Set<string>(), pins: new Set<string>(), n: 0 });
  useEffect(() => {
    if (!rows) return;
    const added = shown.current ? rows.filter((l) => !shown.current!.has(scanKey(l))) : [];
    shown.current = new Set(rows.map(scanKey));
    setFresh((f) => ({ keys: new Set(added.map(scanKey)), pins: new Set(added.map((l) => l.pin)), n: f.n + 1 }));
  }, [rows]);

  const { people, holiday } = useMemo(
    () => (rows && recent ? buildPeople(app, rows, day, overnight(recent, app.shiftOn)) : { people: null, holiday: undefined }),
    [app, rows, recent, day],
  );
  const dots = new Map((people ?? []).filter((p) => p.scans.length).map((p) => [p.pin, p.scans.map((x) => x.m)]));
  const late = new Set((people ?? []).filter((p) => p.kind === 'telat').map((p) => p.pin));
  const [open, setOpen] = useState<string | null>(null);
  const person = people?.find((p) => p.pin === open) ?? null;

  const on = devices.filter((d) => d.connected).length;
  const allOn = devices.length > 0 && on === devices.length; // semua terhubung: cukup di sidebar
  const ip = status.server_ip ?? 'IP server Freedom Finger';
  // Mesin mengirim ke Server IP yang tetap: bila IP server berganti, mesin kehilangan tujuan
  const [lastOk, setLastOk] = useState<string | null>(null);
  useEffect(() => {
    setLastOk(storage('ip'));
    if (on) storage('ip', ip);
  }, [on, ip]);
  const ipChanged = !!(devices.length && !on && lastOk && lastOk !== ip);

  return (
    <section id="hari-ini" aria-labelledby="judul-hari-ini">
      <header className="kepala">
        <h1 id="judul-hari-ini">Hari ini</h1>
        <p id="tanggal">{dayName(day)}, {Number(day.slice(8))} {monthName(day.slice(0, 7))}</p>
      </header>
      <p id="status-mesin" className="catatan off" hidden={allOn}>
        {devices.length
          ? `${on} dari ${devices.length} mesin terhubung. Absen dari mesin yang terputus masuk setelah tersambung lagi.`
          : 'Belum ada mesin terhubung. Isi menu mesin seperti di bawah; mesin muncul di sini dalam ±2 menit.'}
      </p>
      <p id="peringatan" className="catatan off" hidden={!ipChanged}>
        IP server Freedom Finger berubah dari {lastOk} menjadi {ip}. Ubah Server IP di mesin ke {ip}, lalu minta admin jaringan
        mereservasi IP server itu di router supaya tidak berubah lagi.
      </p>
      <div className="judul-baris">
        <h2>Sebaran jam scan</h2>
        <p id="pita-legenda" className="legenda redup" aria-hidden="true" hidden={!dots.size}>
          <i />scan pertama<i className="telat" />terlambat<i className="lagi" />scan berikutnya
        </p>
        <p id="pita-kosong" className="legenda redup" hidden={!people || dots.size > 0}>Belum ada scan. Titik muncul di sini begitu karyawan scan.</p>
      </div>
      {/* titik = satu scan; arahkan kursor untuk nama. Isinya sama dengan tabel di bawah, jadi disembunyikan dari pembaca layar */}
      <Pita scans={dots} day={day} late={late} now={now} />
      <Papan people={people} holiday={holiday} fresh={fresh} onOpen={setOpen} />
      <DaftarScan rows={rows ?? []} recent={recent ?? []} fresh={fresh} />
      <p id="isian" className="muted kecil" style={{ marginTop: 20 }} hidden={allOn}>
        Isian di mesin (Menu → Jaringan): Mode Internet, Server IP {ip}, Server Port {status.port}, Server Req Ya.
      </p>
      <LaciOrang
        person={person}
        day={day}
        onClose={() => setOpen(null)}
        onForm={(list, preset, id) => {
          setOpen(null);
          catatan.open(list, preset, id ?? null);
        }}
      />
      {catatan.laci}
    </section>
  );
}
