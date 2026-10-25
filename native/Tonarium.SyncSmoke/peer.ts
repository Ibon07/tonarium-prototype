import WebSocket from 'ws';
import readline from 'node:readline';
import { KokosyncClient } from '../../vendor/kokosync/index.js';
import { importKey, open, seal, sendPacket, receiveBlob, PACKET_TOPIC, type SyncConfig, type Envelope } from '../../shared/session-wire.ts';

// A separate process keeps producing traffic when the native UI dispatcher stalls.
const base = process.argv[2], id = crypto.randomUUID();
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const home = new WebSocket(base.replace('http', 'ws') + '/ws');
await new Promise<void>((resolve, reject) => { home.once('open', resolve); home.once('error', reject); });
const configured = new Promise<SyncConfig>(resolve => home.on('message', raw => {
  const message = JSON.parse(String(raw));
  if (message.t === 'syncConfig') resolve(message.config);
}));
for (const message of [
  { t: 'hello', id, name: 'Independent load sender', compat: 1 },
  { t: 'join', sid: 'sync-load' },
  { t: 'prepareSync', requestId: id, peerPositions: false, peerDelivery: false },
]) home.send(JSON.stringify(message));
const config = await configured, key = await importKey(config.key);
const client = await KokosyncClient.connect({
  url: base, room: config.room, peer: config.peer, transport: 'websocket',
  websocketUrl: `/sync/ws?token=${config.token}`, routing: { enabled: false },
  websocketFactory: url => new WebSocket(url, { origin: base }) as unknown as globalThis.WebSocket,
});
let sequence = 0, positionSequence = 0;
const send = async (message: object) => sendPacket(client, config.server, await seal(key, config.token, 'client', ++sequence, message));
let complete!: () => void;
const synced = new Promise<void>(resolve => { complete = resolve; });
async function receive(value: unknown, peer: string) {
  const packet = value as Envelope;
  if (peer !== config.server || packet?.grant !== config.token) return;
  const decoded = await open(key, config.token, 'server', packet);
  if (decoded.value.kind === 'snapshot') complete();
}
client.on('message', frame => { if (frame.topic === PACKET_TOPIC) void receive(frame.value as unknown as Envelope, frame.peer); });
client.on('blob_open', frame => void receiveBlob(client, frame, peer => peer === config.server, receive));
await send({ t: 'sync' }); await synced;
await send({ t: 'mode', mode: '3d' });
async function position(x: number) {
  const packet = await seal(key, config.token, 'client-position', ++positionSequence, { t: 'avatar', s: { x: x / 100, z: 2, ry: 0 } });
  client.latest(PACKET_TOPIC, packet as any, BigInt(positionSequence));
}
await position(-1);
console.log(JSON.stringify({ ready: true, id }));
for await (const command of readline.createInterface({ input: process.stdin })) {
  if (command === 'saturate') {
    for (let i = 0; i < 300; i++) await send({ t: 'itemAction', id: 'load-note', action: { a: 'noteEdit', text: 'limit-' + i } });
    console.log(JSON.stringify({ operations: 300 }));
  }
  if (command === 'blob') {
    await send({ t: 'chat', text: 'large-blob', image: 'data:image/png;base64,' + 'A'.repeat(1_500_000), scope: 'all' });
    await send({ t: 'itemAction', id: 'load-note', action: { a: 'noteEdit', text: 'after-blob' } });
    console.log(JSON.stringify({ blob: true }));
  }
  if (command === 'positions') {
    for (let i = 0; i < 300; i++) { await position(i % 150); await pause(10); }
    console.log(JSON.stringify({ positions: 300 }));
  }
  if (command === 'burst') {
    const started = Date.now();
    for (let i = 0; i < 150; i++) {
      await position(i);
      if (i % 12 === 0 && i / 12 < 12) {
        const n = i / 12;
        await send({ t: 'chat', text: 'load-' + n, scope: 'all' });
        await send({ t: 'itemAction', id: 'load-note', action: { a: 'noteEdit', text: 'edit-' + n } });
      }
      await pause(10);
    }
    console.log(JSON.stringify({ positions: 150, chats: 12, operations: 12, durationMs: Date.now() - started }));
  }
}
client.close(); home.close();
