import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { AccessToken } from 'livekit-server-sdk';
import type {
  AvatarState, ChatMessage, ClientMsg, Mode, Note, Participant, ServerMsg,
} from '../shared/protocol.ts';
import { ROOM_HALF } from '../shared/protocol.ts';

const PORT = Number(process.env.SERVER_PORT ?? 3001);
const ROOM_NAME = 'tonarium';
const DEV = process.argv.includes('--dev');
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');

// ---- 部屋の状態（メモリ内・1部屋のみ） ----
const participants = new Map<string, Participant>();
const sockets = new Map<string, Set<WebSocket>>(); // 同一IDの複数タブに対応
const chat: ChatMessage[] = [];
const notes = new Map<string, Note>();
const avatars = new Map<string, AvatarState>();

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: ServerMsg, except?: WebSocket) {
  const data = JSON.stringify(msg);
  for (const set of sockets.values())
    for (const ws of set) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
}
function pushChat(from: Participant | null, text: string) {
  const m: ChatMessage = { id: randomUUID(), from: from?.id ?? null, fromName: from?.name ?? '', text, at: Date.now() };
  chat.push(m);
  if (chat.length > 500) chat.shift();
  broadcast({ t: 'chat', m });
}
function broadcastParticipants() {
  broadcast({ t: 'participants', list: [...participants.values()] });
}
const modeLabel = (m: Mode) => (m === '3d' ? '3D' : '2D');
const clamp = (v: number) => Math.max(-ROOM_HALF + 0.5, Math.min(ROOM_HALF - 0.5, v));

function handle(ws: WebSocket, state: { id: string | null }, msg: ClientMsg) {
  if (msg.t === 'hello') {
    state.id = msg.id;
    const isNew = !participants.has(msg.id);
    participants.set(msg.id, { id: msg.id, name: msg.name.slice(0, 24) || 'ゲスト', mode: msg.mode });
    if (!sockets.has(msg.id)) sockets.set(msg.id, new Set());
    sockets.get(msg.id)!.add(ws);
    send(ws, {
      t: 'snapshot',
      s: {
        participants: [...participants.values()],
        chat,
        notes: [...notes.values()],
        avatars: Object.fromEntries(avatars),
      },
    });
    broadcastParticipants();
    if (isNew) pushChat(null, `${participants.get(msg.id)!.name} が ${modeLabel(msg.mode)} で参加しました`);
    return;
  }
  const me = state.id ? participants.get(state.id) : undefined;
  if (!me) return;

  switch (msg.t) {
    case 'mode': {
      if (me.mode === msg.mode) return;
      me.mode = msg.mode;
      if (msg.mode === '2d' && avatars.delete(me.id)) broadcast({ t: 'avatarRemove', id: me.id });
      broadcastParticipants();
      pushChat(null, `${me.name} が ${modeLabel(msg.mode)} に切り替えました`);
      return;
    }
    case 'chat': {
      const text = msg.text.trim().slice(0, 1000);
      if (text) pushChat(me, text);
      return;
    }
    case 'avatar': {
      const s = { x: clamp(msg.s.x), z: clamp(msg.s.z), ry: msg.s.ry };
      avatars.set(me.id, s);
      broadcast({ t: 'avatar', id: me.id, s }, ws);
      return;
    }
    case 'noteCreate': {
      const n: Note = {
        id: randomUUID(),
        text: msg.note.text.slice(0, 300),
        color: msg.note.color,
        x: clamp(msg.note.x), z: clamp(msg.note.z), ry: msg.note.ry,
        createdBy: me.id, updatedBy: me.id, updatedAt: Date.now(), editingBy: null,
      };
      notes.set(n.id, n);
      broadcast({ t: 'note', note: n });
      pushChat(null, `${me.name} が付箋を追加しました（${modeLabel(me.mode)}）`);
      return;
    }
    case 'noteUpdate': {
      const n = notes.get(msg.id);
      if (!n) return;
      // 最後の変更を採用。他人が編集ロック中でも位置・内容の上書きは許す（プロトタイプの簡易方式）
      const p = msg.patch;
      if (p.text !== undefined) n.text = p.text.slice(0, 300);
      if (p.color !== undefined) n.color = p.color;
      if (p.x !== undefined) n.x = clamp(p.x);
      if (p.z !== undefined) n.z = clamp(p.z);
      if (p.ry !== undefined) n.ry = p.ry;
      n.updatedBy = me.id;
      n.updatedAt = Date.now();
      broadcast({ t: 'note', note: n });
      return;
    }
    case 'noteLock': {
      const n = notes.get(msg.id);
      if (!n) return;
      if (msg.lock) n.editingBy = me.id;
      else if (n.editingBy === me.id) n.editingBy = null;
      broadcast({ t: 'note', note: n });
      return;
    }
    case 'noteDelete': {
      if (notes.delete(msg.id)) {
        broadcast({ t: 'noteDelete', id: msg.id });
        pushChat(null, `${me.name} が付箋を削除しました`);
      }
      return;
    }
  }
}

function onClose(ws: WebSocket, id: string | null) {
  if (!id) return;
  const set = sockets.get(id);
  set?.delete(ws);
  if (set && set.size > 0) return;
  sockets.delete(id);
  const p = participants.get(id);
  participants.delete(id);
  if (avatars.delete(id)) broadcast({ t: 'avatarRemove', id });
  for (const n of notes.values())
    if (n.editingBy === id) { n.editingBy = null; broadcast({ t: 'note', note: n }); }
  broadcastParticipants();
  if (p) pushChat(null, `${p.name} が退出しました`);
}

// ---- HTTP: LiveKitトークン発行 + ビルド済みクライアント配信 ----
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/token') {
    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    const id = url.searchParams.get('id');
    const name = url.searchParams.get('name') ?? '';
    res.setHeader('Content-Type', 'application/json');
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !id) {
      res.end(JSON.stringify({ error: 'LiveKit が未設定です (.env)' }));
      return;
    }
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: id, name, ttl: '12h' });
    at.addGrant({ roomJoin: true, room: ROOM_NAME, canPublish: true, canSubscribe: true, canPublishData: true });
    res.end(JSON.stringify({ url: LIVEKIT_URL, token: await at.toJwt() }));
    return;
  }
  // npm run dev 中は古いビルドを出さず Vite の開発サーバーへ送る
  if (DEV) {
    res.writeHead(302, { Location: `http://localhost:5173${url.pathname}${url.search}` });
    res.end();
    return;
  }
  // 静的配信（npm start 時）
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    res.end('client not built. run `npm run dev` and open http://localhost:5173');
    return;
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
  // assets/ はハッシュ付きなので長期キャッシュ可。index.html は毎回取り直させる
  res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const state = { id: null as string | null };
  ws.on('message', (raw) => {
    try { handle(ws, state, JSON.parse(String(raw)) as ClientMsg); }
    catch (e) { console.error('bad message', e); }
  });
  ws.on('close', () => onClose(ws, state.id));
});

server.listen(PORT, () => {
  console.log(`server on http://localhost:${PORT}`);
  if (!process.env.LIVEKIT_URL) console.warn('LIVEKIT_* が未設定: 音声・画面共有は無効になります');
});
