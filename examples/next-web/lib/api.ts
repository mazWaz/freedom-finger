// Permintaan dari halaman ke server web ini (alamat yang sama; cookie sesi ikut sendiri): API Freedom
// Finger lewat /api/ff/* (docs/api.md, token ditambahkan server), perintah ke mesin, dan event realtime.
// Fungsi di sini tanpa state React; daftar mesin dan sebagainya dikirim pemanggil (components/aplikasi).
import type { CommandResult, Device, LiveEvent, Scan } from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** fetch ke server web; sesi yang berakhir (12 jam tidak dipakai, server dimulai ulang) membawa ke layar login. */
export async function send(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  if (r.status === 401) {
    location.assign('/login');
    await new Promise(() => {}); // berhenti di sini sampai halaman berganti
  }
  return r;
}

/** JSON `{success, …}` dari server web; `success: false` menjadi ApiError dengan status HTTP-nya. */
export async function request<T = Record<string, any>>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const init = body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const r = await send(path, init);
  const j = await r.json().catch(() => ({ success: false, message: `Server web menjawab ${r.status}.` }));
  if (!j.success) throw new ApiError(r.status, j.message);
  return j;
}

/** Balasan lengkap API Freedom Finger `{success, data?, trans_id?, …}`; `success: false` menjadi error. */
export const call = (endpoint: string, body: object = {}) => request<Record<string, any>>(`/api/ff/${endpoint}`, 'POST', body);
export const api = async <T = any>(endpoint: string, body?: object): Promise<T> => (await call(endpoint, body)).data;

/** Cadangan data satu user di satu mesin (`get_backup`); `body` = byte body FkWeb dari `template` (base64). */
export type Backup = { cloud_id: string; name: string; privilege: string; updated: string; template: string; body: Uint8Array };

/** Cadangan data user ini di server, satu per mesin yang punya, terbaru dulu. */
export async function backups(pin: string, devices: Device[]): Promise<Backup[]> {
  const list = await Promise.all(
    devices.map((d) =>
      api('get_backup', { cloud_id: d.cloud_id, pin }).then(
        (b) => ({ ...b, cloud_id: d.cloud_id, body: Uint8Array.from(atob(b.template), (c) => c.charCodeAt(0)) }) as Backup,
        () => null,
      ),
    ),
  );
  return list.filter((b) => b !== null).sort((a, b) => b.updated.localeCompare(a.updated));
}

export const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Kirim perintah ke mesin dan tunggu hasilnya (mesin mengambil perintah saat bertanya, ±20 detik–2 menit).
 * `status` "offline": mesin terputus sebelum mengambil perintahnya (`connected()` dari daftar mesin terbaru);
 * perintah tetap mengantre di server.
 */
export async function command(cloud_id: string, endpoint: string, body: object, connected: () => boolean | undefined): Promise<CommandResult> {
  const { trans_id } = await call(endpoint, { cloud_id, ...body });
  const start = Date.now();
  for (;;) {
    await sleep(3000);
    const r = (await call('get_result', { cloud_id, trans_id })) as unknown as CommandResult;
    if (r.status === 'done' || r.status === 'timeout') return r;
    if (r.status === 'pending' && connected() === false) return { ...r, status: 'offline' };
    if (r.status === 'pending' && Date.now() - start > 10 * 60_000) return { ...r, status: 'timeout' }; // mesin mati atau dicabut
  }
}

/**
 * Event realtime (SSE lewat fetch, supaya sesi yang berakhir terdeteksi seperti request lain): absen
 * baru dan hasil perintah, isinya sama dengan webhook. Tersambung ulang sendiri sampai `signal` dibatalkan.
 */
export async function listen(onEvent: (ev: LiveEvent) => void, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const r = await send('/api/ff/events', { signal });
      const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (let c; !(c = await reader.read()).done; ) {
        buf += c.value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
          buf = buf.slice(i + 2);
          if (line) onEvent(JSON.parse(line.slice(5)));
        }
      }
    } catch {}
    await sleep(1000);
  }
}

/** Log absen dari mesin-mesin ini, masing-masing dengan `cloud_id`. */
export async function logs(from: string, to: string, cloudIds: string[]): Promise<Scan[]> {
  const parts = await Promise.all(
    cloudIds.map(async (id) => ((await api('get_attlog', { cloud_id: id, start_date: from, end_date: to })) as Scan[]).map((l) => ({ ...l, cloud_id: id }))),
  );
  return parts.flat();
}
