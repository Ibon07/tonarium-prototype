import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { keepHomeSocketsAlive } from './ws-heartbeat.ts';

test('idle clients stay connected while an unresponsive client is terminated', { timeout: 5000 }, async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const stop = keepHomeSocketsAlive(server, 50);
  const healthy = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const silent = new WebSocket(`ws://127.0.0.1:${address.port}`, { autoPong: false });
  const silentClosed = once(silent, 'close');
  const healthyPings = new Promise<void>((resolve) => {
    let count = 0;
    healthy.on('ping', () => { if (++count >= 4) resolve(); });
  });
  try {
    await Promise.all([once(healthy, 'open'), once(silent, 'open')]);
    const [code] = await silentClosed;
    assert.equal(code, 1006);
    await healthyPings;
    assert.equal(healthy.readyState, WebSocket.OPEN);
    stop();
    let extraPings = 0;
    healthy.on('ping', () => { extraPings++; });
    await new Promise((resolve) => setTimeout(resolve, 125));
    assert.equal(extraPings, 0, 'stopping the heartbeat removes its timer');
  } finally {
    stop();
    healthy.terminate(); silent.terminate();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
