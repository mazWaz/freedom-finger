// Menu Pengaturan: nama kantor, pengguna aplikasi web, dan alamat untuk mesin. Komponen server: daftar
// user dibaca langsung dari users.json (lewat auth), tanpa API. Sesi diperiksa di sini juga, karena
// layout tidak dijalankan ulang saat pindah menu.
import { redirect } from 'next/navigation';
import { auth, currentUser } from '@/lib/server/session';
import { AlamatMesin, Kantor } from './kantor';
import { Pengguna } from './pengguna';

export default async function Pengaturan() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const users = (await auth()).list();
  return (
    <section id="pengaturan" aria-labelledby="judul-pengaturan" className="form">
      <header className="kepala">
        <h1 id="judul-pengaturan">Pengaturan</h1>
        <p>Tersimpan otomatis</p>
      </header>
      <Kantor />
      <Pengguna me={user} users={users} />
      <AlamatMesin />
    </section>
  );
}
