'use client';
// Papan absen hari ini: ringkasan, cari, saring, dan satu kartu per karyawan, bertinta seperti kartu jam
// kerja (hijau tepat waktu, merah terlambat, biru izin, garis putus-putus belum datang). Klik = rincian.
import { useState, type ReactNode } from 'react';
import { useApp } from '@/components/aplikasi';
import { Halaman, pageOf } from '@/components/halaman';
import { LABEL, hhmm } from '@/lib/format';
import type { Holiday } from '@/lib/types';
import { JadwalTag, KIND, ORDER, lateBy, out, type Kind, type Person } from './orang';

const PER_PAGE = 24;

type Props = {
  people: Person[] | null; // null = belum dimuat
  holiday?: Holiday;
  /** PIN yang baru scan: kartunya disorot sebentar; `n` naik tiap pemuatan supaya sorotannya diulang. */
  fresh: { pins: Set<string>; n: number };
  onOpen: (pin: string) => void;
};

export function Papan({ people, holiday, fresh, onOpen }: Props) {
  const app = useApp();
  const [filter, setFilter] = useState<'semua' | Kind>('semua');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const list = people ?? [];
  const count = (k: Kind) => list.filter((p) => p.kind === k).length;
  const shown = filter !== 'semua' && !count(filter) ? 'semua' : filter;
  const q = search.trim().toLowerCase();
  const found = list
    .filter((p) => (shown === 'semua' || p.kind === shown) && (!q || p.pin.includes(q) || app.nameOf(p.pin).toLowerCase().includes(q)))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || app.nameOf(a.pin).localeCompare(app.nameOf(b.pin), 'id'));
  const [cards, n] = pageOf(found, page, PER_PAGE);

  const expected = list.filter((p) => p.shift).length;
  const came = list.filter((p) => p.shift && p.scans.length).length;
  const summary: ReactNode = expected ? (
    <><b>{came}</b> dari {expected} karyawan sudah datang.</>
  ) : (
    `${holiday ? `Hari ini libur${holiday.note ? `: ${holiday.note}` : ''}.` : 'Hari ini bukan hari kerja.'}${list.length ? ` ${list.length} orang tetap absen.` : ''}`
  );
  const pick = (k: 'semua' | Kind) => {
    setFilter(k);
    setPage(1);
  };

  return (
    <>
      <div className="judul-baris">
        <p id="ringkasan" className="ringkasan" hidden={!people}>{summary}</p>
        <input type="search" id="papan-cari" placeholder="Cari nama atau PIN" aria-label="Cari karyawan hari ini" hidden={!list.length}
          value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
      </div>
      <div id="saring" className="saring" role="group" aria-label="Tampilkan karyawan" hidden={!list.length}>
        <button aria-pressed={shown === 'semua'} onClick={() => pick('semua')}>Semua <b>{list.length}</b></button>
        {ORDER.filter(count).map((k) => (
          <button key={k} className={k} aria-pressed={shown === k} onClick={() => pick(k)}>
            <i />
            {KIND[k]} <b>{count(k)}</b>
          </button>
        ))}
      </div>
      <div id="papan" className="papan" aria-live="polite">
        {cards.map((p) => (
          <Kartu key={fresh.pins.has(p.pin) ? `${p.pin}:${fresh.n}` : p.pin} p={p} fresh={fresh.pins.has(p.pin)} onOpen={onOpen} />
        ))}
        {!cards.length && (q && list.length ? (
          <p className="kosong">Tidak ada karyawan yang cocok dengan &quot;{search.trim()}&quot;.</p>
        ) : !people || app.knownPins().length ? null : (
          <p className="kosong">Belum ada data karyawan. Ambil dari mesin di tab Karyawan.</p>
        ))}
      </div>
      <Halaman total={found.length} page={n} size={PER_PAGE} onPage={setPage} label="Halaman kartu karyawan" />
    </>
  );
}

function Kartu({ p, fresh, onOpen }: { p: Person; fresh: boolean; onOpen: (pin: string) => void }) {
  const app = useApp();
  const first = p.scans[0];
  const home = out(p, app.data.schedule.minGap);
  const free = !!p.shift?.free;
  const [jam, status] = {
    telat: () => [hhmm(first.m), `terlambat ${lateBy(p)} mnt`],
    tepat: () => [hhmm(first.m), free ? 'jam bebas' : 'tepat waktu'],
    luar: () => [hhmm(first.m), 'di luar jadwal'],
    izin: () => [LABEL[p.leave!.kind], ''],
    belum: () => ['belum datang', ''],
  }[p.kind]();
  const ket = [
    home && `pulang ${hhmm(home.m)}`,
    first?.manual && 'koreksi manual',
    p.kind === 'izin' && p.leave!.note,
    p.kind === 'belum' && (free ? 'jam bebas' : `jadwal masuk ${p.shift?.start}`),
  ].filter(Boolean).join(', ');
  const about = [jam, status, ket, app.data.schedules.length && `jadwal ${app.scheduleName(p.pin)}`].filter(Boolean).join(', ');
  return (
    <button className={`kartu ${p.kind}${fresh ? ' baru' : ''}`} aria-label={`${app.nameOf(p.pin)}: ${about}. Buka rincian`} onClick={() => onOpen(p.pin)}>
      <span className="nama-baris">
        <span className="nama">{app.nameOf(p.pin)}</span>
        <JadwalTag app={app} pin={p.pin} />
      </span>
      <span className="jam">
        {jam}
        {status && <span className="status">{status}</span>}
      </span>
      {ket && <span className="ket">{ket}</span>}
    </button>
  );
}
