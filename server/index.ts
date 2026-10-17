import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { AccessToken } from 'livekit-server-sdk';
import type {
  AvatarState, ChatMessage, ClientMsg, GuildConfig, Mode, Note, ServerMsg, User,
} from '../shared/protocol.ts';
import { ROOM_HALF, sessionChatKey } from '../shared/protocol.ts';
import { ITEM_INFO, applyItemAction, createItem, type Item } from '../shared/items.ts';

const PORT = Number(process.env.SERVER_PORT ?? 3001);
const DEV = process.argv.includes('--dev');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'client/dist');

// ---- チャンネル構成（channels.json。起動時に読み込む） ----
const guild = JSON.parse(fs.readFileSync(path.join(ROOT, 'channels.json'), 'utf-8')) as GuildConfig;
const allChannels = guild.categories.flatMap((c) => c.channels);
const sessionIds = new Set(allChannels.filter((c) => c.type === 'session').map((c) => c.id));
const textIds = new Set(allChannels.filter((c) => c.type === 'text').map((c) => c.id));
/** LiveKit 上のルーム名 */
const livekitRoom = (sid: string) => `tonarium-${sid}`;

// ---- 状態（メモリ内） ----
const users = new Map<string, User>();
const sockets = new Map<string, Set<WebSocket>>(); // 同一IDの複数タブに対応
const chats = new Map<string, ChatMessage[]>();
const notes = new Map<string, Map<string, Note>>(); // sid -> notes
const avatars = new Map<string, Map<string, AvatarState>>(); // sid -> avatars
const items = new Map<string, Map<string, Item>>(); // sid -> items
for (const id of textIds) chats.set(id, []);
for (const sid of sessionIds) {
  chats.set(sessionChatKey(sid), []);
  notes.set(sid, new Map());
  avatars.set(sid, new Map());
  items.set(sid, new Map());
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: ServerMsg, except?: WebSocket) {
  const data = JSON.stringify(msg);
  for (const set of sockets.values())
    for (const ws of set) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
}
function pushChat(ch: string, from: User | null, text: string) {
  const list = chats.get(ch);
  if (!list) return;
  const m: ChatMessage = { id: randomUUID(), from: from?.id ?? null, fromName: from?.name ?? '', text, at: Date.now() };
  list.push(m);
  if (list.length > 500) list.shift();
  broadcast({ t: 'chat', ch, m });
}
const broadcastUsers = () => broadcast({ t: 'users', list: [...users.values()] });
const modeLabel = (m: Mode) => (m === '3d' ? '3D' : '2D');
const clamp = (v: number) => Math.max(-ROOM_HALF + 0.5, Math.min(ROOM_HALF - 0.5, v));

/** セッションから抜ける（退出・別セッションへの移動・切断で共通） */
function leaveSession(u: User) {
  const sid = u.session;
  if (!sid) return;
  const av = avatars.get(sid)!.get(u.id);
  if (avatars.get(sid)!.delete(u.id)) broadcast({ t: 'avatarRemove', sid, id: u.id });
  for (const n of notes.get(sid)!.values())
    if (n.editingBy === u.id) { n.editingBy = null; broadcast({ t: 'note', sid, note: n }); }
  // 持っていたハンマーはその場（3Dにいればアバターの位置）に落とす
  for (const it of items.get(sid)!.values())
    if (it.kind === 'hammer' && it.holder === u.id) {
      it.holder = null;
      if (av) { it.x = av.x; it.z = av.z; }
      broadcast({ t: 'item', sid, item: it });
    }
  u.session = null;
  u.mode = '2d';
  u.micOn = false;
  u.sharing = false;
  pushChat(sessionChatKey(sid), null, `${u.name} が退出しました`);
}

function handle(ws: WebSocket, state: { id: string | null }, msg: ClientMsg) {
  if (msg.t === 'hello') {
    state.id = msg.id;
    if (!users.has(msg.id))
      users.set(msg.id, { id: msg.id, name: msg.name.slice(0, 24) || 'ゲスト', session: null, mode: '2d', micOn: false, sharing: false });
    if (!sockets.has(msg.id)) sockets.set(msg.id, new Set());
    sockets.get(msg.id)!.add(ws);
    send(ws, {
      t: 'snapshot',
      s: {
        guild,
        users: [...users.values()],
        chats: Object.fromEntries(chats),
        notes: Object.fromEntries([...notes].map(([sid, m]) => [sid, [...m.values()]])),
        avatars: Object.fromEntries([...avatars].map(([sid, m]) => [sid, Object.fromEntries(m)])),
        items: Object.fromEntries([...items].map(([sid, m]) => [sid, [...m.values()]])),
      },
    });
    broadcastUsers();
    return;
  }
  const me = state.id ? users.get(state.id) : undefined;
  if (!me) return;
  const sid = me.session;

  switch (msg.t) {
    case 'join': {
      if (!sessionIds.has(msg.sid) || sid === msg.sid) return;
      leaveSession(me);
      me.session = msg.sid;
      me.mode = '2d';
      broadcastUsers();
      pushChat(sessionChatKey(msg.sid), null, `${me.name} が参加しました`);
      return;
    }
    case 'leave': {
      leaveSession(me);
      broadcastUsers();
      return;
    }
    case 'chat': {
      const text = msg.text.trim().slice(0, 1000);
      if (text) pushChat(msg.ch, me, text);
      return;
    }
  }

  // 以降はセッション内でのみ有効
  if (!sid) return;
  const sessNotes = notes.get(sid)!;
  const sessItems = items.get(sid)!;
  switch (msg.t) {
    case 'itemCreate': {
      if (!(msg.kind in ITEM_INFO)) return;
      const it = createItem(msg.kind, {
        id: randomUUID(), x: clamp(msg.x), z: clamp(msg.z), ry: msg.ry, createdBy: me.id,
      }, Math.random);
      sessItems.set(it.id, it);
      broadcast({ t: 'item', sid, item: it });
      const info = ITEM_INFO[msg.kind];
      pushChat(sessionChatKey(sid), null, `${me.name} が ${info.icon} ${info.name} を出しました`);
      return;
    }
    case 'itemRemove': {
      const it = sessItems.get(msg.id);
      if (!it || !sessItems.delete(msg.id)) return;
      broadcast({ t: 'itemRemove', sid, id: msg.id });
      const info = ITEM_INFO[it.kind];
      pushChat(sessionChatKey(sid), null, `${me.name} が ${info.icon} ${info.name} を片付けました`);
      return;
    }
    case 'itemMove': {
      const it = sessItems.get(msg.id);
      if (!it || (it.kind === 'hammer' && it.holder)) return;
      it.x = clamp(msg.x); it.z = clamp(msg.z); it.ry = msg.ry;
      broadcast({ t: 'item', sid, item: it });
      return;
    }
    case 'itemAction': {
      const it = sessItems.get(msg.id);
      if (!it) return;
      // ハンマーは1人1本まで
      if (msg.action.a === 'pick' && [...sessItems.values()].some((h) => h.kind === 'hammer' && h.holder === me.id)) return;
      if (msg.action.a === 'drop') { msg.action.x = clamp(msg.action.x); msg.action.z = clamp(msg.action.z); }
      if (applyItemAction(it, msg.action, me.id, Math.random)) broadcast({ t: 'item', sid, item: it });
      return;
    }
    case 'hit': {
      const holding = [...sessItems.values()].some((h) => h.kind === 'hammer' && h.holder === me.id);
      const target = users.get(msg.to);
      if (!holding || !target || target.session !== sid || target.id === me.id) return;
      broadcast({ t: 'hit', sid, from: me.id, to: target.id });
      return;
    }
    case 'mode': {
      if (me.mode === msg.mode) return;
      me.mode = msg.mode;
      if (msg.mode === '2d' && avatars.get(sid)!.delete(me.id)) broadcast({ t: 'avatarRemove', sid, id: me.id });
      broadcastUsers();
      pushChat(sessionChatKey(sid), null, `${me.name} が ${modeLabel(msg.mode)} に切り替えました`);
      return;
    }
    case 'status': {
      if (me.micOn === msg.micOn && me.sharing === msg.sharing) return;
      me.micOn = msg.micOn;
      me.sharing = msg.sharing;
      broadcastUsers();
      return;
    }
    case 'avatar': {
      if (me.mode !== '3d') return;
      const s = { x: clamp(msg.s.x), z: clamp(msg.s.z), ry: msg.s.ry };
      avatars.get(sid)!.set(me.id, s);
      broadcast({ t: 'avatar', sid, id: me.id, s }, ws);
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
      sessNotes.set(n.id, n);
      broadcast({ t: 'note', sid, note: n });
      pushChat(sessionChatKey(sid), null, `${me.name} が付箋を追加しました（${modeLabel(me.mode)}）`);
      return;
    }
    case 'noteUpdate': {
      const n = sessNotes.get(msg.id);
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
      broadcast({ t: 'note', sid, note: n });
      return;
    }
    case 'noteLock': {
      const n = sessNotes.get(msg.id);
      if (!n) return;
      if (msg.lock) n.editingBy = me.id;
      else if (n.editingBy === me.id) n.editingBy = null;
      broadcast({ t: 'note', sid, note: n });
      return;
    }
    case 'noteDelete': {
      if (sessNotes.delete(msg.id)) {
        broadcast({ t: 'noteDelete', sid, id: msg.id });
        pushChat(sessionChatKey(sid), null, `${me.name} が付箋を削除しました`);
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
  const u = users.get(id);
  if (u) leaveSession(u);
  users.delete(id);
  broadcastUsers();
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
    const sid = url.searchParams.get('session') ?? '';
    res.setHeader('Content-Type', 'application/json');
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      res.end(JSON.stringify({ error: 'LiveKit が未設定です (.env)' }));
      return;
    }
    if (!id || !sessionIds.has(sid)) {
      res.end(JSON.stringify({ error: '不正なリクエストです' }));
      return;
    }
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: id, name, ttl: '12h' });
    at.addGrant({ roomJoin: true, room: livekitRoom(sid), canPublish: true, canSubscribe: true, canPublishData: true });
    res.end(JSON.stringify({ url: LIVEKIT_URL, token: await at.toJwt() }));
    return;
  }
  // npm run dev 中は古いビルドを出さない。手元のブラウザなら Vite の開発サーバーへ送り、
  // トンネル越しなど外からのアクセスには 5173 をトンネルするよう案内する
  if (DEV) {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      res.writeHead(302, { Location: `http://localhost:5173${url.pathname}${url.search}` });
      res.end();
    } else {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('npm run dev 中です。トンネルは http://localhost:5173 に向けるか、npm start で起動して 3001 をトンネルしてください。');
    }
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
  console.log(`channels: ${allChannels.map((c) => `${c.type === 'text' ? '#' : '🔊'}${c.name}`).join(' ')}`);
  if (!process.env.LIVEKIT_URL) console.warn('LIVEKIT_* が未設定: 音声・画面共有は無効になります');
});
