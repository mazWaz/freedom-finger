// Kerangka HTML semua halaman: huruf dan gaya. Login di app/login, aplikasi di app/(aplikasi).
import '@fontsource-variable/plus-jakarta-sans';
import '@/styles/base.css';
import '@/styles/hari-ini.css';
import '@/styles/dialog.css';
import '@/styles/halaman.css';
import '@/styles/masuk.css';
import '@/styles/cetak.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Freedom Finger' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
