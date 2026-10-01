'use client';
// Tambah karyawan ke mesin (isi laci "Tambah karyawan"). set_userinfo mengganti SELURUH data user, jadi PIN
// dicek dulu di setiap mesin terhubung: PIN yang ternyata sudah ada akan kehilangan jari dan wajahnya.
import { useState, type FormEvent } from 'react';
import { useApp } from '@/components/aplikasi';
import { useUi } from '@/components/ui';
import { today } from '@/lib/format';
import { Catatan, ok, shortName, type Note } from './bersama';

export function TambahKaryawan({ onAdded, onCancel }: { onAdded: (pin: string) => void; onCancel: () => void }) {
  const app = useApp();
  const { notify, waiting } = useUi();
  const { data, knownPins, usedPins, nameOf } = app;
  // PIN berikutnya setelah yang terbesar yang pernah dipakai (juga karyawan yang sudah dihapus)
  const [pin, setPin] = useState(() => String(Math.max(0, ...usedPins().map(Number).filter(Number.isFinite)) + 1));
  const [name, setName] = useState('');
  const [dept, setDept] = useState('');
  const [schedule, setSchedule] = useState('');
  const [privilege, setPrivilege] = useState('1');
  const [note, setNote] = useState<Note>(null);
  const say = (text: string, error?: boolean) => setNote({ text, error });

  async function add(e: FormEvent) {
    e.preventDefault();
    const p = pin.trim();
    const n = name.trim();
    if (knownPins().includes(p)) return say(`PIN ${p} sudah dipakai ${nameOf(p)}. Pilih PIN lain.`, true);
    if (usedPins().includes(p)) {
      return say(`PIN ${p} pernah dipakai ${nameOf(p)} (sudah dihapus). Riwayat absennya akan tercampur; pilih PIN lain, atau pulihkan ${nameOf(p)} ` +
        'di bagian Karyawan yang dihapus.', true);
    }
    const on = app.latest.current.devices.filter((d) => d.connected);
    if (!on.length) return say('Belum ada mesin yang terhubung. Lihat isian menu mesin di Hari ini.', true);
    try {
      for (const d of on) {
        waiting(`Memeriksa PIN ${p} di mesin (±20 detik sampai 2 menit)…`);
        const r = ok(await app.command(d.cloud_id, 'get_all_pin'));
        if (!r.data?.pin_arr) throw new Error('Mesin tidak mengirim daftar PIN. Coba lagi.');
        if (r.data.pin_arr.includes(p)) throw new Error(`PIN ${p} sudah ada di mesin, tetapi datanya belum diambil ke aplikasi. Pilih PIN lain, atau tekan Ambil data dari mesin.`);
      }
      for (const d of on) {
        waiting(`Menambahkan ${n} ke mesin…`);
        ok(await app.command(d.cloud_id, 'set_userinfo', { data: { pin: p, name: shortName(n), privilege } }));
        // server baru mencatat hak aksesnya setelah membaca user ini; tanpa itu saklar Admin di laci tampil mati
        if (privilege !== '1') {
          waiting('Memeriksa hak akses di mesin…');
          ok(await app.command(d.cloud_id, 'get_userinfo', { pin: p }));
        }
      }
      await app.loadUsers();
      await app.save((d) => void (d.employees[p] = { name: n, dept: dept.trim(), recap: true, schedule: schedule || undefined, added: today() }));
      notify(`${n} ditambahkan ke mesin dengan PIN ${p}.`);
      onAdded(p);
    } catch (err) {
      say((err as Error).message, true);
    } finally {
      waiting();
    }
  }

  return (
    <form id="y-tambah" className="laci-isi" onSubmit={add}>
      <div className="baris">
        <label className="bidang">
          PIN <input name="pin" inputMode="numeric" pattern="[0-9]{1,22}" required value={pin} onChange={(e) => setPin(e.target.value)} />
          <small>Nomor di mesin, belum dipakai</small>
        </label>
        <label className="bidang">
          Jadwal
          <select name="schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)}>
            {[{ id: '', name: 'Utama' }, ...data.schedules].map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="bidang">
        Nama lengkap <input name="name" maxLength={60} required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        <small>{name.trim().length > 15 ? `Di mesin tertulis "${shortName(name.trim())}"` : 'Di mesin tertulis 15 huruf pertama'}</small>
      </label>
      <div className="baris">
        <label className="bidang">
          Departemen <input name="dept" autoComplete="off" value={dept} onChange={(e) => setDept(e.target.value)} />
        </label>
        <label className="bidang">
          Hak di mesin
          <select name="privilege" value={privilege} onChange={(e) => setPrivilege(e.target.value)}>
            <option value="1">Karyawan</option>
            <option value="2">Admin</option>
            <option value="3">Subadmin</option>
          </select>
        </label>
      </div>
      <Catatan note={note} />
      <div className="laci-kaki">
        <button type="button" onClick={onCancel}>Batal</button>
        <button className="utama">Tambah ke mesin</button>
      </div>
    </form>
  );
}
