import type { NextConfig } from 'next';

const config: NextConfig = {
  // exceljs memakai modul CommonJS Node: dimuat apa adanya, tidak dibundel
  serverExternalPackages: ['exceljs'],
  poweredByHeader: false,
  // `next dev` tidak menulis AGENTS.md dan CLAUDE.md ke folder contoh ini
  agentRules: false,
};

export default config;
