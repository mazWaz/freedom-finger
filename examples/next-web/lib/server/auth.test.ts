// Uji user, sesi, dan aplikasi.json tanpa Next.js: npm test
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createAuth } from './auth.ts';
import { createData } from './data.ts';

const dir = await mkdtemp(join(tmpdir(), 'ff-next-'));
after(() => rm(dir, { recursive: true }));
const auth = await createAuth(dir);
const status = (p: Promise<unknown>) => p.then(() => 200, (e: { status: number }) => e.status);

test('user pertama hanya sekali; kata sandi diperiksa dan disimpan sebagai hash', async () => {
  assert.equal(auth.hasUsers(), false);
  assert.equal(await status(auth.setup('admin', 'pendek', 'pendek')), 400);
  assert.equal(await status(auth.setup('admin', 'rahasia123', 'rahasia124')), 400);
  const token = await auth.setup('admin', 'rahasia123', 'rahasia123');
  assert.equal(auth.current(token), 'admin');
  assert.equal(await status(auth.setup('lain', 'rahasia123', 'rahasia123')), 403);
  const saved = JSON.parse(await readFile(join(dir, 'users.json'), 'utf8'));
  assert.match(saved[0].hash, /^scrypt\$/);
  assert.ok(!JSON.stringify(saved).includes('rahasia123'));
});

test('kelola user: hapus mengakhiri sesinya, ganti kata sandi mengakhiri sesi lain', async () => {
  await auth.addUser('operator', 'rahasia123');
  assert.equal(await status(auth.addUser('operator', 'rahasia123')), 409);
  assert.equal(await status(auth.addUser('Bukan Nama', 'rahasia123')), 400);
  const admin = await auth.login('admin', 'rahasia123');
  const op = await auth.login('operator', 'rahasia123');
  const op2 = await auth.login('operator', 'rahasia123');
  await auth.removeUser('admin', 'operator');
  assert.equal(auth.current(admin), null);
  assert.equal(await status(auth.removeUser('operator', 'operator')), 400);
  assert.equal(await status(auth.changePassword('operator', 'salah-salah', 'rahasia456', 'rahasia456', op)), 400);
  await auth.changePassword('operator', 'rahasia123', 'rahasia456', 'rahasia456', op);
  assert.deepEqual([auth.current(op), auth.current(op2)], ['operator', null]);
  auth.logout(op);
  assert.equal(auth.current(op), null);
});

test('salah 5 kali: user dikunci sementara, juga untuk kata sandi yang benar', async () => {
  for (let i = 0; i < 5; i++) assert.equal(await status(auth.login('operator', 'salah-salah')), 401);
  assert.equal(await status(auth.login('operator', 'rahasia456')), 429);
  assert.equal(await status(auth.login('tidak-ada', 'rahasia456')), 401);
});

test('aplikasi.json: simpan yang bentrok ditolak, data tersimpan di file', async () => {
  const data = await createData(dir);
  const first = data.get();
  assert.equal(first.data, null);
  await data.put(first.rev, { office: 'A' });
  assert.equal(await status(data.put(first.rev, { office: 'B' })), 409); // rev lama
  assert.equal(await status(data.put(data.get().rev, [1])), 400);
  assert.equal(JSON.parse(await readFile(join(dir, 'aplikasi.json'), 'utf8')).office, 'A');
});
