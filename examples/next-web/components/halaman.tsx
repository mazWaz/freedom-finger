'use client';
// Halaman tabel dan kartu: "1–24 dari 57  ‹ 1 … 4 5 6 … 9 ›". Satu halaman saja = tidak tampil.
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Isi halaman `page` (mulai 1, dijaga di dalam batas) dari `list`, dan halaman yang dipakai. */
export function pageOf<T>(list: T[], page: number, size: number): [T[], number] {
  const n = Math.min(Math.max(page, 1), Math.max(1, Math.ceil(list.length / size)));
  return [list.slice((n - 1) * size, n * size), n];
}

type Props = { total: number; page: number; size: number; onPage: (n: number) => void; label: string; className?: string };

export function Halaman({ total, page, size, onPage, label, className = '' }: Props) {
  const last = Math.max(1, Math.ceil(total / size));
  if (last < 2) return null;
  const near = [...new Set([1, page - 1, page, page + 1, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  return (
    <nav className={`halaman ${className}`} aria-label={label}>
      <span>{(page - 1) * size + 1}–{Math.min(page * size, total)} dari {total}</span>
      <button type="button" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft />
      </button>
      {near.map((n, i) => [
        n - (near[i - 1] ?? n) > 1 && <span key={`${n}…`} aria-hidden="true">…</span>,
        <button key={n} type="button" aria-label={`Halaman ${n}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>
          {n}
        </button>,
      ])}
      <button type="button" aria-label="Halaman berikutnya" disabled={page >= last} onClick={() => onPage(page + 1)}>
        <ChevronRight />
      </button>
    </nav>
  );
}
