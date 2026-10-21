// インストールできるようにするだけで、キャッシュはしない（更新がいつもすぐ届くように）。
// つながらないときだけ、ページの代わりに案内を出す
const OFFLINE = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tonarium</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#EAE5DB;color:#26262E;font-family:sans-serif;text-align:center}button{margin-top:16px;padding:10px 20px;border:0;border-radius:12px;background:#2F5FC4;color:#fff;font-size:15px}</style></head>
<body><div><h1 style="font-size:20px">接続できません</h1><p>インターネットにつながってから、もう一度開いてください。</p><button onclick="location.reload()">再読み込み</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
