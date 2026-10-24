// インストールできるようにするだけで、キャッシュはしない（更新がいつもすぐ届くように）。
// つながらないときと、デプロイ中で前段のプロキシがエラーを返すときだけ、ページの代わりに案内を出す
const page = (title, body, retry) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tonarium</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#EAE5DB;color:#26262E;font-family:sans-serif;text-align:center;padding:16px;box-sizing:border-box}p{color:#5E5C64;line-height:1.6}button{margin-top:16px;padding:10px 20px;border:0;border-radius:12px;background:#2F5FC4;color:#fff;font-size:15px}</style></head>
<body><div><img src="/brand/mark.png" alt="" width="56" height="56" onerror="this.remove()"><h1 style="font-size:20px">${title}</h1><p>${body}</p><button onclick="location.reload()">再読み込み</button></div>
${retry ? '<script>setTimeout(() => location.reload(), 5000)</script>' : ''}</body></html>`;
const OFFLINE = page('接続できません', 'インターネットにつながってから、もう一度開いてください。', false);
const MAINTENANCE = page('メンテナンス中です', 'アップデートなどの作業をしています。終わると自動で開きます。', true);
const html = (s) => new Response(s, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).then(
    // npm run dev の案内（503）はそのまま見せる
    (r) => ([502, 503, 504].includes(r.status) && !r.headers.has('X-Tonarium-Dev') ? html(MAINTENANCE) : r),
    () => html(OFFLINE),
  ));
});
