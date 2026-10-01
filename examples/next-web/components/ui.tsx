'use client';
// Lapisan di atas semua halaman: pesan singkat (toast), dialog tanya ya/tidak, dan layar tunggu selama
// menunggu mesin. Dipakai lewat `useUi()`; laci (modal) per halaman ada di laci.tsx.
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pad } from '@/lib/format';
import { Mesin } from './ikon';

type AskOptions = { title?: string; okLabel?: string; cancelLabel?: string };
type Ui = {
  /** Pesan singkat di pojok kanan bawah; pesan gagal tampil lebih lama. */
  notify: (text: string, error?: boolean) => void;
  /** Pertanyaan ya/tidak; `true` bila tombol utama ditekan, Esc = batal. */
  ask: (message: string, options?: AskOptions) => Promise<boolean>;
  /** Layar tunggu (seluruh halaman terkunci, Esc tidak menutup) dengan teks ini; tanpa teks: tutup. */
  waiting: (text?: string) => void;
};

const UiContext = createContext<Ui | null>(null);

export function useUi() {
  const ui = use(UiContext);
  if (!ui) throw new Error('useUi di luar UiProvider');
  return ui;
}

/** `<dialog>` modal yang terbuka selama `open`. */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return ref;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(hideTimer.current);
    // pesan gagal tampil lebih lama agar sempat dibaca, tapi tetap hilang sendiri
    hideTimer.current = setTimeout(() => setToast(null), error ? 20_000 : 8000);
  }, []);

  const [question, setQuestion] = useState<(AskOptions & { message: string }) | null>(null);
  const answer = useRef<(yes: boolean) => void>(undefined);
  const ask = useCallback((message: string, options: AskOptions = {}) => {
    setQuestion({ message, ...options });
    return new Promise<boolean>((ok) => (answer.current = ok));
  }, []);
  const askRef = useModal(!!question);

  const [wait, setWait] = useState<{ text: string; start: number } | null>(null);
  const waiting = useCallback((text?: string) => setWait((w) => (text ? { text, start: w?.start ?? Date.now() } : null)), []);
  const waitRef = useModal(!!wait);
  const [now, setNow] = useState(0);
  const isWaiting = !!wait;
  useEffect(() => {
    if (!isWaiting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    // Esc selama menunggu: diabaikan. Membatalkan `cancel` saja tidak cukup: Chromium menutup paksa pada
    // Esc kedua, dan ikut menutup laci di bawahnya
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && e.preventDefault();
    addEventListener('keydown', esc, true);
    return () => {
      clearInterval(timer);
      removeEventListener('keydown', esc, true);
    };
  }, [isWaiting]);

  const ui = useMemo(() => ({ notify, ask, waiting }), [notify, ask, waiting]);
  const waited = wait ? Math.max(0, Math.floor((now - wait.start) / 1000)) : 0;
  return (
    <UiContext value={ui}>
      {children}
      <dialog ref={waitRef} className="tunggu" aria-labelledby="tunggu-teks" onCancel={(e) => e.preventDefault()}>
        <div className="putar" aria-hidden="true">
          <Mesin />
        </div>
        <p id="tunggu-teks" role="status">{wait?.text}</p>
        <p id="tunggu-lama" className="muted kecil">Sudah menunggu {Math.floor(waited / 60)}:{pad(waited % 60)}</p>
      </dialog>
      <dialog
        ref={askRef}
        className="laci tanya"
        aria-labelledby="tanya-judul"
        onClose={(e) => {
          answer.current?.(e.currentTarget.returnValue === 'ya');
          e.currentTarget.returnValue = '';
          setQuestion(null);
        }}
      >
        <header className="laci-kepala">
          <div>
            <h2 id="tanya-judul">{question?.title ?? 'Konfirmasi'}</h2>
          </div>
        </header>
        <form method="dialog" className="laci-isi">
          <p>{question?.message}</p>
          <div className="laci-kaki">
            {/* tombol pertama mendapat fokus: Enter tanpa sengaja tidak menjalankan tindakan seperti Hapus */}
            <button value="">{question?.cancelLabel ?? 'Batal'}</button>
            <button value="ya" className="utama">{question?.okLabel ?? 'Ya'}</button>
          </div>
        </form>
      </dialog>
      {toast && (
        <p id="pesan" role="status" className={toast.error ? 'off' : 'ok'} title="Klik untuk menutup" onClick={() => setToast(null)}>
          {toast.text}
        </p>
      )}
    </UiContext>
  );
}
