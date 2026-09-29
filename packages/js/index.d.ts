// Tipe untuk index.js. Bentuk data sama dengan docs/openapi.yaml.

export interface ConnectOptions {
  /** Alamat server. Bawaan `http://localhost:8013`. */
  url?: string;
  /** Token API: `FKWEB_TOKEN` di `freedom-finger.env`. */
  token: string;
  /** Batas menunggu hasil perintah ke mesin, ms. Bawaan 6 menit. */
  timeout?: number;
}

export interface StartOptions {
  /** Program freedom-finger. Bawaan `freedom-finger` dari PATH. */
  bin?: string;
  /** Folder data (pengaturan, token, database, foto). Bawaan `freedom-finger-data`. */
  data?: string;
  /** Bawaan 8013. */
  port?: number;
  /** Keluaran program. Bawaan `inherit` (ke terminal aplikasi). */
  stdio?: 'inherit' | 'ignore';
  /** Batas menunggu program siap, ms. Bawaan 15 detik. */
  timeout?: number;
}

/** `cloud_id` boleh kosong selama baru satu mesin yang terhubung. */
export interface Target {
  cloud_id?: string;
}
/** Perintah ke mesin; `trans_id` dibuat server bila kosong. */
export interface Cmd extends Target {
  trans_id?: string;
}

export interface Device {
  cloud_id: string;
  device_name: string | null;
  ip: string | null;
  /** `YYYY-MM-DD hh:mm:ss`, jam server */
  last_activity: string | null;
  connected: boolean;
}

export interface Attlog {
  pin: string;
  /** `YYYY-MM-DD hh:mm:ss` */
  scan_date: string;
  /** 1 jari, 2 password, 3 kartu, 4 wajah */
  verify: number;
  /** 0 masuk, 1 pulang */
  status_scan: number;
  /** Path file foto di server, bila mesin mengirim foto */
  photo?: string;
}

export interface DeviceInfo {
  cloud_id: string;
  device_name: string | null;
  last_activity: string | null;
  /** Jam mesin saat terakhir bertanya */
  fk_time: string | null;
  info: Record<string, unknown> | null;
  webhook_url: string | null;
}

export interface Found {
  ip: string;
  mode: 'lokal' | 'ditolak' | 'diam';
  /** Terisi bila mesin ini sudah terhubung ke server */
  cloud_id: string | null;
  note: string;
}

/** `1` user, `2` admin, `3` subadmin */
export type Privilege = '1' | '2' | '3';

export interface UserInfo {
  pin: string;
  name: string;
  privilege: Privilege;
  finger: string;
  face: string;
  password: string;
  rfid: string;
  vein: string;
  /** Data user lengkap (base64); kirim lagi di setUserInfo supaya jari/wajah tidak hilang */
  template: string;
}

export interface Backup {
  pin: string;
  name: string;
  privilege: Privilege;
  updated: string;
  template: string;
}

export interface UserData {
  pin: string;
  name?: string;
  privilege?: Privilege;
  password?: string;
  rfid?: string;
  /** Tanpa template, jari dan wajah user ini terhapus dari mesin */
  template?: string;
}

export interface Result {
  success: true;
  trans_id: string;
  type: CommandType;
  cmd_code: string;
  status: 'pending' | 'sent' | 'done' | 'timeout';
  result_code: string | null;
  data: unknown;
  created: string | null;
  sent: string | null;
  done: string | null;
}

export type CommandType =
  | 'get_all_pin' | 'get_userinfo' | 'set_userinfo' | 'delete_userinfo' | 'reg_online' | 'set_time' | 'restart_device' | 'sync_attlog';

/** Isi sama dengan callback webhook. */
export type FreedomFingerEvent =
  | { type: 'attlog'; cloud_id: string; data: { pin: string; scan: string; verify: string; status_scan: string; photo?: string } }
  | { type: CommandType; cloud_id: string; trans_id: string; data: unknown }
  /** Pendengar terlalu lambat; ambil yang terlewat lewat getAttlog() */
  | { type: 'lagged'; missed: number };

export type Done = { status: string };

export class FreedomFingerError extends Error {
  /** Status HTTP, bila dari server */
  status?: number;
  /** Isi get_result, bila perintah ke mesin gagal */
  result?: Result;
}

export class Client {
  constructor(options: ConnectOptions);
  readonly url: string;
  /** `POST /api/<endpoint>`: balasan server apa adanya. */
  call(endpoint: string, body?: object): Promise<any>;
  /** Kirim perintah ke mesin lalu tunggu hasilnya. */
  command(endpoint: CommandType, body?: object): Promise<unknown>;
  /** Absen baru dan hasil perintah, realtime; tersambung ulang sendiri. */
  events(options?: { signal?: AbortSignal }): AsyncGenerator<FreedomFingerEvent, void, undefined>;

  getDevices(): Promise<Device[]>;
  /** Cari mesin di jaringan lokal (sampai 10 detik). */
  scanDevices(body?: { password?: number }): Promise<Found[]>;
  getAttlog(body: Target & { start_date: string; end_date: string }): Promise<Attlog[]>;
  getDevice(body?: Target): Promise<DeviceInfo>;
  getBackup(body: Target & { pin: string }): Promise<Backup>;
  getResult(body: Target & { trans_id: string }): Promise<Result>;

  getAllPin(body?: Cmd): Promise<{ total: number; pin_arr: string[] }>;
  getUserInfo(body: Cmd & { pin: string }): Promise<UserInfo>;
  /** Mengganti SELURUH data user. */
  setUserInfo(body: Cmd & { data: UserData }): Promise<Done>;
  deleteUserInfo(body: Cmd & { pin: string }): Promise<Done>;
  /** Buka layar daftar di mesin: 0–9 jari, 10 password, 11 kartu, 12 wajah. */
  regOnline(body: Cmd & { pin: string; verification: number }): Promise<Done>;
  setTime(body?: Cmd & { timezone?: string }): Promise<Done>;
  restartDevice(body?: Cmd): Promise<null>;
  /** Tarik semua log dari mesin ke database. */
  syncAttlog(body?: Cmd): Promise<{ log_count: number | null; one_log_size: number | null; added: number }>;
}

export interface Sidecar extends Client {
  /** Hentikan program; selesai saat prosesnya sudah keluar. */
  stop(): Promise<void>;
  process: import('node:child_process').ChildProcess;
}

/** Klien untuk server yang sudah berjalan. */
export function connect(options: ConnectOptions): Client;
/** Jalankan program freedom-finger di samping aplikasi (Node/Electron). */
export function start(options?: StartOptions): Promise<Sidecar>;
