// GET /api/status: IP dan port server Freedom Finger, untuk isian menu Jaringan di mesin.
import { upstream } from '@/lib/server/ff.ts';
import { guarded } from '@/lib/server/session.ts';

export const GET = guarded(async () => upstream('/status.json'));
