'use client';
// Isian yang disimpan saat selesai diubah (keluar dari kotak atau Enter), bukan tiap huruf: seperti
// event `change` bawaan browser. Nilai baru dari luar (mis. pengguna lain menyimpan) tampil selama
// kotaknya tidak sedang diketik.
import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onCommit: (value: string) => void };

export function Isian({ value, onCommit, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null); // null = tidak sedang diubah
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      {...props}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}
