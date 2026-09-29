// Mesin simulasi: kirim satu absen (PIN acak, jam sekarang) ke server, seperti mesin di mode Internet.
//   npm run simulasi            (FKWEB_PORT bila bukan 8013)
const port = process.env.FKWEB_PORT ?? 8013;
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const io_time = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const pin = String(1 + Math.floor(Math.random() * 20));
// io_mode: aksi << 24 (1 masuk, 2 pulang); verify_mode: cara << 28 (1 jari)
const log = { fk_bin_data_lib: 'FKDataHS103', io_mode: 1 << 24, io_time, log_image: null, user_id: pin, verify_mode: 1 << 28 };
const text = Buffer.from(`${JSON.stringify(log)}\0`);
const len = Buffer.alloc(4);
len.writeUInt32LE(text.length);
const r = await fetch(`http://127.0.0.1:${port}/`, {
  method: 'POST',
  headers: { request_code: 'realtime_glog', dev_id: 'MESIN01', trans_id: 'RTLogSendAction' },
  body: Buffer.concat([len, text]),
});
console.log(r.ok ? `✓ absen PIN ${pin} jam ${d.toLocaleTimeString('id')} terkirim` : `gagal: HTTP ${r.status}`);
