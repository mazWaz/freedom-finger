'use client';
// Kerja di latar yang tetap berjalan di menu mana pun:
// - ambil data karyawan dari mesin (menu Karyawan). Mesin hanya menjawab satu perintah ±20 detik, jadi
//   antrean perintahnya di server dan kemajuannya di aplikasi.json: berlanjut walau halaman ditutup.
// - perintah perawatan mesin (menu Mesin: setel jam, tarik ulang log, restart) sampai mesin menjawab.
// ponytail: kemajuan dijalankan halaman yang terbuka; dua orang bersamaan bisa saling menolak simpan
// (409, lalu dimuat ulang). Pindahkan ke server web bila sering terjadi.
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { call } from '@/lib/api';
import { byPin } from '@/lib/data';
import type { AppData, CommandResult, Pull } from '@/lib/types';
import { useApp, useLiveEvent } from './aplikasi';
import { useUi } from './ui';

/** Perintah perawatan di menu Mesin. */
export const ACTIONS: Record<string, { label: string; done: (d?: Record<string, any>) => string }> = {
  set_time: { label: 'Setel jam sekarang', done: () => 'jam mesin sudah disetel' },
  sync_attlog: { label: 'Tarik ulang semua log', done: (d) => `${d?.added ?? 0} log baru dari ${d?.log_count ?? 0} log di mesin` },
  restart_device: { label: 'Restart mesin', done: () => 'perintah terkirim; mesin menyala lagi dalam ±1 menit' },
};

/** Kode tolakan mesin -> kalimat biasa; kodenya tetap disebut untuk teknisi. */
export const REJECT: Record<string, string> = {
  ERROR_INVALID_PARAMTER: 'mesin menolak isi perintah',
  BUSY: 'mesin sedang dipakai (menu mesin terbuka); coba lagi setelah menu ditutup',
  'NOT SUPPORT CMD': 'mesin tidak mendukung perintah ini',
};

/** Perintah atau daftar PIN yang tidak diambil mesin selama ini dianggap gagal (mesin mati atau dicabut). */
const WAIT_MS = 10 * 60_000;
const gone = (e: unknown) => /trans_id tidak dikenal/.test((e as Error).message); // mis. database dipulihkan
const pending = (r: CommandResult) => r.status === 'pending' || r.status === 'sent';

type Result = { at: Date; text: string; ok: boolean };
type Jobs = {
  /** Kemajuan ambil data karyawan, kosong bila tidak berjalan. */
  pullStatus: string;
  startPull: () => Promise<void>;
  /** Kirim perintah perawatan dan tunggu dengan layar tunggu. */
  run: (type: string, cloudId: string) => Promise<void>;
  /** Hasil perintah terakhir per mesin, terbaru dulu (hanya selama aplikasi terbuka). */
  results: Record<string, Result[]>;
};

const JobsContext = createContext<Jobs | null>(null);

export function useJobs() {
  const jobs = use(JobsContext);
  if (!jobs) throw new Error('useJobs di luar JobsProvider');
  return jobs;
}

function pullText(pull: AppData['pull']) {
  const jobs = Object.values(pull);
  if (!jobs.length) return '';
  if (jobs.some((p) => !p.cmds)) return 'Menunggu daftar PIN dari mesin (±20 detik sampai 2 menit)…';
  const done = jobs.reduce((n, p) => n + (p.done ?? 0), 0);
  const total = jobs.reduce((n, p) => n + p.cmds!.length, 0);
  return `Mengambil data karyawan: ${done} dari ${total}. Mesin menjawab ±20 detik per karyawan; aplikasi boleh ditutup, nanti dilanjutkan.`;
}

export function JobsProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const { notify, waiting } = useUi();
  const { latest, save, loadUsers } = app;
  const [results, setResults] = useState<Record<string, Result[]>>({});
  const busy = useRef({ pull: false, commands: false });
  const awaited = useRef<string | null>(null); // perintah yang ditunggu dengan layar tunggu

  /** Satu langkah ambil data untuk satu mesin (`p` diubah di tempat); `true` bila ada kemajuan. */
  const step = useCallback(async (cloud_id: string, p: Pull, pulls: AppData['pull']) => {
    let changed = false;
    if (!p.cmds) {
      const r = (await call('get_result', { cloud_id, trans_id: p.trans })) as unknown as CommandResult;
      if (pending(r) && Date.now() - (p.at ?? 0) < WAIT_MS) return false;
      const pins = r.data?.pin_arr;
      if (pending(r) || r.status === 'timeout' || !pins) {
        delete pulls[cloud_id];
        notify(`Mesin ${cloud_id} tidak menjawab. Pastikan mesin terhubung (menu Hari ini), lalu coba lagi.`, true);
        return true;
      }
      // hanya PIN yang belum tercatat di server; urut supaya kemajuan bisa dicek dari depan
      const known = new Set(latest.current.users.filter((u) => u.cloud_id === cloud_id).map((u) => u.pin));
      p.cmds = [];
      p.done = 0;
      for (const pin of pins.filter((x) => !known.has(x)).sort(byPin)) p.cmds.push((await call('get_userinfo', { cloud_id, pin })).trans_id);
      changed = true;
    }
    // mesin mengerjakan antrean berurutan: cukup periksa perintah terdepan yang belum selesai
    const before = p.done!;
    while (p.done! < p.cmds.length) {
      const r = (await call('get_result', { cloud_id, trans_id: p.cmds[p.done!] })) as unknown as CommandResult;
      if (pending(r)) break;
      p.done!++;
    }
    if (p.done === p.cmds.length) {
      delete pulls[cloud_id];
      notify(`Data karyawan dari ${cloud_id} sudah lengkap.`);
    }
    return changed || p.done !== before;
  }, [latest, notify]);

  const pullTick = useCallback(async () => {
    const pulls = structuredClone(latest.current.data.pull);
    if (busy.current.pull || !Object.keys(pulls).length) return;
    busy.current.pull = true;
    const ids = Object.keys(pulls);
    let changed = false;
    try {
      for (const [cloud_id, p] of Object.entries(pulls)) {
        try {
          changed = (await step(cloud_id, p, pulls)) || changed;
        } catch (e) {
          if (!gone(e)) continue; // error lain dicoba lagi nanti
          delete pulls[cloud_id];
          notify(`Ambil data karyawan dari ${cloud_id} berhenti: ${(e as Error).message}`, true);
          changed = true;
        }
      }
      if (changed) {
        await loadUsers().catch(() => {});
        // hanya mesin yang diperiksa di sini; ambil data yang baru dimulai sementara itu tetap
        await save((d) => {
          for (const id of ids) {
            if (pulls[id]) d.pull[id] = pulls[id];
            else delete d.pull[id];
          }
        }).catch(() => {});
      }
    } finally {
      busy.current.pull = false;
    }
  }, [latest, loadUsers, notify, save, step]);

  const record = useCallback((cloud_id: string, text: string, ok: boolean) => {
    setResults((r) => ({ ...r, [cloud_id]: [{ at: new Date(), text, ok }, ...(r[cloud_id] ?? [])].slice(0, 3) }));
    notify(text, !ok);
  }, [notify]);

  const commandTick = useCallback(async () => {
    const commands = latest.current.data.commands;
    if (busy.current.commands || !commands.length) return;
    busy.current.commands = true;
    try {
      const left: typeof commands = [];
      for (const c of commands) {
        let r: CommandResult;
        try {
          r = (await call('get_result', { cloud_id: c.cloud_id, trans_id: c.trans })) as unknown as CommandResult;
        } catch (e) {
          if (!gone(e)) left.push(c); // perintah tidak dikenal lagi: lupakan; error lain dicoba lagi nanti
          continue;
        }
        if (pending(r) && Date.now() - c.at < WAIT_MS) {
          left.push(c);
          continue;
        }
        const what = `${ACTIONS[c.type].label} (${c.cloud_id})`;
        if (r.status === 'done' && (r.result_code === 'OK' || r.result_code === 'NO_REPLY')) record(c.cloud_id, `${what}: ${ACTIONS[c.type].done(r.data)}.`, true);
        else {
          const why = pending(r) ? 'mesin tidak mengambil perintah dalam 10 menit' : r.status === 'timeout' ? 'mesin tidak menjawab'
            : `${REJECT[r.result_code!] ?? 'ditolak mesin'} (${r.result_code})`;
          record(c.cloud_id, `${what} gagal: ${why}.`, false);
        }
      }
      if (left.length !== commands.length) {
        const doneIds = new Set(commands.filter((c) => !left.includes(c)).map((c) => c.trans));
        await save((d) => void (d.commands = d.commands.filter((c) => !doneIds.has(c.trans)))).catch(() => {});
      }
      // layar tunggu ditutup saat perintahnya selesai, atau saat mesinnya terputus (tetap dipantau di kartu mesin)
      const w = left.find((c) => c.trans === awaited.current);
      if (awaited.current && (!w || latest.current.devices.find((d) => d.cloud_id === w.cloud_id)?.connected === false)) {
        if (w) notify('Mesin terputus. Perintahnya tetap menunggu dan dijalankan saat mesin tersambung lagi.', true);
        awaited.current = null;
        waiting();
      }
    } finally {
      busy.current.commands = false;
    }
  }, [latest, notify, record, save, waiting]);

  // cadangan bila event realtime terlewat; juga melanjutkan kerja yang tertinggal saat aplikasi dibuka ulang
  const pulling = Object.keys(app.data.pull).length > 0;
  const commanding = app.data.commands.length > 0;
  useEffect(() => {
    if (!pulling) return;
    pullTick();
    const timer = setInterval(pullTick, 15_000);
    return () => clearInterval(timer);
  }, [pulling, pullTick]);
  useEffect(() => {
    if (!commanding) return;
    commandTick();
    const timer = setInterval(commandTick, 10_000);
    return () => clearInterval(timer);
  }, [commanding, commandTick]);
  useLiveEvent((ev) => {
    if (ev.type === 'get_all_pin' || ev.type === 'get_userinfo') pullTick();
    if (ACTIONS[ev.type]) commandTick();
  });

  const startPull = useCallback(async () => {
    // hanya mesin yang sedang terhubung: perintah untuk mesin yang dicabut menunggu selamanya
    const on = latest.current.devices.filter((d) => d.connected);
    if (!on.length) return notify('Belum ada mesin yang terhubung. Lihat isian menu mesin di menu Hari ini.', true);
    const started: AppData['pull'] = {};
    try {
      for (const d of on) started[d.cloud_id] = { trans: (await call('get_all_pin', { cloud_id: d.cloud_id })).trans_id, at: Date.now() };
    } catch (e) {
      notify(`Gagal meminta data ke mesin: ${(e as Error).message}`, true);
    }
    await save((d) => void Object.assign(d.pull, started)).catch(() => {});
  }, [latest, notify, save]);

  const run = useCallback(async (type: string, cloud_id: string) => {
    try {
      const { trans_id } = await call(type, { cloud_id });
      await save((d) => void d.commands.push({ trans: trans_id, cloud_id, type, at: Date.now() }));
      awaited.current = trans_id;
      waiting(`${ACTIONS[type].label}: menunggu mesin (±20 detik sampai 2 menit)…`);
    } catch (e) {
      notify(`Gagal mengirim perintah: ${(e as Error).message}`, true);
    }
  }, [notify, save, waiting]);

  const pullStatus = pullText(app.data.pull);
  const jobs = useMemo(() => ({ pullStatus, startPull, run, results }), [pullStatus, startPull, run, results]);
  return <JobsContext value={jobs}>{children}</JobsContext>;
}
