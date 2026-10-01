'use client';
// Sidebar: nama aplikasi, jumlah mesin terhubung (terlihat dari semua menu), nama kantor, menu, dan keluar.
import {
  CalendarCheck, CalendarX, Clock, FilePenLine, FingerprintPattern, History, LogOut, Settings, Sheet, Users, type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/lib/server/actions';
import { useApp } from './aplikasi';

const MENU: [string, [string, string, LucideIcon][]][] = [
  ['Absensi', [
    ['/hari-ini', 'Hari ini', CalendarCheck],
    ['/riwayat', 'Riwayat', History],
    ['/rekap', 'Rekap', Sheet],
    ['/izin', 'Izin & koreksi', FilePenLine],
  ]],
  ['Kelola', [
    ['/karyawan', 'Karyawan', Users],
    ['/jam-kerja', 'Jam kerja', Clock],
    ['/libur', 'Hari libur', CalendarX],
    ['/mesin', 'Mesin', FingerprintPattern],
  ]],
  ['Sistem', [['/pengaturan', 'Pengaturan', Settings]]],
];

export function Samping() {
  const { devices, data, user } = useApp();
  const path = usePathname();
  const on = devices.filter((d) => d.connected).length;
  return (
    <aside className="samping">
      <div className="merek">
        <Image src="/logo.png" alt="" width={30} height={30} />
        <div>
          <b>Freedom Finger</b>
          <span id="status-samping" role="status" className={!devices.length ? 'redup' : on === devices.length ? 'ok' : 'off'}>
            {devices.length ? `${on}/${devices.length} mesin terhubung` : 'Belum ada mesin'}
          </span>
          <span>{data.office}</span>
        </div>
      </div>
      <nav aria-label="Menu">
        {MENU.map(([group, items]) => [
          <p key={group} className="kelompok">{group}</p>,
          ...items.map(([href, label, Icon]) => (
            <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>
              <Icon />
              {label}
            </Link>
          )),
        ])}
      </nav>
      <form className="kaki" action={signOut}>
        <button title="Keluar dari aplikasi">
          <LogOut />
          Keluar <span className="redup">{user}</span>
        </button>
      </form>
    </aside>
  );
}
