import type { NextConfig } from 'next';

const config: NextConfig = {
  // .next/standalone: server.js dan hanya file node_modules yang dipakai, untuk image Docker kecil (Dockerfile)
  output: 'standalone',
  // exceljs memakai modul CommonJS Node: dimuat apa adanya, tidak dibundel
  serverExternalPackages: ['exceljs'],
  // hanya logo kecil, tanpa optimasi gambar: sharp tidak pernah dimuat (Dockerfile membuangnya dari image)
  images: { unoptimized: true },
  poweredByHeader: false,
  // `next dev` tidak menulis AGENTS.md dan CLAUDE.md ke folder contoh ini
  agentRules: false,
};

export default config;
