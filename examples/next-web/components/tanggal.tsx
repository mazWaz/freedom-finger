'use client';
// Pemilih tanggal dan rentang tanggal: tampil "1 Januari 2026" dengan kalender berbahasa Indonesia, apa
// pun bahasa OS-nya (tampilan <input type="date"> bawaan mengikuti OS). Nilainya tetap "YYYY-MM-DD".
// Rentang punya rentang cepat (1 minggu, 1 bulan, …): klik tanggal awal, lalu tanggal akhir.
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { longDate, monthName, ranges, today } from '@/lib/format';
import { addDays, addMonths, weekday } from '@/lib/rekap';

const HEAD = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** `autoFocus`: diberi fokus saat laci dibuka (components/laci.tsx). */
type Props = { label?: string; className?: string; autoFocus?: boolean };

/** Satu tanggal; kosong = belum dipilih (`required`: tanpa tombol Kosongkan). */
export function PilihTanggal({ value, onChange, required, ...p }: Props & { value: string; onChange: (v: string) => void; required?: boolean }) {
  return <Kalender values={[value]} onPick={(v) => onChange(v)} required={required} {...p} />;
}

/** Rentang tanggal `from`–`to` (inklusif). */
export function PilihRentang({ from, to, onChange, ...p }: Props & { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return <Kalender values={[from, to]} onPick={(a, b) => onChange(a, b ?? a)} {...p} />;
}

type KalenderProps = Props & { values: string[]; onPick: (a: string, b?: string) => void; required?: boolean };

function Kalender({ values, onPick, required, label, className, autoFocus }: KalenderProps) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const range = values.length > 1;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(''); // "YYYY-MM" yang tampil
  const [start, setStart] = useState<string | null>(null); // awal rentang yang baru diklik
  const [focus, setFocus] = useState<string | null>(null); // hari yang diberi fokus (panah)
  const focusNext = useRef<string | null>(null); // selector yang diberi fokus sesudah digambar

  const [va, vb = va] = values;
  const text = !va ? (range ? 'Pilih rentang tanggal' : 'Pilih tanggal') : !range || va === vb ? longDate(va) : `${longDate(va)} – ${longDate(vb)}`;

  useLayoutEffect(() => {
    if (!focusNext.current) return;
    pop.current?.querySelector<HTMLElement>(focusNext.current)?.focus();
    focusNext.current = null;
  });

  function opened() {
    setOpen(true);
    const r = btn.current!.getBoundingClientRect();
    const p = pop.current!;
    const { width, height } = p.getBoundingClientRect();
    p.style.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`;
    p.style.top = `${r.bottom + 4 + height > innerHeight - 8 ? Math.max(8, r.top - 4 - height) : r.bottom + 4}px`;
    focusNext.current = '.hari [tabindex="0"]';
    p.querySelector<HTMLElement>(focusNext.current)?.focus();
  }

  function set(a: string, b?: string) {
    pop.current?.hidePopover();
    btn.current?.focus();
    onPick(a, b);
  }

  function pickDay(d: string) {
    if (!range) return set(d);
    if (!start) {
      setStart(d);
      setFocus(d);
      setMonth(d.slice(0, 7));
      return;
    }
    const [a, b] = [start, d].sort();
    set(a, b);
  }

  /** Panah: pindah hari (atas/bawah = seminggu), ganti bulan bila perlu. */
  function keys(e: KeyboardEvent) {
    const d = (e.target as HTMLElement).closest<HTMLElement>('.hari [data-d]')?.dataset.d;
    if (!d || !(e.key in STEP)) return;
    e.preventDefault();
    const next = addDays(d, STEP[e.key]);
    setFocus(next);
    setMonth(next.slice(0, 7));
    focusNext.current = `[data-d="${next}"]`;
  }

  const t = today();
  const [a, b = a] = start ? [start] : values;
  const first = `${month || t.slice(0, 7)}-01`;
  const roving = [focus, start, a, t].find((d) => d?.startsWith(month)) ?? first; // satu-satunya hari yang kena Tab
  const days = [];
  for (let i = 0, d = addDays(first, -((weekday(first) + 6) % 7)); i < 42; i++, d = addDays(d, 1)) days.push(d);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`pilih-tanggal ${className ?? ''}`}
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? `${label}: ${text}` : undefined}
        data-autofocus={autoFocus || undefined}
      >
        <Calendar />
        <span>{text}</span>
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        className="kalender"
        role="dialog"
        aria-label="Kalender"
        onKeyDown={keys}
        onBeforeToggle={(e) => {
          if (e.newState !== 'open') return;
          setMonth((values[0] || t).slice(0, 7));
          setStart(null);
          setFocus(null);
        }}
        onToggle={(e) => (e.newState === 'open' ? opened() : setOpen(false))}
      >
        {range && (
          <div className="preset">
            {Object.entries(ranges()).map(([name, [f, s]]) => (
              <button key={name} type="button" aria-pressed={f === va && s === vb} onClick={() => set(f, s)}>
                {name}
              </button>
            ))}
          </div>
        )}
        <div className="bulan">
          <header>
            <button type="button" aria-label="Bulan sebelumnya" onClick={() => setMonth(addMonths(first, -1).slice(0, 7))}>
              <ChevronLeft />
            </button>
            <b aria-live="polite">{monthName(first)}</b>
            <button type="button" aria-label="Bulan berikutnya" onClick={() => setMonth(addMonths(first, 1).slice(0, 7))}>
              <ChevronRight />
            </button>
          </header>
          <div className="hari">
            {HEAD.map((h) => (
              <span key={h} aria-hidden="true">{h}</span>
            ))}
            {days.map((d) => {
              const ends = d === a || d === b;
              const cls = [d.startsWith(month) ? '' : 'lain', d === t ? 'ini' : '', ends ? 'pilih' : a < d && d < b ? 'antara' : ''];
              return (
                <button
                  key={d}
                  type="button"
                  data-d={d}
                  className={cls.join(' ').trim() || undefined}
                  tabIndex={d === roving ? 0 : -1}
                  aria-label={longDate(d)}
                  aria-pressed={ends || undefined}
                  aria-current={d === t ? 'date' : undefined}
                  onClick={() => pickDay(d)}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
          {range ? (
            <p className="petunjuk">{start ? `Mulai ${longDate(start)}. Pilih tanggal akhir.` : 'Klik tanggal awal, lalu tanggal akhir.'}</p>
          ) : (
            <div className="bawah">
              <button type="button" onClick={() => set(t)}>Hari ini</button>
              {!required && <button type="button" onClick={() => set('')}>Kosongkan</button>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
