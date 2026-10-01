'use client';
// Laci: modal di tengah layar (`<dialog>`: fokus terkunci di dalam, Esc dan klik di luar menutup) untuk
// form dan rincian. Isinya (`.laci-isi`) hanya dipasang selama terbuka, jadi isian mulai bersih tiap dibuka;
// fokus awal ke isian bertanda `data-autofocus`.
import { useEffect, useId, useRef, type ReactNode } from 'react';

type Props = { open: boolean; title: string; sub?: string; onClose: () => void; children: ReactNode };

export function Laci({ open, title, sub, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(); // beberapa laci bisa ada di satu halaman
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) {
      d.showModal();
      // isian bertanda data-autofocus, atau yang pertama; bukan tombol tutup di kepala laci
      (d.querySelector<HTMLElement>('[data-autofocus]') ?? d.querySelector<HTMLElement>('.laci-isi :is(input, select, button):not(:disabled)'))?.focus();
    }
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="laci"
      aria-labelledby={titleId}
      onClose={onClose}
      // klik di luar panel (backdrop) = klik pada dialog itu sendiri
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <header className="laci-kepala">
        <div>
          <h2 id={titleId}>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Tutup panel">
          &times;
        </button>
      </header>
      {open && children}
    </dialog>
  );
}
