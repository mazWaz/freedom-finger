// Semua menu aplikasi: hanya untuk user yang login (tanpa sesi -> /login). State bersama ada di
// components/aplikasi.tsx (data, mesin, event realtime) dan components/tugas.tsx (kerja di latar).
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppProvider, Siap } from '@/components/aplikasi';
import { Panduan } from '@/components/panduan';
import { Samping } from '@/components/samping';
import { JobsProvider } from '@/components/tugas';
import { UiProvider } from '@/components/ui';
import { currentUser } from '@/lib/server/session';

export default async function AplikasiLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <UiProvider>
      <AppProvider user={user}>
        <JobsProvider>
          <div className="aplikasi">
            <Samping />
            <main>
              <Siap>{children}</Siap>
            </main>
          </div>
          <Panduan />
        </JobsProvider>
      </AppProvider>
    </UiProvider>
  );
}
