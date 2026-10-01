'use client';
// Isi laci per karyawan: nama dan hak admin di mesin, daftarkan wajah/jari/kartu/password (reg_online:
// layar daftar terbuka di mesin; hasilnya masuk ke cadangan di server), dan hapus dari mesin.
import { useState } from 'react';
import { useApp } from '@/components/aplikasi';
import { useUi } from '@/components/ui';
import { sleep } from '@/lib/api';
import { today } from '@/lib/format';
import { enrolled, type Enrolled } from '@/lib/rekap';
import { CARD, Catatan, FACE, FINGERS, NONE, PASSWORD, credText, got, latestUser, ok, shortName, soleAdmin, targets, what, type Note } from './bersama';

type Props = { pin: string; creds?: Enrolled; refreshCreds: (pin: string) => Promise<void>; onRemoved: () => void };

export function LaciKaryawan({ pin, creds, refreshCreds, onRemoved }: Props) {
  const app = useApp();
  const { ask, notify, waiting } = useUi();
  const { devices, users, data, nameOf, machineName, isRemoved } = app;
  const c = creds ?? NONE;
  const on = devices.filter((d) => d.connected);
  const free = FINGERS.findIndex((_, i) => !c.fingers.includes(i));
  const [name, setName] = useState(() => machineName(pin) || shortName(data.employees[pin]?.name ?? ''));
  const [admin, setAdmin] = useState(() => latestUser(users, pin)?.privilege === '2');
  const [finger, setFinger] = useState<number | null>(null); // null = jari pertama yang belum terdaftar
  const [machine, setMachine] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState<Note>(null);
  const tell = (text: string, error?: boolean) => setNote({ text, error });
  const sole = soleAdmin(users, pin, isRemoved).length > 0;
  const who = nameOf(pin);

  /**
   * set_userinfo mengganti seluruh data user, jadi data TERBARU diambil dulu dari mesin (get_userinfo, bukan
   * cadangan lama) dan template-nya (jari, wajah, kartu, password, foto) dikirim ulang bersama nama dan hak
   * akses baru. Sesudahnya dibaca lagi: server mencatat nama baru, dan kredensialnya dipastikan tetap sama.
   */
  async function saveMachine() {
    const n = name.trim();
    if (!n) return tell('Isi nama di mesin.', true);
    if (n === machineName(pin) && admin === (latestUser(users, pin)?.privilege === '2')) return tell('Tidak ada yang berubah.');
    if (!admin && sole && !(await ask(`${who} adalah admin terakhir di mesin. Tanpa admin, siapa pun bisa membuka menu mesin: ` +
      'menambah dan menghapus karyawan, mengubah pengaturan, dan menghapus data absen.\n\nTetap cabut hak admin?',
    { title: 'Admin terakhir', okLabel: 'Cabut admin', cancelLabel: 'Batal' }))) {
      setAdmin(true);
      return;
    }
    let fingers;
    try {
      for (const d of targets(app.latest.current.devices, app.latest.current.users, pin)) {
        waiting('Mengambil data terbaru dari mesin (±20 detik sampai 2 menit)…');
        const now = ok(await app.command(d.cloud_id, 'get_userinfo', { pin })).data;
        if (!now?.template) throw new Error('Mesin tidak mengirim data lengkapnya, jadi tidak ada yang diubah.');
        // kosong = hak akses tetap seperti di mesin (juga subadmin)
        const privilege = admin === (now.privilege === '2') ? '' : admin ? '2' : '1';
        waiting('Menyimpan nama dan hak akses ke mesin…');
        ok(await app.command(d.cloud_id, 'set_userinfo', { data: { pin, name: n, privilege, template: now.template } }));
        waiting('Memeriksa hasilnya di mesin…');
        const after = ok(await app.command(d.cloud_id, 'get_userinfo', { pin })).data;
        if (['finger', 'face', 'password', 'rfid'].some((k) => after?.[k] !== now[k])) {
          throw new Error(`Data di mesin berubah sesudah disimpan: jari ${now.finger} → ${after?.finger}, wajah ${now.face} → ${after?.face}. ` +
            'Periksa di mesin; bila perlu daftarkan ulang.');
        }
        fingers = now.finger;
      }
      await app.loadUsers();
      await refreshCreds(pin);
      const text = `Nama di mesin untuk PIN ${pin}: ${n}${admin ? ', admin mesin' : ''}. Jari sebelum dan sesudah: ${fingers}; ` +
        'wajah, kartu, dan password tidak berubah.';
      tell(text);
      notify(text);
    } catch (e) {
      tell((e as Error).message, true);
    } finally {
      waiting();
    }
  }

  /** Konfirmasinya PIN yang diketik ulang (tombol mati sampai cocok). */
  async function remove() {
    try {
      // hanya mesin yang punya data orang ini: DELETE_USER untuk PIN yang tidak ada tidak dijawab mesin
      for (const d of targets(app.latest.current.devices, app.latest.current.users, pin)) {
        waiting(`Menghapus ${who} dari mesin (±20 detik sampai 2 menit)…`);
        ok(await app.command(d.cloud_id, 'delete_userinfo', { pin }));
      }
      await app.save((d) => void (d.employees[pin] = { ...d.employees[pin], removed: `${today()} ${new Date().toTimeString().slice(0, 8)}` }));
      onRemoved();
      notify(`${who} dihapus dari mesin. Riwayat absennya tetap ada.`);
    } catch (e) {
      tell((e as Error).message, true);
    } finally {
      waiting();
    }
  }

  async function enroll(no: number) {
    const cloud_id = machine || on[0]?.cloud_id;
    if (!cloud_id) return tell('Belum ada mesin yang terhubung.', true);
    const label = what(no);
    try {
      const before = (await app.backups(pin)).find((b) => b.cloud_id === cloud_id)?.updated;
      waiting(`Menunggu mesin (±20 detik sampai 2 menit). Minta ${who} bersiap di depan mesin.`);
      ok(await app.command(cloud_id, 'reg_online', { pin, verification: no }));
      waiting(`Layar pendaftaran ${label.toLowerCase()} terbuka di mesin. ` + ({
        [CARD]: `Minta ${who} menempelkan kartunya di mesin.`,
        [PASSWORD]: `Minta ${who} mengetik password di mesin, lalu ikuti petunjuk di layar mesin.`,
      }[no] ?? 'Ikuti petunjuk di layar mesin.'));
      // mesin mengirim data user setelah pendaftaran berhasil; server menyimpannya sebagai cadangan
      for (const start = Date.now(); ; ) {
        await sleep(3000);
        const b = (await app.backups(pin)).find((x) => x.cloud_id === cloud_id);
        if (b && b.updated !== before) {
          const done = got(enrolled(b.body), no);
          await refreshCreds(pin);
          setFinger(null);
          tell(done ? `${label} ${who} terdaftar.` : `Data dari mesin masuk, tetapi ${label.toLowerCase()} belum tercatat. Coba lagi.`, !done);
          notify(done ? `${label} ${who} terdaftar di mesin.` : `Pendaftaran ${label.toLowerCase()} ${who} belum berhasil.`, !done);
          return;
        }
        if (Date.now() - start > 3 * 60_000) throw new Error('Belum ada data dari mesin. Bila pendaftaran dibatalkan atau gagal di mesin, coba lagi.');
      }
    } catch (e) {
      tell((e as Error).message, true);
    } finally {
      waiting();
    }
  }

  // selama menunggu mesin seluruh halaman terkunci (waiting); di sini cukup: tanpa mesin terhubung, tombol mati
  const off = !on.length;
  const jari = finger ?? (free < 0 ? 0 : free);
  return (
    <div id="y-laci-daftar" className="laci-isi">
      <div className="bidang">
        Terdaftar di mesin
        <p className="kred"><b>{credText(c) || 'Belum ada wajah, jari, kartu, atau password'}</b></p>
      </div>
      <Catatan note={off ? { text: 'Belum ada mesin yang terhubung. Lihat isian menu mesin di Hari ini.', error: true } : note} />
      {on.length > 1 && (
        <label className="bidang">
          Mesin
          <select value={machine || on[0].cloud_id} onChange={(e) => setMachine(e.target.value)}>
            {on.map((d) => <option key={d.cloud_id}>{d.cloud_id}</option>)}
          </select>
        </label>
      )}
      <h3>Di mesin</h3>
      <label className="bidang">
        Nama di mesin <input maxLength={15} value={name} autoComplete="off" disabled={off} onChange={(e) => setName(e.target.value)} />
        <small>Sisa {15 - name.length} huruf. Nama lengkap di aplikasi tidak ikut berubah.</small>
      </label>
      <label className="bidang centang">
        <input type="checkbox" className="saklar" checked={admin} disabled={off} onChange={(e) => setAdmin(e.target.checked)} /> Admin mesin
      </label>
      <p className="muted kecil">Admin bisa membuka menu mesin: menambah dan menghapus karyawan, mengubah pengaturan, dan menghapus data absen.
        Bila mesin tidak punya admin sama sekali, siapa pun bisa membuka menunya.</p>
      <div><button type="button" disabled={off} onClick={saveMachine}>Simpan ke mesin</button></div>
      <h3>Daftarkan</h3>
      <p className="muted">Minta {who} berdiri di depan mesin, lalu pilih yang didaftarkan. Layar pendaftaran terbuka sendiri di mesin ±20 detik
        sampai 2 menit kemudian. Kartu ditempelkan di mesin; password diketik sendiri di mesin, tidak lewat aplikasi.</p>
      <div className="tindakan">
        <button type="button" className="utama" disabled={off} onClick={() => enroll(FACE)}>{c.face ? 'Daftarkan ulang wajah' : 'Daftarkan wajah'}</button>
        <div className="baris-jari">
          <select aria-label="Jari" value={jari} disabled={off} onChange={(e) => setFinger(Number(e.target.value))}>
            {FINGERS.map((f, i) => (
              <option key={f} value={i}>{f}{c.fingers.includes(i) ? ' (sudah terdaftar)' : ''}</option>
            ))}
          </select>
          <button type="button" disabled={off} onClick={() => enroll(jari)}>Daftarkan jari</button>
        </div>
        <div className="baris-jari rata">
          <button type="button" disabled={off} onClick={() => enroll(CARD)}>{c.card ? 'Ganti kartu' : 'Daftarkan kartu'}</button>
          <button type="button" disabled={off} onClick={() => enroll(PASSWORD)}>{c.password ? 'Ganti password' : 'Atur password'}</button>
        </div>
      </div>
      <div className="hapus-karyawan">
        {sole && (
          <p className="catatan">{who} adalah admin terakhir di mesin. Bila dihapus, siapa pun bisa membuka menu mesin; jadikan orang lain admin dulu.</p>
        )}
        <div className="baris-jari">
          <input inputMode="numeric" autoComplete="off" placeholder={`Ketik PIN ${pin}`} aria-label={`Ketik PIN ${pin} untuk menghapus`}
            value={confirm} disabled={off} onChange={(e) => setConfirm(e.target.value)} />
          <button type="button" className="bahaya" disabled={off || confirm.trim() !== pin} onClick={remove}>Hapus dari mesin</button>
        </div>
        <p className="muted kecil">Orang ini tidak bisa absen lagi. Riwayat absennya tetap ada, dan cadangan jari/wajahnya tetap tersimpan di aplikasi,
          jadi bisa dipulihkan.</p>
      </div>
    </div>
  );
}
