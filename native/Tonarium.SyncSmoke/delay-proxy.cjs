const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');
const target = new URL(process.argv[3] || 'http://localhost:3015');
const delay = Number(process.argv[4] || 20);
const active = new Set();
const server = http.createServer((req, res) => {
  if (req.url === '/__drop-sync') { for (const socket of active) socket.terminate(); res.end('dropped'); return; }
  const upstream = http.request(new URL(req.url, target), { method: req.method, headers: { ...req.headers, host: target.host } }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
});
const sockets = new WebSocketServer({ server });
sockets.on('connection', (downstream, request) => {
  if (request.url.startsWith('/sync/ws')) { active.add(downstream); downstream.on('close', () => active.delete(downstream)); }
  const upstream = new WebSocket(target.href.replace(/^http/, 'ws').replace(/\/$/, '') + request.url, { headers: { Origin: target.origin } });
  const waiting = [];
  upstream.on('open', () => { for (const [data, binary] of waiting) upstream.send(data, { binary }); });
  downstream.on('message', (data, binary) => setTimeout(() => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
    else if (upstream.readyState === WebSocket.CONNECTING) waiting.push([data, binary]);
  }, delay));
  upstream.on('message', (data, binary) => setTimeout(() => { if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary }); }, delay));
  downstream.on('close', () => upstream.close()); upstream.on('close', () => downstream.close());
  upstream.on('error', () => downstream.close()); downstream.on('error', () => upstream.close());
});
server.listen(Number(process.argv[2] || 31327), '127.0.0.1', () => console.log(`Sync probe proxy: ${delay} ms each way`));
