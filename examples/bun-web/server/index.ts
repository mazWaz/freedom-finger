// Freedom Finger versi web: dashboard absensi di browser, untuk server kantor yang menyala terus.
// `bun run dev` (dengan hot reload) atau `bun run build && bun run start` (produksi).
import { start } from './app.ts';
import { loadConfig } from './config.ts';

const cfg = loadConfig();
const server = await start(cfg);
console.log(`Freedom Finger web: ${server.url}\nServer Freedom Finger: ${cfg.ffUrl}\nFolder data: ${cfg.dataDir}`);
