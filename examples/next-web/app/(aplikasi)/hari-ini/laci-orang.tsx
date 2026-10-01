'use client';
// Rincian satu karyawan hari ini di laci: foto, status, scan hari ini, dan tombol izin/koreksi yang sudah
// terisi nama dan tanggal.
import { FingerprintPattern } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp, type App } from '@/components/aplikasi';
import type { Kind as Form } from '@/components/form-catatan';
import { Laci } from '@/components/laci';
import { LABEL, VERIFY, hhmm, period } from '@/lib/format';
import { userPhoto } from '@/lib/rekap';
import type { Correction, Leave } from '@/lib/types';
import { JadwalTag, lateBy, type Person, type ScanTime } from './orang';

/**
 * Foto karyawan yang dikirim mesin bersama data user (saat didaftarkan/diubah di mesin), dari cadangan
 * di database server (`get_backup`); mesin ini tidak mengirim foto saat absen. Yang sudah ketemu
 * disimpan; yang belum ada dicoba lagi saat laci dibuka lagi (mungkin baru diambil dari mesin).
 */
const photos = new Map<string, string>(); // PIN -> blob URL
async function photoUrl(backups: App['backups'], pin: string) {
  if (photos.has(pin)) return photos.get(pin)!;
  const jpg = (await backups(pin)).map((b) => userPhoto(b.body)).find(Boolean);
  if (jpg) photos.set(pin, URL.createObjectURL(new Blob([jpg as BlobPart], { type: 'image/jpeg' })));
  return photos.get(pin) ?? null;
}

type Props = {
  person: Person | null;
  day: string;
  onClose: () => void;
  /** Tutup laci ini, lalu buka form izin/koreksi (components/form-catatan.tsx). */
  onForm: (list: Form, preset: Partial<Leave & Correction>, id?: string) => void;
};

export function LaciOrang({ person, day, onClose, onForm }: Props) {
  const app = useApp();
  const pin = person?.pin ?? '';
  return (
    <Laci open={!!person} title={pin && app.nameOf(pin)} sub={pin && [`PIN ${pin}`, app.deptOf(pin)].filter(Boolean).join(', ')} onClose={onClose}>
      {person && <Isi key={pin} p={person} day={day} onForm={onForm} />}
    </Laci>
  );
}

function Isi({ p, day, onForm }: { p: Person; day: string; onForm: Props['onForm'] }) {
  const app = useApp();
  const [photo, setPhoto] = useState<string | null>(null);
  const { backups } = app;
  // sekali per laci dibuka (Isi dipasang ulang untuk tiap PIN), bukan tiap data aplikasi berubah
  useEffect(() => {
    let alive = true;
    photoUrl(backups, p.pin).then((url) => alive && setPhoto(url), () => {});
    return () => {
      alive = false;
    };
  }, [p.pin]);

  const free = !!p.shift?.free;
  const status = {
    telat: () => `Terlambat ${lateBy(p)} menit`,
    tepat: () => (free ? 'Sudah datang' : 'Datang tepat waktu'),
    luar: () => 'Absen di luar jadwal kerjanya',
    izin: () => `${LABEL[p.leave!.kind]} ${period(p.leave!.from, p.leave!.to)}${p.leave!.note ? `: ${p.leave!.note}` : ''}`,
    belum: () => 'Belum datang',
  }[p.kind]();
  const via = (s: ScanTime) => (s.manual ? `koreksi manual${s.reason ? `: ${s.reason}` : ''}` : (VERIFY[String(s.verify)] ?? 'scan mesin'));
  const shift = !p.shift ? 'Tidak ada jadwal kerja hari ini' : p.shift.free ? 'Hari ini jam bebas' : `Jadwal hari ini ${p.shift.start}–${p.shift.end}`;
  return (
    <div id="laci-orang" className="laci-isi">
      <div className="orang-kepala">
        <div className="foto-orang" title={photo ? undefined : 'Belum ada foto dari mesin'}>
          {/* pengganti foto: sidik jari, ikon yang sama dengan menu Mesin */}
          {photo ? <img src={photo} alt={`Foto ${app.nameOf(p.pin)}`} /> : <FingerprintPattern />}
        </div>
        <div>
          <p className={`kartu-status ${p.kind}`}><b>{status}</b></p>
          <p className="muted"><JadwalTag app={app} pin={p.pin} /> {shift}</p>
        </div>
      </div>
      {p.scans.length || p.back != null ? (
        <ul className="scan-list">
          {p.back != null && (
            <li><b>{hhmm(p.back)}</b><span>pulang dari masuk kemarin (jam bebas)</span></li>
          )}
          {p.scans.map((s, i) => (
            <li key={i}><b>{hhmm(s.m)}</b><span>{via(s)}</span></li>
          ))}
        </ul>
      ) : (
        <p className="muted">Belum ada scan hari ini.</p>
      )}
      <div className="tindakan">
        {p.leave ? (
          <button onClick={() => onForm('leaves', {}, p.leave!.id)}>Ubah catatan izin</button>
        ) : (
          <button className="utama" data-autofocus onClick={() => onForm('leaves', { pin: p.pin, from: day })}>Catat izin, sakit, atau cuti</button>
        )}
        <button className={p.leave ? 'utama' : undefined} data-autofocus={p.leave ? true : undefined} onClick={() => onForm('corrections', { pin: p.pin, date: day })}>
          Tambah koreksi absen
        </button>
      </div>
      <p className="muted kecil">Koreksi untuk yang lupa scan, dihitung seperti scan biasa. Log di mesin tidak diubah.</p>
    </div>
  );
}
