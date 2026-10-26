import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SystemCommand } from '../shared/system-types.ts';
import { createSystemPlaytestServer } from './system-playtest.ts';

async function local(t: { after(fn: () => unknown): void }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarium-local-systems-'));
  const app = createSystemPlaytestServer({ directory, tickMs: 0 });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (endpoint: string, value: unknown, token?: string) => fetch(base + endpoint, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...(token ? { 'x-system-playtest-token': token } : {}) }, body: JSON.stringify(value) });
  const join = async (slot: string) => { const response = await post('/api/system-playtest/join', { slot }); assert.equal(response.status, 200); return response.json(); };
  return { app, base, post, join };
}

test('local adapter executes real composed systems for two independent browser slots without external services', async t => {
  let now = 1_700_000_000_000; t.mock.method(Date, 'now', () => now);
  const { app, base, post, join } = await local(t);
  const alice = await join('alice'), bob = await join('bob');
  assert.notEqual(alice.token, bob.token); assert.equal(alice.actor, 'alice'); assert.equal(bob.actor, 'bob');
  const get = async (token: string) => {
    const response = await fetch(`${base}/api/system-playtest`, { headers: { 'x-system-playtest-token': token } });
    assert.equal(response.status, 200); return response.json();
  };
  let state = await get(alice.token);
  assert.deepEqual(state.participants, ['alice', 'bob']); assert.equal(state.view.map.id, 'system-demo');
  assert.deepEqual([...new Set(state.view.systems.map((system: { systemId: string }) => system.systemId))].sort(), ['button', 'chair', 'timer']);
  const displayItem = state.items.find((item: { id: string }) => item.id === 'system-map:system-demo:timer-text');
  assert.equal(displayItem.kind, 'note'); assert.equal(displayItem.text, '00:10'); assert.equal(displayItem.mapPlacement.mode, 'system');
  const buttonItem = state.items.find((item: { id: string }) => item.id === 'system-map:system-demo:menu-chess-button');
  assert.equal(buttonItem.kind, 'chess');
  const interact = async (token: string, objectId: string, id: string, revision?: number) => {
    const current = await get(token);
    const command: SystemCommand = { kind: 'interact', objectId, id, revision: revision ?? current.view.revision };
    return post('/api/system-playtest', { actor: 'forged-user', command }, token);
  };
  assert.equal((await interact(alice.token, 'menu-chess-button', 'start')).status, 200);
  now += 10_000; app.tick();
  state = await get(bob.token);
  assert.equal(state.view.objects['timer-text'].text, '00:00');
  assert.equal(state.items.find((item: { id: string }) => item.id === displayItem.id).text, '00:00');
  const timer = state.view.systems.find((system: { instanceId: string }) => system.instanceId === 'countdown');
  assert.equal(timer.state.running, false); assert.equal(timer.state.remaining, 0);
  assert.equal((await interact(alice.token, 'chair-object', 'sit')).status, 200);
  state = await get(bob.token); assert.equal(state.view.seats['chair-object'], 'alice');
  const occupied = await interact(bob.token, 'chair-object', 'occupied'); assert.equal(occupied.status, 422);
  assert.match((await occupied.json()).error, /occupied/);
  const stale = await interact(bob.token, 'reset-button', 'stale', 0); assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /revision conflict/);
  assert.equal((await post('/api/system-playtest/leave', {}, alice.token)).status, 200);
  assert.equal((await interact(bob.token, 'chair-object', 'new-seat')).status, 200);
  state = await get(bob.token); assert.equal(state.view.seats['chair-object'], 'bob');
  now += 15_001; app.tick();
  assert.equal(app.service.view('system-playtest').seats['chair-object'], undefined);
});

test('local adapter rejects cross-origin writes, invalid sessions, non-code maps, and excessive request bodies', async t => {
  const { base, post, join } = await local(t);
  const external = await fetch(`${base}/api/system-playtest/join`, { method: 'POST', headers: { Origin: 'https://external.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: 'alice' }) });
  assert.equal(external.status, 403);
  const missingOrigin = await fetch(`${base}/api/system-playtest/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: 'alice' }) });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await fetch(`${base}/api/system-playtest`)).status, 401);
  assert.equal((await post('/api/system-playtest/join', { slot: 'mallory' })).status, 400);
  const alice = await join('alice');
  assert.equal((await post('/api/system-playtest', { command: { kind: 'map', map: {} } }, alice.token)).status, 400);
  assert.equal((await post('/api/system-playtest', { command: { kind: 'input' }, unused: 'x'.repeat(256 * 1024) }, alice.token)).status, 413);
  assert.equal((await fetch(`${base}/api/shared-systems`)).status, 200);
});

test('local adapter keeps a seat while another tab for the same slot remains connected', async t => {
  const { app, post, join } = await local(t);
  const first = await join('alice'), second = await join('alice');
  const command: SystemCommand = { kind: 'interact', id: 'seat', objectId: 'chair-object', revision: app.service.view('system-playtest').revision };
  assert.equal((await post('/api/system-playtest', { command }, first.token)).status, 200);
  await post('/api/system-playtest/leave', {}, first.token);
  assert.equal(app.service.view('system-playtest').seats['chair-object'], 'alice');
  await post('/api/system-playtest/leave', {}, second.token);
  assert.equal(app.service.view('system-playtest').seats['chair-object'], undefined);
});
