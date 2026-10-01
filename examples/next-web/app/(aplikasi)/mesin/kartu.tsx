'use client';
// Kartu satu mesin di menu Mesin: jam mesin dibanding jam server, info, tombol perintah perawatan, dan
// perintah yang menunggu atau hasilnya (components/tugas.tsx menjalankan dan memantaunya).
import type { ReactNode } from 'react';
import { useApp } from '@/components/aplikasi';
import { ACTIONS, useJobs } from '@/components/tugas';
import { useUi } from '@/components/ui';
import { dmy } from '@/lib/format';
import type { Device } from '@/lib/types';

/** Hasil `get_device`: jam mesin (`fk_time`), selisihnya dengan jam server (detik), dan info firmware. */
export type DeviceInfo = { fk_time?: string; clock_offset?: number | null; info?: { firmware?: string; supported_enroll_data?: string[] } };

const ENROLL: Record<string, string> = { FP: 'Jari', FACE: 'Wajah', IDCARD: 'Kartu', PASSWORD: 'Password' };

/** Jam komputer ini "HH:MM" untuk riwayat perintah. */
const at = (d: Date | number) => new Date(d).toTimeString().slice(0, 5);
const when = (t?: string) => (t ? `${dmy(t.slice(0, 10))} ${t.slice(11)}` : '-');

/** Jam mesin saat terakhir bertanya, dibanding jam server Freedom Finger saat itu juga. */
function Jam({ g, connected }: { g?: DeviceInfo | null; connected: boolean }) {
  if (g?.clock_offset == null) return <>{connected ? 'belum diketahui: muncul setelah mesin bertanya lagi (±2 menit)' : 'tidak diketahui'}</>;
  const s = g.clock_offset;
  const diff = Math.abs(s) <= 1 ? 'sama dengan jam server' : `${Math.abs(s)} detik lebih ${s > 0 ? 'cepat' : 'lambat'} dari jam server`;
  // lebih dari 2 menit disetel otomatis oleh server; sampai saat itu tandai merah
  return (
    <>
      <span className="jam-mesin">{when(g.fk_time).slice(11)}</span> <span className={Math.abs(s) > 120 ? 'off' : 'ok'}>{diff}</span>
      <span className="redup">, {when(g.fk_time).slice(0, 10)}</span>
    </>
  );
}

export function Kartu({ d, g }: { d: Device; g?: DeviceInfo | null }) {
  const { data, users, status } = useApp();
  const { run, results } = useJobs();
  const { ask } = useUi();
  const waiting = data.commands.filter((c) => c.cloud_id === d.cloud_id);
  const since = d.last_activity ? ` sejak ${when(d.last_activity)}` : '';

  async function start(type: string) {
    if (type === 'restart_device' && !(await ask(`Restart mesin ${d.cloud_id}? Selama ±1 menit mesin tidak bisa dipakai absen.`,
      { title: 'Restart mesin', okLabel: 'Restart', cancelLabel: 'Batal' }))) return;
    run(type, d.cloud_id);
  }

  const rows: [string, ReactNode][] = [
    ['Jam mesin', <Jam key="jam" g={g} connected={d.connected} />],
    ['Cloud ID', d.cloud_id],
    ['IP', d.ip ?? (d.connected ? 'belum diketahui: muncul setelah mesin bertanya lagi' : 'tidak diketahui')],
    ['Terakhir aktif', when(d.last_activity)],
    ['Firmware', g?.info?.firmware ?? '-'],
    ['Bisa mendaftarkan', (g?.info?.supported_enroll_data ?? []).map((k) => ENROLL[k] ?? k).join(', ') || '-'],
    ['Karyawan tercatat', users.filter((u) => u.cloud_id === d.cloud_id).length],
  ];
  const log = [
    ...waiting.map((c) => (
      <li key={c.trans}>
        <time>{at(c.at)}</time>
        <span>{ACTIONS[c.type].label}: menunggu mesin mengambil perintah (±20 detik sampai 2 menit)…</span>
      </li>
    )),
    ...(results[d.cloud_id] ?? []).map((r, i) => (
      <li key={`hasil${i}`}>
        <time>{at(r.at)}</time>
        <span className={r.ok ? '' : 'off'}>{r.text}</span>
      </li>
    )),
  ];

  return (
    <article className="mesin-kartu">
      <header>
        <h2>{d.device_name || 'Mesin'}</h2>
        <span className={`status-titik ${d.connected ? 'ok' : 'off'}`}>{d.connected ? 'terhubung' : `terputus${since}`}</span>
      </header>
      <dl className="info-mesin">
        {rows.map(([label, value]) => [<dt key={label}>{label}</dt>, <dd key={`${label}=`}>{value}</dd>])}
      </dl>
      <div className="controls" style={{ margin: 0 }}>
        {Object.entries(ACTIONS).map(([type, a]) => (
          <button
            key={type}
            className={type === 'restart_device' ? 'bahaya' : undefined}
            disabled={!d.connected || waiting.some((c) => c.type === type)}
            onClick={() => start(type)}
          >
            {a.label}
          </button>
        ))}
      </div>
      {!d.connected && (
        <p className="catatan" style={{ margin: '14px 0 0' }}>
          Mesin tidak menghubungi aplikasi ini{since}. Periksa: mesin menyala dan tersambung ke jaringan kantor, dan menu Jaringan mesin
          berisi Mode Internet, Server IP {status.server_ip ?? 'IP server Freedom Finger'}, Server Port {status.port}, Server Req Ya.
          Tombol perintah aktif lagi setelah mesin terhubung.
        </p>
      )}
      {log.length > 0 && (
        <ul className="hasil" aria-label="Perintah ke mesin ini">
          {log}
        </ul>
      )}
    </article>
  );
}
