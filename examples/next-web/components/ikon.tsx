// Ikon yang tidak ada di Lucide, dibuat dengan gaya yang sama.
import { createLucideIcon } from 'lucide-react';

/** Mesin absensi: badan, layar, sensor jari. */
export const Mesin = createLucideIcon('mesin', [
  ['rect', { x: '5', y: '2', width: '14', height: '20', rx: '2', key: 'badan' }],
  ['rect', { x: '8', y: '5', width: '8', height: '6', rx: '1', key: 'layar' }],
  ['path', { d: 'M10 18.5v-2a2 2 0 0 1 4 0v2', key: 'sensor' }],
]);
