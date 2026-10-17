import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** ALLOWED_HOSTS（カンマ区切り）を Vite の allowedHosts に変換。`*` なら全ホストを許可 */
function allowedHosts(value: string | undefined): string[] | true {
  const list = (value ?? '.trycloudflare.com').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes('*') ? true : list;
}

export default defineConfig(({ mode }) => {
  // サーバーと同じリポジトリ直下の .env を読む
  const env = loadEnv(mode, ROOT, '');
  return {
    root: 'client',
    // .env の変更で開発サーバーが再起動するように。クライアントに渡るのは VITE_ 付きの変数だけ
    envDir: ROOT,
    plugins: [react()],
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
      port: 5173,
      // トンネル経由など、localhost 以外から開発サーバーにアクセスするときのホスト
      allowedHosts: allowedHosts(env.ALLOWED_HOSTS),
      proxy: {
        '/token': 'http://localhost:3001',
        '/ws': { target: 'ws://localhost:3001', ws: true },
      },
    },
  };
});
