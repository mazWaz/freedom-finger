'use client';
// Pita jam scan: satu titik per scan di garis waktu hari ini. Scan pertama tiap orang = titik penuh
// (merah bila terlambat), scan berikutnya = titik kosong. Garis jam masuk/pulang dari semua jadwal yang
// berlaku hari ini (utama dan jadwal lain); jam yang tidak dipakai semua jadwal diberi nama jadwalnya.
// Selalu tampil (juga sebelum ada scan), supaya letaknya di halaman tidak berpindah-pindah.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '@/components/aplikasi';
import { colorOf } from '@/lib/data';
import { hhmm } from '@/lib/format';
import { minutes, weekday } from '@/lib/rekap';

/** Garis putus-putus, bergantian warna tiap jadwal yang memakai jam itu (satu jadwal = satu warna). */
const dashes = (colors: string[]) =>
  `repeating-linear-gradient(to bottom, ${colors.map((c, i) => `${c} ${i * 7}px ${i * 7 + 4}px, transparent ${i * 7 + 4}px ${(i + 1) * 7}px`).join(', ')})`;
/** Bidang toleransi terlambat, dibagi rata atas-bawah bila jam masuknya dipakai beberapa jadwal. */
const bands = (colors: string[]) =>
  `linear-gradient(to bottom, ${colors.map((c, i) => `color-mix(in srgb, ${c} 14%, transparent) ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`;

type Props = { scans: Map<string, number[]>; day: string; late: Set<string>; now: number };

export function Pita({ scans, day, late, now }: Props) {
  const { data, nameOf } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const measure = () => setWidth(ref.current?.clientWidth || 700);
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, []);

  const others = data.schedules.length > 0;
  const shifts = data.holidays.some((h) => h.date === day) ? [] : [{ ...data.schedule, name: 'Utama' }, ...data.schedules]
    // warna jadwal hanya bila ada jadwal lain; satu jadwal saja = hijau seperti biasa
    .flatMap((s) => {
      const d = s.days[weekday(day)];
      return d?.start ? [{ name: s.name, color: others ? colorOf(s) : 'var(--hijau)', start: d.start, end: d.end }] : [];
    });
  const starts = [...new Set(shifts.map((s) => s.start))];
  const all = [...scans.values()].flat();
  const from = Math.floor(Math.min(6 * 60, ...all, ...starts.map((t) => minutes(t) - 60)) / 60) * 60;
  const to = Math.ceil(Math.max(20 * 60, ...all, now, ...shifts.map((s) => minutes(s.end) + 60)) / 60) * 60;
  const x = (m: number) => `${(((m - from) / (to - from)) * 100).toFixed(2)}%`;

  // satu garis per jam masuk/pulang; label yang saling menimpa ditumpuk ke atas, dekat tepi kanan dibalik ke kiri
  const lines = (['start', 'end'] as const).flatMap((key) => [...new Set(shifts.map((s) => s[key]))].map((t) => {
    const used = shifts.filter((s) => s[key] === t);
    const names = used.map((s) => s.name);
    return {
      m: minutes(t),
      colors: used.map((s) => s.color),
      dots: others ? used.map((s) => s.color) : [], // titik warna jadwal, sama dengan tanda jadwal di kartu
      text: `${key === 'start' ? 'Masuk' : 'Pulang'} ${t}${names.length < shifts.length ? ` (${names.join(', ')})` : ''}`,
      flip: false,
      row: 0,
    };
  })).sort((a, b) => a.m - b.m);
  const labelEnds: number[] = [];
  for (const l of lines) {
    const at = (l.m - from) / (to - from);
    const w = (l.text.length * 6.6 + l.dots.length * 10 + 10) / width; // perkiraan lebar label
    l.flip = at + w > 1;
    const [a, b] = l.flip ? [at - w, at] : [at, at + w];
    l.row = labelEnds.findIndex((end) => end < a);
    if (l.row < 0) l.row = labelEnds.length;
    labelEnds[l.row] = b;
  }

  // titik yang berdekatan ditumpuk ke atas supaya tidak saling menutupi
  const dots = [...scans].flatMap(([pin, ms]) => ms.map((m, i) => ({ pin, m, first: i === 0, row: 0 }))).sort((a, b) => a.m - b.m);
  const lastInRow: number[] = [];
  const gap = (to - from) * 0.012;
  for (const d of dots) {
    d.row = lastInRow.findIndex((m) => d.m - m >= gap);
    if (d.row < 0) d.row = lastInRow.length;
    lastInRow[d.row] = d.m;
  }
  const hours = [];
  for (let h = from; h <= to; h += 120) hours.push(h);

  return (
    <div
      id="pita"
      ref={ref}
      className={`pita${hover ? ' sorot' : ''}`}
      aria-hidden="true"
      style={{ marginTop: 34 + Math.max(labelEnds.length - 1, 0) * 15, height: Math.max(lastInRow.length, 1) * 13 + 8 }}
      // titik: sorot semua scan orang yang sama (masuk dan pulangnya), sisanya meredup
      onMouseOver={(e) => setHover((e.target as HTMLElement).closest<HTMLElement>('.titik')?.dataset.pin ?? null)}
      onMouseLeave={() => setHover(null)}
    >
      {starts.map((t) => (
        <div key={`t${t}`} className="toleransi"
          style={{ left: x(minutes(t)), width: x(from + data.schedule.tolerance), background: bands(shifts.filter((s) => s.start === t).map((s) => s.color)) }} />
      ))}
      {lines.map((l) => (
        <div key={l.text} className={`garis${l.flip ? ' balik' : ''}`}
          style={{ left: x(l.m), top: -22 - l.row * 15, '--c': l.colors.length === 1 ? l.colors[0] : 'var(--redup)', background: dashes(l.colors) } as CSSProperties}>
          <span>
            {l.dots.map((c, i) => <i key={i} style={{ '--warna': c } as CSSProperties} />)}
            {l.text}
          </span>
        </div>
      ))}
      {now >= from && now <= to && <div className="sekarang" style={{ left: x(now) }} title={`Sekarang ${hhmm(now)}`} />}
      {dots.map((d, i) => {
        const at = (d.m - from) / (to - from); // label dekat tepi: rata ke dalam supaya tidak terpotong
        const cls = ['titik', d.first ? (late.has(d.pin) ? 'telat' : '') : 'lagi', at < 0.12 ? 'kiri' : at > 0.82 ? 'kanan' : '', d.pin === hover ? 'ini' : ''];
        return (
          <div key={`${d.pin} ${d.m} ${i}`} className={cls.filter(Boolean).join(' ')} style={{ left: x(d.m), bottom: d.row * 13 + 4 }} data-pin={d.pin}
            data-tip={`${nameOf(d.pin)}, ${hhmm(d.m)}${d.first && late.has(d.pin) ? ' (terlambat)' : ''}`} />
        );
      })}
      {hours.map((h) => (
        <span key={h} className="jam" style={{ left: x(h) }}>{hhmm(h)}</span>
      ))}
    </div>
  );
}
