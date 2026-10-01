// Bentuk data dari server Freedom Finger (docs/api.md) dan aplikasi.json.

/** Mesin (`get_devices`). */
export type Device = { cloud_id: string; device_name?: string; connected: boolean; last_activity?: string; ip?: string | null };

/** User yang tercatat di server untuk satu mesin (`get_users`). `privilege` "1" karyawan, "2" admin, "3" subadmin. */
export type MachineUser = { cloud_id: string; pin: string; name: string; privilege: string; updated: string };

/** Satu scan (`get_attlog` dengan `cloud_id`), atau koreksi manual (`manual`, `reason`). */
export type Scan = { pin: string; scan_date: string; cloud_id?: string; verify?: number | string; manual?: boolean; reason?: string; photo?: string };

/** Event realtime (`/api/events`): `attlog`, hasil perintah (`get_userinfo`, `set_time`, …), `lagged`. */
export type LiveEvent = { type: string; cloud_id?: string; data?: { pin?: string; scan?: string } & Record<string, unknown> };

/** Hasil perintah (`get_result`). */
export type CommandResult = {
  status: 'pending' | 'sent' | 'done' | 'timeout' | 'offline';
  result_code?: string;
  data?: Record<string, unknown> & { pin_arr?: string[]; template?: string; privilege?: string };
};

/** Jam kerja satu hari: jam masuk–pulang, atau jam bebas. `null` = libur. */
export type Shift = { start: string; end: string; free?: false } | { free: true; start?: undefined; end?: undefined };

/** Jadwal: `days[0]` = Minggu. Aturan (toleransi, lembur, jarak pulang) dari jadwal utama berlaku untuk semua. */
export type Schedule = {
  days: (Shift | null)[];
  tolerance: number;
  overtime: boolean[];
  overtimeMin: number;
  overtimeMax: number[];
  minGap: number;
  color?: string;
};

/** Jadwal lain (mis. paruh waktu), dipilih per karyawan. */
export type OtherSchedule = { id: string; name: string; color: string; days: (Shift | null)[]; overtime: boolean[]; overtimeMax: number[] };

export type Employee = { name?: string; dept?: string; recap?: boolean; schedule?: string; added?: string; removed?: string };
export type Holiday = { date: string; note: string };
export type LeaveKind = 'izin' | 'sakit' | 'cuti' | 'dinas';
export type Leave = { id: string; pin: string; from: string; to: string; kind: LeaveKind; note: string };
export type Correction = { id: string; pin: string; date: string; time: string; reason: string };
/** Ambil data karyawan dari satu mesin yang sedang berjalan. */
export type Pull = { trans: string; at: number; cmds?: string[]; done?: number };
/** Perintah perawatan yang menunggu mesin (menu Mesin). */
export type Command = { trans: string; cloud_id: string; type: string; at: number };

/** aplikasi.json */
export type AppData = {
  version: number;
  office: string;
  employees: Record<string, Employee>;
  schedule: Schedule;
  schedules: OtherSchedule[];
  holidays: Holiday[];
  leaves: Leave[];
  corrections: Correction[];
  pull: Record<string, Pull>;
  commands: Command[];
};
