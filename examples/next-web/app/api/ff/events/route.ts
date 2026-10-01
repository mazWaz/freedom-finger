// GET /api/ff/events: event realtime Freedom Finger (SSE: absen baru, hasil perintah), diteruskan
// selama halaman tersambung.
import { upstream } from '@/lib/server/ff.ts';
import { guarded } from '@/lib/server/session.ts';

export const GET = guarded(async (req) => upstream('/api/events', { signal: req.signal }));
