'use client';
// State bersama semua menu: data aplikasi (aplikasi.json), mesin, user di mesin, scan pertama tiap PIN,
// dan event realtime. Dimuat sekali saat aplikasi dibuka, lalu diperbarui tiap menit dan oleh event.
// Beberapa orang bisa membuka aplikasi bersamaan: simpan membawa `rev`, dan ditolak bila orang lain sudah
// menyimpan lebih dulu (lihat `save`).
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, backups, command, listen, logs, request, send } from '@/lib/api';
import { normalize, people, type People } from '@/lib/data';
import { today } from '@/lib/format';
import type { AppData, Device, LiveEvent, MachineUser } from '@/lib/types';
import { useUi } from './ui';

type Status = { server_ip?: string; port?: number };

export type App = People & {
  /** User web yang sedang login. */
  user: string;
  data: AppData;
  devices: Device[];
  users: MachineUser[];
  status: Status;
  /** Tanggal scan pertama tiap PIN sepanjang data; `null` sampai dimuat (rekap lalu tanpa tanggal mulai). */
  firstScans: Map<string, string> | null;
  /** Naik setiap ada absen baru: halaman yang menampilkan log mengambil ulang. */
  logsTick: number;
  /** Nilai terbaru untuk kerja di latar (interval, perintah yang lama) yang tidak boleh memakai nilai lama. */
  latest: { current: { data: AppData; devices: Device[]; users: MachineUser[] } };
  /**
   * Ubah data aplikasi (`change` menerima salinan yang boleh diubah), tampilkan, lalu simpan berurutan.
   * Gagal sudah ditampilkan di sini; yang menunggu (`await`) tetap menerima errornya untuk berhenti.
   */
  save: (change: (d: AppData) => void) => Promise<void>;
  loadUsers: () => Promise<void>;
  loadDevices: () => Promise<void>;
  /** Log absen semua mesin (atau satu). */
  logs: (from: string, to: string, cloudId?: string) => ReturnType<typeof logs>;
  backups: (pin: string) => ReturnType<typeof backups>;
  /** Perintah ke mesin, ditunggu sampai selesai (lib/api.ts command). */
  command: (cloudId: string, endpoint: string, body?: object) => ReturnType<typeof command>;
  /** Dengarkan event realtime; hasil: berhenti mendengarkan. */
  onEvent: (fn: (ev: LiveEvent) => void) => () => void;
  /** Panduan hubungkan mesin (components/panduan.tsx). */
  guide: boolean;
  setGuide: (open: boolean) => void;
};

const AppContext = createContext<App | null>(null);
const ReadyContext = createContext<{ ready: boolean; error: string }>({ ready: false, error: '' });

export function useApp() {
  const app = use(AppContext);
  if (!app) throw new Error('useApp di luar AppProvider');
  return app;
}

/** Event realtime selama komponen terpasang; `fn` boleh berganti tiap render. */
export function useLiveEvent(fn: (ev: LiveEvent) => void) {
  const { onEvent } = useApp();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onEvent((ev) => ref.current(ev)), [onEvent]);
}

/** Isi menu baru tampil setelah data pertama dimuat. */
export function Siap({ children }: { children: ReactNode }) {
  const { ready, error } = use(ReadyContext);
  if (error) return <p className="catatan off" style={{ margin: 32 }}>{error}</p>;
  return ready ? children : <p className="muted" style={{ margin: 32 }}>Memuat data…</p>;
}

export function AppProvider({ user, children }: { user: string; children: ReactNode }) {
  const { notify } = useUi();
  const [data, setData] = useState<AppData>(() => normalize(null));
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<MachineUser[]>([]);
  const [status, setStatus] = useState<Status>({});
  const [firstScans, setFirstScans] = useState<Map<string, string> | null>(null);
  const [logsTick, setLogsTick] = useState(0);
  const [ready, setReady] = useState({ ready: false, error: '' });
  const [guide, setGuide] = useState(false);
  const latest = useRef({ data, devices, users });
  const rev = useRef('');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const saving = useRef(0);
  const listeners = useRef(new Set<(ev: LiveEvent) => void>());

  const apply = useCallback((r: { rev: string; data: Partial<AppData> | null }) => {
    rev.current = r.rev;
    latest.current.data = normalize(r.data);
    setData(latest.current.data);
  }, []);

  const loadData = useCallback(async () => apply(await request('/api/data')), [apply]);

  const save = useCallback(
    (change: (d: AppData) => void) => {
      const next = structuredClone(latest.current.data);
      change(next);
      latest.current.data = next;
      setData(next);
      saving.current++;
      // berurutan: simpan berikutnya memakai rev dari simpan sebelumnya, bukan dianggap bentrok
      const p = queue.current.then(async () => {
        try {
          rev.current = (await request<{ rev: string }>('/api/data', 'PUT', { rev: rev.current, data: latest.current.data })).rev;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            await loadData().catch(() => {});
            notify('Data baru saja diubah pengguna lain, jadi perubahan Anda tidak tersimpan. Tampilan sudah diperbarui; ulangi perubahannya.', true);
          } else notify(`Gagal menyimpan: ${(e as Error).message}`, true);
          throw e;
        } finally {
          saving.current--;
        }
      });
      queue.current = p.catch(() => {});
      return p;
    },
    [loadData, notify],
  );

  const loadUsers = useCallback(async () => {
    const list: MachineUser[] = await api('get_users');
    if (JSON.stringify(list) === JSON.stringify(latest.current.users)) return;
    latest.current.users = list;
    setUsers(list);
  }, []);
  const loadDevices = useCallback(async () => {
    latest.current.devices = await api('get_devices');
    setDevices(latest.current.devices);
  }, []);
  const loadStatus = useCallback(async () => {
    const r = await send('/api/status'); // status.json: tanpa `success`
    const s = await r.json();
    if (!r.ok) throw new Error(s.message);
    setStatus(s);
  }, []);
  const allLogs = useCallback(
    (from: string, to: string, cloudId?: string) => logs(from, to, cloudId ? [cloudId] : latest.current.devices.map((d) => d.cloud_id)),
    [],
  );
  const loadFirstScans = useCallback(async () => {
    const first = new Map<string, string>();
    for (const l of await allLogs('2000-01-01', today())) {
      const d = l.scan_date.slice(0, 10);
      if (!(first.get(l.pin)! <= d)) first.set(l.pin, d);
    }
    setFirstScans(first);
  }, [allLogs]);

  useEffect(() => {
    const stop = new AbortController();
    (async () => {
      await loadData();
      // server Freedom Finger bisa sedang dimulai ulang: coba beberapa kali sebelum menyerah
      for (let i = 0; ; i++) {
        try {
          await loadStatus();
          await loadDevices();
          break;
        } catch (e) {
          if (i === 10) throw e;
          await new Promise((ok) => setTimeout(ok, 1000));
        }
      }
      await loadUsers();
      setReady({ ready: true, error: '' });
      if (!latest.current.devices.length) setGuide(true); // pemasangan baru (belum pernah ada mesin)
      loadFirstScans().catch(() => {}); // gagal: rekap tanpa tanggal mulai karyawan
      listen((ev) => {
        if (ev.type === 'attlog' && ev.data?.pin && ev.data.scan) {
          const { pin, scan } = ev.data;
          setFirstScans((m) => (m && !m.has(pin) ? new Map(m).set(pin, scan.slice(0, 10)) : m)); // orang yang baru pertama kali scan
        }
        if (ev.type === 'sync_attlog') loadFirstScans().catch(() => {}); // log lama yang baru ditarik
        if (ev.type === 'attlog' || ev.type === 'sync_attlog') setLogsTick((n) => n + 1);
        if (ev.type === 'get_userinfo') loadUsers().catch(() => {});
        for (const fn of listeners.current) fn(ev);
      }, stop.signal);
    })().catch((e: Error) => {
      const text = `Aplikasi gagal mulai: ${e.message}. Periksa apakah server Freedom Finger menyala dan FREEDOM_FINGER_URL di .env benar, lalu muat ulang halaman ini.`;
      setReady({ ready: false, error: text });
      notify(text, true);
    });
    // status mesin, karyawan baru dari mesin, dan data aplikasi yang diubah pengguna lain
    const timer = setInterval(async () => {
      await loadStatus().catch(() => {});
      await loadDevices().catch(() => {});
      await loadUsers().catch(() => {});
      if (saving.current) return; // simpan yang sedang berjalan menang; diambil lagi menit berikutnya
      const r = await request<{ rev: string; data: AppData }>('/api/data').catch(() => null);
      if (r && r.rev !== rev.current && !saving.current) apply(r);
    }, 60_000);
    return () => {
      stop.abort();
      clearInterval(timer);
    };
  }, [apply, loadData, loadDevices, loadFirstScans, loadStatus, loadUsers, notify]);

  const appBackups = useCallback((pin: string) => backups(pin, latest.current.devices), []);
  const appCommand = useCallback(
    (cloudId: string, endpoint: string, body: object = {}) =>
      command(cloudId, endpoint, body, () => latest.current.devices.find((d) => d.cloud_id === cloudId)?.connected),
    [],
  );
  const onEvent = useCallback((fn: (ev: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);
  const ppl = useMemo(() => people(data, users), [data, users]);
  const app = useMemo<App>(
    () => ({
      ...ppl,
      user,
      data,
      devices,
      users,
      status,
      firstScans,
      logsTick,
      latest,
      save,
      loadUsers,
      loadDevices,
      logs: allLogs,
      backups: appBackups,
      command: appCommand,
      onEvent,
      guide,
      setGuide,
    }),
    [ppl, user, data, devices, users, status, firstScans, logsTick, save, loadUsers, loadDevices, allLogs, appBackups, appCommand, onEvent, guide],
  );
  return (
    <AppContext value={app}>
      <ReadyContext value={ready}>{children}</ReadyContext>
    </AppContext>
  );
}
