'use client';
// Form izin (izin, sakit, cuti, dinas luar) dan koreksi absen di laci. Keduanya hanya disimpan di
// aplikasi.json; log mesin tidak pernah diubah, supaya data asli mesin tetap utuh sebagai bukti.
// Dibuka dari menu Izin & koreksi, kartu karyawan di Hari ini, rincian Rekap, dan sel Riwayat, sudah terisi nama
// dan tanggal: `const catatan = useCatatan()`, lalu `catatan.open(...)` dan `{catatan.laci}`.
import { useState, type FormEvent } from 'react';
import { byPin } from '@/lib/data';
import { LABEL, dmy, period, today } from '@/lib/format';
import { LEAVE_KINDS } from '@/lib/rekap';
import type { Correction, Leave, LeaveKind } from '@/lib/types';
import { useApp, type App } from './aplikasi';
import { Laci } from './laci';
import { PilihTanggal } from './tanggal';
import { useUi } from './ui';

export type Kind = 'leaves' | 'corrections';
type Draft = Partial<Leave & Correction>;
type Open = { list: Kind; preset: Draft; id: string | null };

const TITLE = { leaves: ['Catat izin', 'Ubah catatan izin'], corrections: ['Koreksi absen', 'Ubah koreksi absen'] };

/** Kalimat pendek untuk pesan dan tombol: "Sakit Budi 01-09-2026 s.d. 02-09-2026". */
export const describe = (app: App, list: Kind, v: Draft) =>
  list === 'leaves' ? `${LABEL[v.kind!]} ${app.nameOf(v.pin!)} ${period(v.from!, v.to!)}` : `koreksi ${app.nameOf(v.pin!)} ${dmy(v.date!)} ${v.time}`;

/** Isian form -> catatan, atau pesan kesalahan. */
function read(app: App, list: Kind, v: Draft, id: string): Leave | Correction | string {
  if (!v.pin) return 'Pilih karyawan.';
  if (list === 'leaves') {
    if (!v.from) return 'Pilih tanggal mulai.';
    const l: Leave = { id, pin: v.pin, kind: v.kind ?? 'izin', from: v.from, to: v.to || v.from, note: (v.note ?? '').trim() };
    if (l.to < l.from) return 'Tanggal sampai tidak boleh sebelum tanggal mulai.';
    // recap() memakai catatan pertama yang cocok: jangan ada dua catatan di hari yang sama
    const clash = app.data.leaves.find((x) => x.id !== id && x.pin === l.pin && x.from <= l.to && l.from <= x.to);
    if (clash) return `${app.nameOf(l.pin)} sudah punya catatan ${LABEL[clash.kind]} ${period(clash.from, clash.to)}. Ubah catatan itu saja.`;
    return l;
  }
  if (!v.date) return 'Pilih tanggal koreksi.';
  const c: Correction = { id, pin: v.pin, date: v.date, time: (v.time ?? '').slice(0, 5), reason: (v.reason ?? '').trim() };
  if (!c.reason) return 'Alasan koreksi wajib diisi.';
  if (c.date > today()) return 'Koreksi hanya untuk hari ini atau tanggal yang sudah lewat.';
  if (app.data.corrections.some((x) => x.id !== id && x.pin === c.pin && x.date === c.date && x.time === c.time)) return 'Koreksi yang sama sudah ada.';
  return c;
}

export function useCatatan() {
  const app = useApp();
  const [form, setForm] = useState<Open | null>(null);
  /** Buka form; `preset` mengisi kolom (mis. `{pin, from}`), `id` = ubah catatan yang sudah ada. */
  const open = (list: Kind, preset: Draft = {}, id: string | null = null) => setForm({ list, preset, id });
  const close = () => setForm(null);
  const v = form && (form.id ? (app.data[form.list] as Draft[]).find((x) => x.id === form.id) : form.preset);
  const laci = (
    <Laci open={!!form} title={form ? TITLE[form.list][form.id ? 1 : 0] : ''} sub={v?.pin ? app.nameOf(v.pin) : ''} onClose={close}>
      {form && <FormCatatan list={form.list} start={v ?? {}} id={form.id} onDone={close} />}
    </Laci>
  );
  return { open, laci };
}

function FormCatatan({ list, start, id, onDone }: { list: Kind; start: Draft; id: string | null; onDone: () => void }) {
  const app = useApp();
  const { notify } = useUi();
  const [v, setV] = useState<Draft>(start);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  // juga PIN yang punya catatan tetapi sudah tidak ada di mesin, supaya tetap bisa diubah
  const pins = [...new Set([...app.knownPins(), ...app.data.leaves.map((l) => l.pin), ...app.data.corrections.map((c) => c.pin)])].sort(byPin);
  // fokus ke kolom pertama yang belum terisi; izin yang nama dan tanggalnya sudah ada: pilih jenisnya
  const first = !v.pin ? 'pin' : list === 'leaves' ? (!v.from ? 'from' : 'kind') : (['date', 'time', 'reason'] as const).find((k) => !v[k]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = read(app, list, v, id ?? Date.now().toString(36));
    if (typeof r === 'string') return notify(r, true);
    setBusy(true);
    try {
      await app.save((d) => void ((d[list] as (Leave | Correction)[]) = [...(d[list] as (Leave | Correction)[]).filter((x) => x.id !== r.id), r]));
    } catch {
      return setBusy(false); // pesan gagal sudah tampil; isian form tetap ada
    }
    onDone();
    notify(`Tersimpan: ${describe(app, list, r)}.`);
  }

  return (
    <form className="laci-isi" onSubmit={submit}>
      <label className="bidang">
        Karyawan
        <select value={v.pin ?? ''} onChange={set('pin')} required data-autofocus={first === 'pin' || undefined}>
          <option value="">Pilih karyawan</option>
          {pins.map((pin) => (
            <option key={pin} value={pin}>
              {app.nameOf(pin)}
              {app.nameOf(pin) === `PIN ${pin}` ? '' : ` · PIN ${pin}`}
            </option>
          ))}
        </select>
      </label>
      {list === 'leaves' ? (
        <>
          <fieldset className="bidang">
            <legend>Jenis</legend>
            <div className="pilihan">
              {LEAVE_KINDS.map((k) => (
                <label key={k}>
                  <input type="radio" name="kind" value={k} checked={(v.kind ?? 'izin') === k} onChange={() => setV((x) => ({ ...x, kind: k as LeaveKind }))}
                    data-autofocus={(first === 'kind' && (v.kind ?? 'izin') === k) || undefined} />{' '}
                  {LABEL[k]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="baris">
            <div className="bidang">
              Dari tanggal
              <PilihTanggal value={v.from ?? ''} onChange={(from) => setV((x) => ({ ...x, from }))} required label="Dari tanggal" autoFocus={first === 'from'} />
            </div>
            <div className="bidang">
              Sampai tanggal
              <PilihTanggal value={v.to ?? ''} onChange={(to) => setV((x) => ({ ...x, to }))} label="Sampai tanggal" />
              <small>Kosongkan untuk satu hari</small>
            </div>
          </div>
          <label className="bidang">
            Keterangan
            <input value={v.note ?? ''} onChange={set('note')} placeholder="Mis. surat dokter, acara keluarga" />
          </label>
          <p className="muted kecil">Hari kerja dengan catatan ini tidak dihitung alpa, walau ada scan.</p>
        </>
      ) : (
        <>
          <div className="baris">
            <div className="bidang">
              Tanggal
              <PilihTanggal value={v.date ?? ''} onChange={(date) => setV((x) => ({ ...x, date }))} required label="Tanggal" autoFocus={first === 'date'} />
            </div>
            <label className="bidang">
              Jam
              <input type="time" value={v.time ?? ''} onChange={set('time')} required data-autofocus={first === 'time' || undefined} />
            </label>
          </div>
          <label className="bidang">
            Alasan
            <input value={v.reason ?? ''} onChange={set('reason')} required placeholder="Mis. lupa absen pulang" data-autofocus={first === 'reason' || undefined} />
          </label>
          <p className="muted kecil">Dihitung di Rekap seperti scan biasa, dan tampil bertanda &quot;manual&quot; di Riwayat. Log di mesin tidak diubah.</p>
        </>
      )}
      <div className="laci-kaki">
        <button type="button" onClick={onDone}>Batal</button>
        <button className="utama" disabled={busy} data-autofocus={!first || undefined}>{id ? 'Simpan perubahan' : 'Simpan'}</button>
      </div>
    </form>
  );
}
