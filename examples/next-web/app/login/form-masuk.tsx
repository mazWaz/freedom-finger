'use client';
// Form login: user dan kata sandi diperiksa server (lib/server/actions.ts signIn); halaman tidak
// menyimpan kata sandi apa pun. `setup`: belum ada user, form ini membuat user pertama.
import { useActionState } from 'react';
import { signIn } from '@/lib/server/actions';

export function FormMasuk({ setup }: { setup: boolean }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <div className="masuk">
      <form action={action}>
        <img src="/logo.png" alt="" />
        <h1>Freedom Finger</h1>
        <p>{setup ? 'Belum ada pengguna. Buat user pertama untuk aplikasi ini.' : 'Masuk dengan user dan kata sandi Anda.'}</p>
        <label>
          User
          <input name="name" defaultValue={state?.name} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
        </label>
        <label>
          Kata sandi
          <input type="password" name="password" autoComplete={setup ? 'new-password' : 'current-password'} required />
        </label>
        {setup && (
          <label>
            Ulangi kata sandi
            <input type="password" name="ulang" autoComplete="new-password" required />
          </label>
        )}
        {state?.message && <p className="merah" role="alert">{state.message}</p>}
        <button className="utama" disabled={pending}>{setup ? 'Buat user dan masuk' : 'Masuk'}</button>
        {!setup && <p className="redup kecil">Lupa kata sandi? Minta pengguna lain menghapus user Anda di Pengaturan, lalu membuatnya lagi.</p>}
      </form>
    </div>
  );
}
