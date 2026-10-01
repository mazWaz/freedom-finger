// Uji server web melawan server Freedom Finger tiruan: login wajib, user pertama sekali saja, token hanya
// dipakai server, simpan yang bentrok ditolak, kelola user, kunci setelah salah berulang, export Excel.
// Jalankan: bun test
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from './app.ts';

const seen: string[] = []; // header authorization yang diterima server Freedom Finger tiruan
const ff = Bun.serve({
  port: 0,
  fetch(req) {
    seen.push(req.headers.get('authorization') ?? '');
    return Response.json({ success: true, data: [{ cloud_id: 'MESIN01' }] });
  },
});
const dir = await mkdtemp(join(tmpdir(), 'ff-web-'));
let web: Awaited<ReturnType<typeof start>>;
let cookie = ''; // sesi user pertama

const url = (path: string) => `${web.url.origin}${path}`;
const send = (method: string, path: string, body?: unknown, session = cookie) =>
  fetch(url(path), { method, headers: { 'content-type': 'application/json', cookie: session }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (path: string, body: unknown, session = cookie) => send('POST', path, body, session);
const sessionOf = (r: Response) => r.headers.get('set-cookie')?.split(';')[0] ?? '';

beforeAll(async () => {
  web = await start({ ffUrl: ff.url.origin, ffToken: 'token-rahasia-uji', port: 0, dataDir: dir }, false);
});
afterAll(async () => {
  web.stop(true);
  ff.stop(true);
  await rm(dir, { recursive: true });
});

test('tanpa login tidak ada yang lewat; user pertama hanya sekali', async () => {
  expect((await post('/api/get_devices', {}, '')).status).toBe(401);
  expect((await send('GET', '/app/data', undefined, '')).status).toBe(401);
  expect(seen).toEqual([]); // server Freedom Finger tidak pernah dihubungi
  expect((await (await fetch(url('/app/me'))).json()).setup).toBe(true);
  expect((await post('/app/setup', { name: 'admin', password: 'pendek' }, '')).status).toBe(400);
  const r = await post('/app/setup', { name: 'Admin', password: 'rahasia123' }, '');
  expect(await r.json()).toEqual({ success: true, user: 'admin' });
  expect(r.headers.get('set-cookie')).toContain('HttpOnly');
  cookie = sessionOf(r);
  expect((await post('/app/setup', { name: 'lain', password: 'rahasia123' }, '')).status).toBe(403);
});

test('API diteruskan dengan token dari server, bukan dari browser', async () => {
  const r = await post('/api/get_devices', {});
  expect((await r.json()).data[0].cloud_id).toBe('MESIN01');
  expect(seen).toEqual(['Bearer token-rahasia-uji']);
  expect((await post('/api/GET-DEVICES', {})).status).toBe(404);
});

test('simpan yang bentrok ditolak, data tersimpan di file', async () => {
  const first = await (await send('GET', '/app/data')).json();
  expect(first.data).toBeNull();
  expect((await send('PUT', '/app/data', { rev: first.rev, data: { office: 'A' } })).status).toBe(200);
  expect((await send('PUT', '/app/data', { rev: first.rev, data: { office: 'B' } })).status).toBe(409); // rev lama
  expect((await (await send('GET', '/app/data')).json()).data.office).toBe('A');
  expect(JSON.parse(await Bun.file(join(dir, 'aplikasi.json')).text()).office).toBe('A');
});

test('kelola user dan ganti kata sandi', async () => {
  expect((await post('/app/users', { name: 'operator', password: 'rahasia123' })).status).toBe(200);
  expect((await post('/app/users', { name: 'operator', password: 'rahasia123' })).status).toBe(409);
  const op = sessionOf(await post('/app/login', { name: 'operator', password: 'rahasia123' }, ''));
  expect((await post('/api/get_devices', {}, op)).status).toBe(200);
  expect((await send('DELETE', '/app/users/admin', undefined, op)).status).toBe(200);
  expect((await post('/api/get_devices', {})).status).toBe(401); // sesi admin langsung berakhir
  expect((await send('DELETE', '/app/users/operator', undefined, op)).status).toBe(400); // diri sendiri
  expect((await post('/app/password', { old: 'salah-salah', password: 'rahasia456' }, op)).status).toBe(400);
  expect((await post('/app/password', { old: 'rahasia123', password: 'rahasia456' }, op)).status).toBe(200);
  const users = JSON.parse(await Bun.file(join(dir, 'users.json')).text());
  expect(users.map((u: { name: string }) => u.name)).toEqual(['operator']);
  expect(users[0].hash).toStartWith('$argon2id$');
  cookie = op;
});

test('export Excel', async () => {
  const sheets = [{ name: 'Rekap', title: 'Uji', columns: [{ title: 'Tanggal', format: 'dd/mm/yyyy', width: 12 }], rows: [[46294]] }];
  const r = await post('/app/xlsx', { sheets });
  expect(r.status).toBe(200);
  expect([...new Uint8Array(await r.arrayBuffer()).slice(0, 2)]).toEqual([0x50, 0x4b]); // zip: "PK"
  expect((await post('/app/xlsx', { sheets: 'bukan tabel' })).status).toBe(400);
});

test('salah 5 kali: user dikunci sementara; keluar mengakhiri sesi', async () => {
  for (let i = 0; i < 5; i++) expect((await post('/app/login', { name: 'operator', password: 'salah-salah' }, '')).status).toBe(401);
  expect((await post('/app/login', { name: 'operator', password: 'rahasia456' }, '')).status).toBe(429);
  expect((await post('/app/logout', {})).status).toBe(200);
  expect((await post('/api/get_devices', {})).status).toBe(401);
});
