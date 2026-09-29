// Contoh sekaligus uji (PRD 6.8): jalankan freedom-finger lewat start(), simulasikan mesin yang
// mengirim absen dan menjawab perintah, lalu pastikan klien menerimanya.
//   node test.mjs     (FF_BIN = program; bawaan ../../target/debug/freedom-finger)
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './index.js';

const exe = process.platform === 'win32' ? '.exe' : '';
const bin = process.env.FF_BIN ?? fileURLToPath(new URL(`../../target/debug/freedom-finger${exe}`, import.meta.url));
const port = await new Promise((ok) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => ok(port));
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- mesin simulasi (FkWeb, docs/protokol.md bagian 14) ---------------------------------------
const DEV = 'MESIN01';
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
/** Body FkWeb: panjang JSON + NUL (u32 LE), JSON, NUL, lalu tiap biner dengan panjangnya. */
const fkweb = (json, bins = []) => {
  const text = Buffer.from(`${JSON.stringify(json)}\0`);
  return Buffer.concat([u32(text.length), text, ...bins.flatMap((b) => [u32(b.length), b])]);
};
const machine = (code, body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { request_code: code, dev_id: DEV, ...headers }, body });

const data = await mkdtemp(join(tmpdir(), 'ff-js-'));
const ff = await start({ bin, data, port, stdio: 'ignore' });
try {
  const events = ff.events();
  const first = events.next();
  await sleep(300); // tunggu tersambung

  const t = Date.now();
  const glog = { fk_bin_data_lib: 'FKDataHS103', io_mode: 16777216, io_time: '20260929080000', log_image: null, user_id: '7', verify_mode: 268435456 };
  await machine('realtime_glog', fkweb(glog), { trans_id: 'RTLogSendAction' });
  const { value: absen } = await first;
  const ms = Date.now() - t;
  assert.deepEqual(absen, { type: 'attlog', cloud_id: DEV, data: { pin: '7', scan: '2026-09-29 08:00', verify: '1', status_scan: '0' } });
  assert.ok(ms < 1000, `event ${ms} ms`);
  console.log(`✓ absen dari mesin diterima events() dalam ${ms} ms`);

  const logs = await ff.getAttlog({ start_date: '2026-09-29', end_date: '2026-09-29' });
  assert.deepEqual(logs, [{ pin: '7', scan_date: '2026-09-29 08:00:00', verify: 1, status_scan: 0 }]);
  assert.equal((await ff.getDevices())[0].cloud_id, DEV);
  console.log('✓ getAttlog() dan getDevices()');

  const pins = ff.getAllPin(); // cloud_id kosong: satu-satunya mesin
  let trans;
  for (let i = 0; i < 50 && !trans; i++) {
    const r = await machine('receive_cmd', fkweb({ fk_name: 'Simulasi', fk_info: {} }));
    if (r.headers.get('cmd_code') === 'GET_USER_ID_LIST') trans = r.headers.get('trans_id');
    else await sleep(100);
  }
  const rec = (pin) => Buffer.concat([Buffer.from(pin), Buffer.alloc(36 - pin.length)]);
  const list = fkweb({ one_user_id_size: 36, user_id_array: 'BIN_1', user_id_count: 2 }, [Buffer.concat([rec('1'), rec('2')])]);
  await machine('send_cmd_result', list, { trans_id: trans, cmd_return_code: 'OK' });
  assert.deepEqual(await pins, { total: 2, pin_arr: ['1', '2'] });
  assert.deepEqual((await events.next()).value, { type: 'get_all_pin', cloud_id: DEV, trans_id: trans, data: { total: 2, pin_arr: ['1', '2'] } });
  console.log('✓ getAllPin() menunggu jawaban mesin; hasilnya juga muncul di events()');
  await events.return();
} finally {
  await ff.stop();
  await rm(data, { recursive: true, force: true, maxRetries: 5 });
}
