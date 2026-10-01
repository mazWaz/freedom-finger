// POST /api/xlsx: tabel dari halaman -> file Excel (lib/server/xlsx.ts).
import { HttpError, readBody } from '@/lib/server/http.ts';
import { guarded } from '@/lib/server/session.ts';
import { workbook, type Sheet } from '@/lib/server/xlsx.ts';

export const POST = guarded(async (req) => {
  const { sheets } = await readBody(req);
  if (!Array.isArray(sheets)) throw new HttpError(400, 'sheets harus daftar tabel.');
  const file = await workbook(sheets as Sheet[]).catch((e: Error) => {
    throw new HttpError(400, `Tabel tidak bisa dijadikan Excel: ${e.message}`);
  });
  return new Response(file, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
});
