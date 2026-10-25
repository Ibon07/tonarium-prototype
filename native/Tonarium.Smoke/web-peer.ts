import WebSocket from 'ws';
import { KokosyncClient } from '../../vendor/kokosync/index.js';
import { importKey, open, seal, sendPacket, receiveBlob, PACKET_TOPIC, type SyncConfig } from '../../shared/session-wire.ts';

// Uses precisely the JS SDK and encrypted wire module used by the existing web client.
const [base, sid, test] = process.argv.slice(2);
const url = new URL('/ws', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(url);
let client: KokosyncClient | null = null;
let sequence = 0;
let ready = false;
let sawSnapshot = false;
const timeout = setTimeout(() => { console.error('JS SDK interoperability timeout'); cleanup(1); }, 45000);
function cleanup(code: number) { clearTimeout(timeout); client?.close(); ws.close(); setTimeout(() => process.exit(code), 200); }
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', id: crypto.randomUUID(), name: 'Web SDK Smoke', compat: 2 }));
  ws.send(JSON.stringify({ t: 'join', sid }));
  ws.send(JSON.stringify({ t: 'prepareSync', requestId: test, peerPositions: false, peerDelivery: false }));
});
ws.on('error', () => { console.error('JS home connection failed'); cleanup(1); });
ws.on('message', async raw => {
  try {
    const msg = JSON.parse(String(raw));
    if (msg.t !== 'syncConfig') return;
    const config = msg.config as SyncConfig;
    const key = await importKey(config.key);
    client = await KokosyncClient.connect({
      url: base, room: config.room, peer: config.peer, transport: 'websocket',
      websocketUrl: `/sync/ws?token=${encodeURIComponent(config.token)}`,
      routing: { enabled: false },
      websocketFactory: target => new WebSocket(target, { headers: { Origin: base } }) as unknown as globalThis.WebSocket,
    });
    const send = async (value: object) => sendPacket(client!, config.server, await seal(key, config.token, 'client', ++sequence, value));
    const receive = async (packet: any, from: string) => {
      if (from !== config.server || packet?.grant !== config.token) return;
      const decoded = await open(key, config.token, 'server', packet);
      if (decoded.value.kind === 'snapshot' && !ready) {
        sawSnapshot = decoded.value.snapshot.items.some((item: any) => item.kind === 'note' && item.text === 'Edited from second native');
        ready = true;
        await send({ t: 'mode', mode: '3d' });
        await send({ t: 'chat', text: 'Web SDK hello ' + test, scope: 'all' });
        client!.latest(PACKET_TOPIC, await seal(key, config.token, 'client-position', 1, { t: 'avatar', s: { x: 4.25, z: 4, ry: 0 } }) as any, 1n);
      }
      if (decoded.value.kind === 'message' && decoded.value.message.t === 'chat' && decoded.value.message.m.text === 'Native SDK acknowledgement ' + test) {
        if (!sawSnapshot) throw new Error('Native note missing from JS snapshot');
        console.log('PASS native ↔ existing JS SDK encrypted chat / avatar / shared snapshot'); cleanup(0);
      }
    };
    client.on('message', frame => { if (frame.topic === PACKET_TOPIC) void receive(frame.value, frame.peer).catch(() => cleanup(1)); });
    client.on('blob_open', frame => { void receiveBlob(client!, frame, peer => peer === config.server, receive).catch(() => cleanup(1)); });
    await send({ t: 'sync' });
  } catch { console.error('JS SDK handshake failed'); cleanup(1); }
});
