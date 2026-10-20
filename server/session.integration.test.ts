import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { WebSocket } from 'ws';
import { KokosyncClient } from '../vendor/kokosync/index.js';
import { importKey, open, PACKET_TOPIC, receiveBlob, seal, sendPacket, unpack, type Envelope, type SyncConfig } from '../shared/session-wire.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined, timeout = 45_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = read(); if (value !== undefined) return value; await delay(30); }
  throw new Error('Timed out waiting for session data');
}

test('live kokosync: initial canvas, deltas, private delivery, independent media and reconnect', { skip: process.env.KOKOSYNC_INTEGRATION !== '1', timeout: 180_000 }, async (t) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const data = await mkdtemp(path.join(os.tmpdir(), 'tonarium-sync-'));
  const canvas = { id: 'large-canvas', kind: 'canvas', x: 0, z: 0, ry: 0, createdBy: 'seed', updatedBy: 'seed',
    strokes: Array.from({ length: 600 }, (_, i) => ({ id: `line-${i}`, by: 'seed', color: '#334455', size: 3, pts: Array.from({ length: 100 }, (_, n) => (n * 3) % 400) })) };
  const sessions = [{ id: 'sync-test', name: 'Sync test' }, { id: 'other-test', name: 'Other test' }];
  await writeFile(path.join(data, 'sessions.json'), JSON.stringify({ name: 'test', sessions }));
  await writeFile(path.join(data, 'items.json'), JSON.stringify({ 'sync-test': [canvas] }));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, SERVER_PORT: String(port), DATA_DIR: data, SESSIONS_FILE: path.join(data, 'sessions.json'), LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => { child.kill(); await until(() => child.exitCode !== null || child.signalCode ? true : undefined, 10_000).catch(() => child.kill('SIGKILL')); await rm(data, { recursive: true, force: true }); });
  await until(() => logs.includes('server on') ? true : undefined);

  async function peer(name: string, sid = 'sync-test', previous?: { home: WebSocket; id: string }) {
    const home = previous?.home ?? new WebSocket(base.replace('http', 'ws') + '/ws');
    t.after(() => home.close());
    const messages: any[] = [], raw: any[] = [];
    home.on('message', (bytes) => messages.push(JSON.parse(bytes.toString())));
    if (!previous) await new Promise<void>((resolve, reject) => { home.once('open', resolve); home.once('error', reject); });
    const id = previous?.id ?? crypto.randomUUID();
    if (!previous) {
      home.send(JSON.stringify({ t: 'hello', id, name }));
      home.send(JSON.stringify({ t: 'join', sid }));
    }
    const requestId = crypto.randomUUID();
    home.send(JSON.stringify({ t: 'prepareSync', requestId }));
    const reply = await until(() => messages.find((m) => m.requestId === requestId));
    assert.equal(reply.t, 'syncConfig', JSON.stringify(reply));
    const cfg: SyncConfig = reply.config;
    const key = await importKey(cfg.key);
    const client = await KokosyncClient.connect({ url: base, room: cfg.room, peer: cfg.peer, transport: 'websocket', timeout: 45_000,
      websocketUrl: `/sync/ws?token=${cfg.token}`, websocketFactory: (u) => new WebSocket(u, { origin: base }) as unknown as globalThis.WebSocket });
    t.after(() => client.close());
    const received: any[] = [];
    const receive = async (p: unknown, sender: string, latest = false) => {
      if (sender !== cfg.server || (p as Envelope)?.grant !== cfg.token) return;
      const decoded = await open(key, cfg.token, latest ? 'server-position' : 'server', p);
      received.push(decoded.value);
    };
    client.on('message', async (f) => { raw.push(f); if (f.topic === PACKET_TOPIC) await receive(f.value, f.peer); });
    client.on('latest', (f) => receive(f.value, f.peer, true));
    let pause: { started: () => void; wait: Promise<void> } | null = null;
    const pauseNextBlob = () => {
      let release!: () => void, started!: () => void;
      const beginning = new Promise<void>((resolve) => { started = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      pause = { started, wait };
      t.after(release);
      return { beginning, release };
    };
    client.on('blob_open', (f) => {
      if (!pause || f.peer !== cfg.server) return receiveBlob(client, f, (sender) => sender === cfg.server, receive);
      const hold = pause; pause = null;
      const bytes = new Uint8Array(Number(f.size)); let offset = 0;
      hold.started();
      return client.acceptBlob(f as any, {
        async write(chunk) { await hold.wait; bytes.set(chunk, offset); offset += chunk.length; },
        async close() { await receive(unpack(bytes), f.peer); },
      }).then(() => {});
    });
    let seq = 0;
    const send = async (msg: unknown) => sendPacket(client, cfg.server, await seal(key, cfg.token, 'client', ++seq, msg));
    await send({ t: 'sync' });
    const snapshot = await until(() => received.find((v) => v.kind === 'snapshot'));
    return { id, home, homeMessages: messages, client, cfg, key, received, raw, send, pauseNextBlob, snapshot: snapshot.snapshot };
  }
  const a = await peer('sync-a');
  assert.equal(a.snapshot.items[0].strokes.length, 600);
  assert.ok(JSON.stringify(a.snapshot).length > 100_000);
  const b = await peer('sync-b');
  assert.deepEqual(b.snapshot.items[0], canvas);
  a.home.send(JSON.stringify({ t: 'friendRequest', to: b.id }));
  await until(() => b.homeMessages.find((m) => m.t === 'friendRequest' && m.from === a.id));
  b.home.send(JSON.stringify({ t: 'friendAccept', to: a.id }));
  await until(() => a.homeMessages.find((m) => m.t === 'friends' && m.names.includes('sync-b')));
  a.home.send(JSON.stringify({ t: 'msg', conv: 'dm:sync-a\u0000sync-b', text: 'home websocket DM' }));
  await until(() => b.homeMessages.find((m) => m.t === 'msg' && m.m.text === 'home websocket DM'));
  await a.send({ t: 'chat', text: 'room hello', scope: 'all' });
  await until(() => b.received.find((v) => v.message?.m?.text === 'room hello'));
  await a.send({ t: 'itemAction', id: 'large-canvas', action: { a: 'strokeStart', id: 'new-line', color: '#ffffff', size: 2, x: 1, y: 2 } });
  await until(() => b.received.find((v) => v.message?.action?.id === 'new-line'));
  await a.send({ t: 'mode', mode: '3d' });
  a.client.latest(PACKET_TOPIC, await seal(a.key, a.cfg.token, 'client-position', 1, { t: 'avatar', s: { x: 2, z: 3, ry: 0 } }) as any, 1n);
  await until(() => b.received.find((v) => v.t === 'avatar' && v.id === a.id && v.s.x === 2));
  await a.send({ t: 'poke', to: b.id });
  const poke = await until(() => b.received.find((v) => v.message?.t === 'poke'));
  assert.equal(poke.message.from, a.id);
  const privateFrame = await until(() => a.raw.find((f) => f.peer === b.cfg.server && f.value?.grant === b.cfg.token));
  await assert.rejects(open(a.key, b.cfg.token, 'server', privateFrame.value));
  const image = 'data:image/png;base64,' + 'A'.repeat(240_000);
  const hold = b.pauseNextBlob();
  await a.send({ t: 'chat', text: 'large attachment', image, scope: 'all' });
  await hold.beginning;
  a.client.latest(PACKET_TOPIC, await seal(a.key, a.cfg.token, 'client-position', 2, { t: 'avatar', s: { x: 4, z: 3, ry: 0 } }) as any, 2n);
  await until(() => b.received.find((v) => v.t === 'avatar' && v.id === a.id && v.s.x === 4));
  assert.equal(b.received.some((v) => v.message?.m?.image === image), false, 'position arrives while the blob receiver is paused');
  hold.release();
  await until(() => b.received.find((v) => v.message?.m?.image === image));
  await a.send({ t: 'sync' });
  await until(() => a.received.find((v) => v.kind === 'snapshot' && v.snapshot.chats.some((c: any) => c.text === 'large attachment')));
  const media = await (await fetch(`${base}/token?id=${a.id}&session=sync-test`)).json() as any;
  assert.match(media.error, /LiveKit/);
  await b.send({ t: 'chat', text: 'without media', scope: 'all' });
  await until(() => a.received.find((v) => v.message?.m?.text === 'without media'));
  b.client.close();
  const b2 = await peer('sync-b', 'sync-test', b);
  assert.equal(b2.id, b.id);
  assert.ok(b2.snapshot.chats.some((c: any) => c.text === 'without media'));
  assert.ok(b2.snapshot.items[0].strokes.some((s: any) => s.id === 'new-line'));
  const other = await peer('other', 'other-test');
  assert.ok(other.snapshot.items.every((v: any) => v.id !== 'large-canvas'));
  const replay = await seal(b2.key, b2.cfg.token, 'client', 100, { t: 'chat', text: 'once only', scope: 'all' });
  await sendPacket(b2.client, b2.cfg.server, replay);
  await sendPacket(b2.client, b2.cfg.server, replay);
  await until(() => a.received.find((v) => v.message?.m?.text === 'once only'));
  await delay(100);
  assert.equal(a.received.filter((v) => v.message?.m?.text === 'once only').length, 1);
  a.home.send(JSON.stringify({ t: 'leave' }));
  await delay(150);
  const denied = await fetch(`${base}/sync/offer`, { method: 'POST', headers: { Origin: base, 'X-Tonarium-Sync': a.cfg.token }, body: '{}' });
  assert.equal(denied.status, 403);
  t.diagnostic(`Confirmed ${JSON.stringify(a.snapshot).length} byte initial canvas and 240 KB attachment on ${process.env.KOKOSYNC_URL || 'default endpoint'}`);
});
