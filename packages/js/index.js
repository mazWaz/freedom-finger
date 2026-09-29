// Freedom Finger untuk JavaScript: klien API server absensi lokal, event realtime, dan menjalankan
// program freedom-finger di samping aplikasi (sidecar). Tanpa dependency; Node 18+, Electron,
// Tauri, browser (start() hanya Node/Electron). Tipe: index.d.ts. API: docs/openapi.yaml.

export class FreedomFingerError extends Error {
  constructor(message, status, result) {
    super(message);
    this.name = 'FreedomFingerError';
    this.status = status; // status HTTP, bila dari server
    this.result = result; // isi get_result, bila perintah ke mesin gagal
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Endpoint yang langsung menjawab dari database: method mengembalikan `data`. */
const QUERIES = { getDevices: 'get_devices', scanDevices: 'scan_devices', getAttlog: 'get_attlog', getDevice: 'get_device', getBackup: 'get_backup' };
/** Perintah ke mesin: method mengirim, lalu menunggu hasilnya. */
const COMMANDS = {
  getAllPin: 'get_all_pin', getUserInfo: 'get_userinfo', setUserInfo: 'set_userinfo', deleteUserInfo: 'delete_userinfo',
  regOnline: 'reg_online', setTime: 'set_time', restartDevice: 'restart_device', syncAttlog: 'sync_attlog',
};

export class Client {
  constructor({ url = 'http://localhost:8013', token, timeout = 6 * 60_000 } = {}) {
    if (!token) throw new FreedomFingerError('token wajib: FKWEB_TOKEN di freedom-finger.env');
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.timeout = timeout;
  }

  /** `POST /api/<endpoint>`: balasan server apa adanya; `success: false` jadi error. */
  async call(endpoint, body = {}) {
    const r = await fetch(`${this.url}/api/${endpoint}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new FreedomFingerError(j.message ?? `HTTP ${r.status}`, r.status);
    return j;
  }

  getResult(body) {
    return this.call('get_result', body);
  }

  /** Kirim perintah ke mesin lalu tunggu hasilnya. Mesin mengambil perintah ±20 detik sampai 2 menit. */
  async command(endpoint, body = {}) {
    const { trans_id } = await this.call(endpoint, body);
    // ponytail: tanya get_result tiap detik; cukup untuk server lokal, pakai events() bila perintahnya sangat banyak
    for (const end = Date.now() + this.timeout; Date.now() < end; ) {
      await sleep(1000);
      const r = await this.call('get_result', { cloud_id: body.cloud_id, trans_id });
      if (r.status === 'timeout') throw new FreedomFingerError(`mesin tidak menjawab ${endpoint} (${trans_id})`, undefined, r);
      if (r.status !== 'done') continue;
      if (r.result_code === 'OK' || r.result_code === 'NO_REPLY') return r.data; // NO_REPLY: restart_device
      throw new FreedomFingerError(`mesin menolak ${endpoint}: ${r.result_code}`, undefined, r);
    }
    throw new FreedomFingerError(`${endpoint} (${trans_id}) belum diambil mesin; mesin terhubung?`);
  }

  /**
   * Absen baru dan hasil perintah, realtime (SSE), sampai `signal` dibatalkan atau loop dihentikan.
   * Tersambung ulang sendiri. Event selama terputus tidak dikirim ulang: ambil lewat getAttlog().
   */
  async *events({ signal } = {}) {
    while (!signal?.aborted) {
      let reader;
      try {
        const r = await fetch(`${this.url}/api/events`, { headers: { authorization: `Bearer ${this.token}` }, signal });
        if (r.status === 401) throw new FreedomFingerError('token salah', 401);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (let chunk; !(chunk = await reader.read()).done; ) {
          buf += chunk.value;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const lines = buf.slice(0, i).split('\n');
            buf = buf.slice(i + 2);
            const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
            if (data) yield JSON.parse(data); // baris ":" tanpa data = keep-alive
          }
        }
      } catch (e) {
        if (signal?.aborted) return;
        if (e instanceof FreedomFingerError) throw e;
      } finally {
        reader?.cancel().catch(() => {});
      }
      await sleep(1000); // server mati atau restart: coba lagi
    }
  }
}

for (const [name, ep] of Object.entries(QUERIES)) {
  Client.prototype[name] = async function (body = {}) {
    return (await this.call(ep, body)).data;
  };
}
for (const [name, ep] of Object.entries(COMMANDS)) {
  Client.prototype[name] = function (body = {}) {
    return this.command(ep, body);
  };
}

/** Klien untuk server yang sudah berjalan (layanan hasil `freedom-finger install`, atau di komputer lain). */
export function connect(options) {
  return new Client(options);
}

/**
 * Jalankan program freedom-finger di samping aplikasi (Node/Electron), tunggu sampai siap, lalu
 * kembalikan klien + `stop()`. Token dibaca dari `freedom-finger.env` di folder data.
 */
export async function start({ bin = 'freedom-finger', data = 'freedom-finger-data', port = 8013, stdio = 'inherit', timeout = 15_000 } = {}) {
  const { spawn } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const url = `http://127.0.0.1:${port}`;
  const up = () => fetch(`${url}/status.json`).then((r) => r.ok, () => false);
  if (await up()) throw new FreedomFingerError(`port ${port} sudah dipakai server lain; pakai connect() atau port lain`);

  const child = spawn(bin, ['--data', data], { stdio, env: { ...process.env, FKWEB_PORT: String(port) } });
  const exited = new Promise((_, reject) => {
    child.once('error', reject); // program tidak ditemukan
    child.once('exit', (code) => reject(new FreedomFingerError(`freedom-finger berhenti (kode ${code})`)));
  });
  const kill = () => child.kill();
  process.once('exit', kill); // jangan tinggalkan server yatim saat aplikasi keluar
  const stop = () =>
    new Promise((done) => {
      process.off('exit', kill);
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return done(); // tidak jalan / sudah berhenti
      child.once('exit', () => done());
      child.kill();
    });
  const ready = (async () => {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(200)) if (await up()) return;
    throw new FreedomFingerError(`freedom-finger belum siap setelah ${timeout} ms`);
  })();
  try {
    await Promise.race([ready, exited]);
  } catch (e) {
    await stop();
    throw e;
  }

  const env = await readFile(join(data, 'freedom-finger.env'), 'utf8');
  const token = process.env.FKWEB_TOKEN || env.match(/^FKWEB_TOKEN=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
  return Object.assign(new Client({ url, token }), { stop, process: child });
}
