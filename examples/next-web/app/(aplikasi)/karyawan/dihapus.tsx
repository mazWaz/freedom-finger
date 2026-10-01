'use client';
// "Karyawan yang dihapus" di bawah tabel: dipulihkan ke mesin dari cadangan (nama, hak akses, jari, wajah,
// kartu, password, foto). Matikan Ikut rekap untuk akun uji: orangnya tidak tampil lagi di Riwayat dan Rekap.
import { useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { useUi } from '@/components/ui';
import { longDate } from '@/lib/format';
import { enrolled, type Enrolled } from '@/lib/rekap';
import { Catatan, NONE, credShort, ok, shortName, type Note } from './bersama';

export function Dihapus({ pins, creds }: { pins: string[]; creds: Map<string, Enrolled> }) {
  const app = useApp();
  const { ask, notify, waiting } = useUi();
  const [note, setNote] = useState<Note>(null);
  if (!pins.length) return null;

  /** PIN dicek dulu: bila sudah dipakai orang lain di mesin, set_userinfo akan menimpa data orang itu. */
  async function restore(pin: string) {
    const say = (text: string) => setNote({ text, error: true });
    const on = app.latest.current.devices.filter((d) => d.connected);
    if (!on.length) return say('Belum ada mesin yang terhubung. Lihat isian menu mesin di Hari ini.');
    const name = app.nameOf(pin);
    const saved = await app.backups(pin);
    const back = credShort(saved[0] ? enrolled(saved[0].body) : NONE);
    const yes = await ask(`Pulihkan ${name} (PIN ${pin}) ke mesin?\n\nYang ikut kembali: ${back || 'tanpa jari atau wajah'}` +
      `${saved[0]?.privilege === '2' ? ', dan hak admin mesin' : ''}. Setelah itu dia bisa absen lagi.`,
    { title: 'Pulihkan karyawan', okLabel: 'Pulihkan', cancelLabel: 'Batal' });
    if (!yes) return;
    setNote(null);
    try {
      for (const d of on) {
        waiting(`Memeriksa PIN ${pin} di mesin (±20 detik sampai 2 menit)…`);
        const used = ok(await app.command(d.cloud_id, 'get_all_pin')).data?.pin_arr;
        if (!used) throw new Error('Mesin tidak mengirim daftar PIN. Coba lagi.');
        if (used.includes(pin)) throw new Error(`PIN ${pin} sedang dipakai di mesin ${d.cloud_id}. ${name} tidak dipulihkan supaya data di mesin tidak tertimpa.`);
      }
      for (const d of on) {
        // cadangan mesin itu sendiri; mesin yang belum punya (mis. mesin baru) memakai cadangan terbaru
        const b = saved.find((x) => x.cloud_id === d.cloud_id) ?? saved[0];
        waiting(`Memulihkan ${name} ke mesin…`);
        ok(await app.command(d.cloud_id, 'set_userinfo', {
          data: b ? { pin, name: b.name || shortName(name), privilege: b.privilege, template: b.template } : { pin, name: shortName(name), privilege: '1' },
        }));
      }
      await app.save((d) => void delete d.employees[pin].removed);
      notify(`${name} dipulihkan ke mesin${back ? ` dengan ${back}` : ', tanpa jari atau wajah: daftarkan lewat tombol mesin di barisnya'}.`);
    } catch (e) {
      say((e as Error).message);
    } finally {
      waiting();
    }
  }

  return (
    <details id="y-dihapus" className="lipat">
      <summary>Karyawan yang dihapus ({pins.length})</summary>
      <p className="muted">Pulihkan = kirim lagi ke mesin dari cadangan di aplikasi: nama, hak akses, jari, wajah, kartu, dan password seperti
        terakhir dikirim mesin. PIN-nya dicek dulu di mesin supaya tidak menimpa orang lain. Matikan Ikut rekap untuk akun uji:
        orangnya tidak tampil lagi di Riwayat dan Rekap.</p>
      <Catatan note={note} />
      <table>
        <thead>
          <tr><th className="pin">PIN</th><th>Nama</th><th>Dihapus</th><th>Cadangan</th><th className="tengah">Ikut rekap</th><th></th></tr>
        </thead>
        <tbody id="y-dihapus-daftar">
          {pins.map((pin) => {
            const c = creds.get(pin);
            const e = app.data.employees[pin];
            return (
              <tr key={pin}>
                <td className="pin">{pin}</td>
                <td>{app.nameOf(pin)}</td>
                <td>{longDate(e.removed!.slice(0, 10))}</td>
                <td>{c ? credShort(c) || 'Tanpa jari atau wajah' : '…'}</td>
                <td className="tengah">
                  <input type="checkbox" className="saklar" checked={e.recap !== false} aria-label={`Ikut rekap ${app.nameOf(pin)}`}
                    onChange={(ev) => app.save((d) => void (d.employees[pin].recap = ev.target.checked)).catch(() => {})} />
                </td>
                <td className="kanan"><button type="button" className="mini" onClick={() => restore(pin)}>Pulihkan</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
