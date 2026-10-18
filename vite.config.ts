import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function allowedHosts(value: string | undefined): string[] | true {
  const list = (value ?? '.trycloudflare.com').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes('*') ? true : list;
}

export default defineConfig(({ mode }) => {
  // root は client/ だが .env はサーバーと同じリポジトリ直下にある
  const env = loadEnv(mode, ROOT, '');
  return {
    root: 'client',
    // .env の変更でも再起動させる。クライアントに渡るのは VITE_ 付きだけ
    envDir: ROOT,
    plugins: [react()],
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
      port: 5173,
      allowedHosts: allowedHosts(env.ALLOWED_HOSTS),
      proxy: {
        '/token': 'http://localhost:3001',
        '/ws': { target: 'ws://localhost:3001', ws: true },
      },
    },
  };
});
