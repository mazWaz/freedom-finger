'use client';
// Tabel karyawan: nama lengkap, departemen, jadwal, dan "ikut rekap" per PIN, tersimpan otomatis.
// Nama dan departemen disimpan sebentar setelah berhenti mengetik (bukan tiap huruf); jadwal dan sakelar
// langsung. Kotak isian "senyap": tanpa garis sampai baris disentuh, supaya tabel terbaca sebagai daftar.
import { useRef, useState, type InputHTMLAttributes } from 'react';
import { useApp } from '@/components/aplikasi';
import { Mesin } from '@/components/ikon';
import type { Enrolled } from '@/lib/rekap';
import type { Employee } from '@/lib/types';
import { credShort } from './bersama';

type Props = { pins: string[]; q: string; creds: Map<string, Enrolled>; onMachine: (pin: string) => void };

export function TabelKaryawan({ pins, q, creds, onMachine }: Props) {
  const app = useApp();
  const { data, machineName, nameOf } = app;

  /** Isian aplikasi untuk satu PIN; dihapus bila semuanya kembali ke bawaan. */
  const update = (pin: string, patch: Partial<Employee>) =>
    app.save((d) => {
      const e = { ...d.employees[pin], ...patch };
      if (!e.name && !e.dept && e.recap !== false && !e.schedule && !e.added && !e.removed) delete d.employees[pin];
      else d.employees[pin] = e;
    }).catch(() => {});

  /** Keterangan di bawah nama: nama di mesin bila berbeda dari nama lengkap, atau asal nama yang tampil. */
  const diMesin = (pin: string, full?: string) => (!machineName(pin) ? 'Belum ada nama di mesin' : full ? `Di mesin: ${machineName(pin)}` : 'Nama dari mesin');
  /** Cari nama (di mesin atau lengkap) atau PIN. */
  const hidden = (pin: string) => !!q && !pin.includes(q) && !`${nameOf(pin)} ${machineName(pin)}`.toLowerCase().includes(q);
  const schedules = [{ id: '', name: 'Utama' }, ...data.schedules];

  return (
    <table className="karyawan">
      <thead>
        <tr>
          <th className="pin">PIN</th>
          <th>Nama</th>
          <th style={{ width: '24%' }}>Departemen</th>
          <th style={{ width: '18%' }}>Jadwal</th>
          <th>Terdaftar di mesin</th>
          <th className="tengah">Ikut rekap</th>
        </tr>
      </thead>
      <tbody id="y-daftar">
        {pins.map((pin) => {
          const e = data.employees[pin] ?? {};
          const label = `PIN ${pin}`;
          const c = creds.get(pin);
          return (
            <tr key={pin} data-pin={pin} hidden={hidden(pin)}>
              <td className="pin">{pin}</td>
              <td>
                <Ketik className="senyap" value={e.name ?? ''} onSave={(name) => update(pin, { name })}
                  placeholder={machineName(pin) || 'Nama lengkap'} aria-label={`Nama lengkap ${label}`} />
                <small className="di-mesin">{diMesin(pin, e.name)}</small>
              </td>
              <td>
                <Ketik className="senyap petunjuk" value={e.dept ?? ''} onSave={(dept) => update(pin, { dept })}
                  placeholder="Isi departemen" aria-label={`Departemen ${label}`} />
              </td>
              <td>
                <select className="senyap" value={e.schedule ?? ''} aria-label={`Jadwal ${label}`}
                  onChange={(ev) => update(pin, { schedule: ev.target.value || undefined })}>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </td>
              <td>
                <span className="kred">
                  <span>{c && (credShort(c) ? <b>{credShort(c)}</b> : 'Belum ada')}</span>
                  <button type="button" className="mini ikon" aria-label={`Data di mesin ${label}`} title="Nama di mesin, admin, daftarkan, hapus"
                    onClick={() => onMachine(pin)}>
                    <Mesin />
                  </button>
                </span>
              </td>
              <td className="tengah">
                <input type="checkbox" className="saklar" checked={e.recap !== false} aria-label={`Ikut rekap ${label}`}
                  onChange={(ev) => update(pin, { recap: ev.target.checked })} />
              </td>
            </tr>
          );
        })}
        {!pins.length && (
          <tr>
            <td colSpan={6} className="muted">Belum ada data karyawan. Tekan Ambil data dari mesin, atau Tambah karyawan.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

type KetikProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onSave: (value: string) => void };

/** Isian yang disimpan 400 ms setelah berhenti mengetik, dan saat ditinggalkan. */
function Ketik({ value, onSave, ...props }: KetikProps) {
  const [draft, setDraft] = useState<string | null>(null); // null = tidak sedang diketik
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <input
      {...props}
      value={draft ?? value}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onSave(v.trim()), 400);
      }}
      onBlur={() => {
        if (draft === null) return;
        clearTimeout(timer.current);
        if (draft.trim() !== value) onSave(draft.trim());
        setDraft(null);
      }}
    />
  );
}
