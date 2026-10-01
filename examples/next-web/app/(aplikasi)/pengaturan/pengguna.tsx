'use client';
// Blok Pengguna di menu Pengaturan: daftar user, tambah, hapus, dan ganti kata sandi sendiri. Semua user
// setara. Kata sandi hanya diperiksa dan disimpan (sebagai hash) oleh server action (lib/server/actions.ts),
// yang juga menggambar ulang daftar ini dari server.
import { UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Laci } from '@/components/laci';
import { useUi } from '@/components/ui';
import { longDate } from '@/lib/format';
import { addUser, changePassword, removeUser, type Result } from '@/lib/server/actions';

type User = { name: string; created: string };

/** Server action yang gagal di jaringan (server web mati) menjadi hasil gagal biasa. */
const safe = (p: Promise<Result>) => p.catch((err: Error): Result => ({ success: false, message: err.message }));

export function Pengguna({ me, users }: { me: string; users: User[] }) {
  const { ask, notify } = useUi();
  const [open, setOpen] = useState<'tambah' | 'sandi' | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

  /** Kirim form ke server action; berhasil: tutup laci dan tampilkan `done`. */
  async function submit(e: FormEvent<HTMLFormElement>, send: (f: FormData) => Promise<Result>, done: (f: FormData) => string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const r = await safe(send(f));
    setBusy(false);
    if (!r.success) return notify(r.message ?? 'Gagal.', true);
    close();
    notify(done(f));
  }

  const text = (f: FormData, k: string) => String(f.get(k) ?? '');

  async function remove(name: string) {
    const yes = await ask(`Hapus user ${name}? Orang itu tidak bisa masuk lagi, dan sesinya yang sedang terbuka langsung berakhir.`, {
      title: 'Hapus pengguna',
      okLabel: 'Hapus',
    });
    if (!yes) return;
    const r = await safe(removeUser(name));
    notify(r.success ? `User ${name} dihapus.` : (r.message ?? 'Gagal.'), !r.success);
  }

  return (
    <div className="blok">
      <header>
        <h2>Pengguna</h2>
        <p>Semua pengguna punya hak yang sama. Hapus user orang yang sudah tidak bertugas.</p>
      </header>
      <div className="isi">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Dibuat</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.name}>
                <td>
                  <b>{u.name}</b>
                  {u.name === me && <span className="redup"> (Anda)</span>}
                </td>
                <td>{longDate(u.created.slice(0, 10))}</td>
                <td className="kanan">
                  {u.name !== me && (
                    <button className="mini bahaya" aria-label={`Hapus user ${u.name}`} onClick={() => remove(u.name)}>
                      Hapus
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="baris-jari">
          <button onClick={() => setOpen('tambah')}>
            <UserPlus />
            Tambah pengguna
          </button>
          <button onClick={() => setOpen('sandi')}>Ganti kata sandi saya</button>
        </div>
      </div>
      <Laci open={open === 'tambah'} title="Tambah pengguna" sub="Bisa memakai semua menu aplikasi" onClose={close}>
        <form
          className="laci-isi"
          onSubmit={(e) =>
            submit(e, (f) => addUser(text(f, 'name'), text(f, 'sandi'), text(f, 'ulang')),
              (f) => `User ${text(f, 'name').trim().toLowerCase()} ditambahkan. Beri tahu orangnya user dan kata sandinya.`)
          }
        >
          <label className="bidang">
            User
            <input name="name" autoComplete="off" autoCapitalize="none" spellCheck={false} pattern="[a-z0-9._\-]{3,32}" required />
            <small>3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip</small>
          </label>
          <label className="bidang">
            Kata sandi
            <input type="password" name="sandi" autoComplete="new-password" minLength={8} required />
            <small>Minimal 8 karakter</small>
          </label>
          <label className="bidang">
            Ulangi kata sandi
            <input type="password" name="ulang" autoComplete="new-password" required />
          </label>
          <div className="laci-kaki">
            <button type="button" onClick={close}>Batal</button>
            <button className="utama" disabled={busy}>Tambah pengguna</button>
          </div>
        </form>
      </Laci>
      <Laci open={open === 'sandi'} title="Ganti kata sandi" sub={`User ${me}`} onClose={close}>
        <form
          className="laci-isi"
          onSubmit={(e) =>
            submit(e, (f) => changePassword(text(f, 'lama'), text(f, 'baru'), text(f, 'ulang')),
              () => 'Kata sandi sudah diganti. Perangkat lain dengan user ini harus masuk lagi.')
          }
        >
          <label className="bidang">
            Kata sandi sekarang
            <input type="password" name="lama" autoComplete="current-password" required />
          </label>
          <label className="bidang">
            Kata sandi baru
            <input type="password" name="baru" autoComplete="new-password" minLength={8} required />
            <small>Minimal 8 karakter</small>
          </label>
          <label className="bidang">
            Ulangi kata sandi baru
            <input type="password" name="ulang" autoComplete="new-password" required />
          </label>
          <div className="laci-kaki">
            <button type="button" onClick={close}>Batal</button>
            <button className="utama" disabled={busy}>Ganti kata sandi</button>
          </div>
        </form>
      </Laci>
    </div>
  );
}
