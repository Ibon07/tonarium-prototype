import fs from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { decode } from '@msgpack/msgpack';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { KokosyncClient, type Value } from '../vendor/kokosync/index.js';
import { isRoomClientMsg, type RoomClientMsg, type RoomServerMsg, type SessionSnapshot } from '../shared/protocol.ts';
import { base64, importKey, MAX_PACKET, open, pack, PACKET_TOPIC, receiveBlob, seal, sealBytes, sendPacket, type Envelope, type SyncConfig } from '../shared/session-wire.ts';

export const livekitRoom = (sid: string) => `${process.env.LIVEKIT_ROOM_PREFIX || 'tonarium'}-${sid}`;
export interface RoomHandlers { onMessage(sid: string, from: string, msg: RoomClientMsg): void }
interface Grant {
  config: SyncConfig; user: string; owner: WebSocket; key: CryptoKey; active: boolean; revoked: boolean;
  sendSeq: number; received: number; positions: number;
  queued: number; output: Promise<void>; input: Promise<void>; reset(): void; sockets: Set<WebSocket>;
}
interface SessionRoom {
  client: KokosyncClient; room: string; peer: string; grants: Map<string, Grant>;
  blobQueue: Promise<void>; closed: boolean; latestSequence: number;
}
const rooms = new Map<string, SessionRoom>();
const connecting = new Map<string, Promise<SessionRoom>>();
const grants = new Map<string, Grant>();
const instance = crypto.randomUUID();
const url = () => process.env.KOKOSYNC_URL || 'https://45.77.130.146';
function headers(): Record<string, string> {
  let username = process.env.KOKOSYNC_USERNAME, password = process.env.KOKOSYNC_PASSWORD;
  const file = process.env.KOKOSYNC_CREDENTIALS_FILE;
  if (file && (!username || !password)) {
    const text = fs.readFileSync(file, 'utf8');
    username = text.match(/^Username:\s*(.+)$/m)?.[1].trim();
    password = text.match(/^Password:\s*(.+)$/m)?.[1].trim();
  }
  return username && password ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } : {};
}
function invalidate(g: Grant, notify = false) {
  if (g.revoked) return;
  g.revoked = true;
  grants.delete(g.config.token);
  for (const ws of g.sockets) ws.close(1000, 'Session ended');
  g.sockets.clear();
  if (notify) g.reset();
}
export function revokeSync(owner: WebSocket) {
  for (const g of grants.values()) if (g.owner === owner) invalidate(g);
}
export function revokeUserSync(id: string) {
  for (const g of grants.values()) if (g.user === id) invalidate(g);
}

export function ensureRoom(sid: string, handlers: RoomHandlers): Promise<SessionRoom> {
  const existing = rooms.get(sid);
  if (existing && !existing.closed) return Promise.resolve(existing);
  const pending = connecting.get(sid);
  if (pending) return pending;
  const task = connect(sid, handlers).finally(() => connecting.delete(sid));
  connecting.set(sid, task);
  return task;
}
async function connect(sid: string, handlers: RoomHandlers) {
  const name = `tonarium-${instance}-${sid}`;
  const peer = crypto.randomUUID();
  const client = await KokosyncClient.connect({
    url: url(), room: name, peer, transport: 'websocket', timeout: 45_000,
    websocketFactory: (u) => new WebSocket(u, { headers: headers(), maxPayload: 65536 }) as unknown as globalThis.WebSocket,
  });
  const r: SessionRoom = { client, room: name, peer, grants: new Map(), blobQueue: Promise.resolve(), closed: false, latestSequence: 0 };
  const receive = async (packet: unknown, from: string, latest = false) => {
    const p = packet as Envelope;
    const g = r.grants.get(p?.grant);
    if (!g || g.revoked || g.config.peer !== from || g.owner.readyState !== WebSocket.OPEN) return;
    const apply = async () => {
      const decoded = await open(g.key, g.config.token, latest ? 'client-position' : 'client', p);
      if (g.revoked || decoded.seq <= (latest ? g.positions : g.received)) return;
      const msg = decoded.value;
      if (!msg || typeof msg.t !== 'string' || !isRoomClientMsg(msg) || (latest && msg.t !== 'avatar')) return;
      if (latest) g.positions = decoded.seq;
      else g.received = decoded.seq;
      if (msg.t === 'sync') g.active = true;
      if (g.active) handlers.onMessage(sid, g.user, msg);
    };
    if (latest) await apply();
    else { const task = g.input.then(apply); g.input = task.catch(() => {}); await task; }
  };
  client.on('message', (f) => { if (f.topic === PACKET_TOPIC) return receive(f.value, f.peer).catch(() => {}); });
  client.on('latest', (f) => { if (f.key === PACKET_TOPIC) return receive(f.value, f.peer, true).catch(() => {}); });
  client.on('blob_open', (f) => receiveBlob(client, f, (p) => [...r.grants.values()].some((g) => !g.revoked && g.config.peer === p), receive).catch(() => {}));
  client.on('error', () => client.close());
  client.on('close', () => {
    r.closed = true;
    if (rooms.get(sid) === r) rooms.delete(sid);
    for (const g of r.grants.values()) invalidate(g, true);
  });
  rooms.set(sid, r);
  return r;
}

export async function createSyncGrant(sid: string, user: string, owner: WebSocket, handlers: RoomHandlers, reset: () => void, current: () => boolean = () => true): Promise<SyncConfig> {
  const r = await ensureRoom(sid, handlers);
  const token = crypto.randomUUID();
  const raw = base64(crypto.getRandomValues(new Uint8Array(32)));
  const key = await importKey(raw);
  const usedSlots = new Set([...r.grants.values()].filter((g) => !g.revoked && g.owner !== owner).map((g) => g.config.slot));
  const slot = Array.from({ length: 31 }, (_, i) => i).find((i) => !usedSlots.has(i));
  if (slot === undefined) throw new Error('セッションが満員です');
  const config = { sid, room: r.room, peer: crypto.randomUUID(), server: r.peer, token, key: raw, slot };
  const g: Grant = { config, user, owner, key, reset, active: false, revoked: false,
    sendSeq: 0, received: 0, positions: 0, queued: 0, output: Promise.resolve(), input: Promise.resolve(), sockets: new Set() };
  if (owner.readyState !== WebSocket.OPEN || r.closed || !current()) throw new Error('セッション接続が閉じました');
  revokeSync(owner);
  for (const [key, old] of r.grants) if (old.revoked) r.grants.delete(key);
  r.grants.set(token, g);
  grants.set(token, g);
  return config;
}

function queue(r: SessionRoom, g: Grant, bytes: Uint8Array) {
  if (g.revoked || !g.active) return;
  if (g.queued + bytes.length > MAX_PACKET * 2) { invalidate(g, true); return; }
  g.queued += bytes.length;
  g.output = g.output.then(async () => {
    if (g.revoked) return;
    const packet = await sealBytes(g.key, g.config.token, 'server', ++g.sendSeq, bytes);
    if (bytes.length > 48 * 1024) {
      // 部屋あたりの同時 Blob 数に余裕を残し、初回同期の集中を順番に処理する。
      const task = r.blobQueue.then(() => { if (!g.revoked) return sendPacket(r.client, g.config.peer, packet); });
      r.blobQueue = task.catch(() => {});
      await task;
    } else await sendPacket(r.client, g.config.peer, packet);
  }).catch(() => invalidate(g, true)).finally(() => { g.queued -= bytes.length; });
}

export function roomSend(sid: string, msg: RoomServerMsg, to?: string[]) {
  const r = rooms.get(sid);
  if (!r) return;
  const recipients = [...r.grants.values()].filter((g) => !g.revoked && g.active && (!to || to.includes(g.user)));
  if (msg.t === 'avatar') {
    const source = [...r.grants.values()].find((g) => !g.revoked && g.user === msg.id);
    if (!source) return;
    for (const g of recipients) {
      const seq = ++r.latestSequence;
      void seal(g.key, g.config.token, 'server-position', seq, msg).then((packet) => {
        if (!g.revoked) r.client.latest(`${PACKET_TOPIC}:${g.config.slot}:${source.config.slot}`, packet as unknown as Value, BigInt(seq));
      }).catch(() => {});
    }
  } else {
    const bytes = pack({ kind: 'message', message: msg });
    for (const g of recipients) queue(r, g, bytes);
  }
}
export function roomSendSnapshot(sid: string, id: string, snapshot: SessionSnapshot) {
  const r = rooms.get(sid);
  if (!r) return;
  const bytes = pack({ kind: 'snapshot', snapshot });
  for (const g of r.grants.values()) if (g.user === id) queue(r, g, bytes);
}
export async function leaveRoom(sid: string) {
  const pending = connecting.get(sid);
  const r = rooms.get(sid) ?? (pending ? await pending.catch(() => undefined) : undefined);
  if (!r) return;
  for (const g of r.grants.values()) invalidate(g);
  r.client.close();
}
export async function shutdownRooms() { await Promise.all([...new Set([...rooms.keys(), ...connecting.keys()])].map(leaveRoom)); }

function authorized(token: string | undefined) {
  const g = token ? grants.get(token) : undefined;
  return g && !g.revoked && g.owner.readyState === WebSocket.OPEN ? g : undefined;
}
function sameOrigin(req: IncomingMessage) {
  if (!req.headers.origin) return false;
  try {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host).split(',')[0].trim();
    return new URL(req.headers.origin).host === host;
  } catch { return false; }
}
export async function handleSyncOffer(req: IncomingMessage, res: ServerResponse) {
  const g = authorized(req.headers['x-tonarium-sync'] as string | undefined);
  if (req.method !== 'POST' || !sameOrigin(req) || !g) { res.writeHead(403).end(); return; }
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 128 * 1024) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const response = await fetch(new URL('/offer', url()), {
      method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
      body: Buffer.concat(chunks), signal: AbortSignal.timeout(15_000),
    });
    res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(await response.text());
  } catch { res.writeHead(502).end('kokosync に接続できません'); }
}

const proxy = new WebSocketServer({ noServer: true, maxPayload: 65536 });
export function upgradeSync(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const token = new URL(req.url!, 'http://local').searchParams.get('token') ?? undefined;
  const g = authorized(token);
  if (!g || !sameOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  proxy.handleUpgrade(req, socket, head, (downstream) => {
    const upstreamUrl = new URL('/ws', url());
    upstreamUrl.protocol = upstreamUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const upstream = new WebSocket(upstreamUrl, { headers: headers(), maxPayload: 65536 });
    g.sockets.add(downstream);
    g.sockets.add(upstream);
    let joined = false;
    downstream.pause();
    upstream.on('open', () => downstream.resume());
    downstream.on('message', (data, binary) => {
      if (!binary || g.revoked || upstream.readyState !== WebSocket.OPEN || upstream.bufferedAmount > 1024 * 1024) { downstream.close(1008); return; }
      if (!joined) {
        try {
          const frame = decode(data as Buffer) as Record<string, unknown>;
          if (frame.type !== 'join' || frame.room !== g.config.room || frame.peer !== g.config.peer) throw new Error();
          joined = true;
        } catch { downstream.close(1008); return; }
      }
      upstream.send(data, { binary: true });
    });
    upstream.on('message', (data) => {
      if (downstream.readyState !== WebSocket.OPEN) return;
      if (downstream.bufferedAmount > 1024 * 1024) { downstream.close(1013); return; }
      downstream.send(data, { binary: true });
    });
    const close = () => { g.sockets.delete(upstream); g.sockets.delete(downstream); upstream.close(); downstream.close(); };
    downstream.on('close', close); upstream.on('close', close);
    downstream.on('error', close); upstream.on('error', close);
  });
}
