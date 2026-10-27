import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { testServerEnv } from './test-db.ts';
import { WebSocket } from 'ws';
import { COMPAT_VERSION, type Group } from '../shared/protocol.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined): Promise<T> {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const value = read();
    if (value !== undefined) return value;
    await delay(20);
  }
  throw new Error('Timed out waiting for group update');
}

test('group permissions, uploads, legacy data, broadcasts and persistence', { timeout: 60_000 }, async (t) => {
  const dbEnv = await testServerEnv(t);
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const data = await mkdtemp(path.join(os.tmpdir(), 'tonarium-groups-'));
  const base = `http://127.0.0.1:${port}`;
  const legacy: Group = { id: 'legacy', name: 'Legacy', color: '#123456', owner: 'Owner', members: ['Owner', 'Editor', 'Member'], channels: [{ id: 'general', name: '雑談' }] };
  await writeFile(path.join(data, 'home.json'), JSON.stringify({ sessions: [], groups: [legacy], events: [], renamed: {} }));
  await writeFile(path.join(data, 'sessions.json'), JSON.stringify({ name: 'Test', sessions: [] }));
  let child: ChildProcess | undefined;
  const sockets: WebSocket[] = [];
  async function stop() {
    sockets.splice(0).forEach((s) => s.terminate());
    if (!child || child.exitCode !== null || child.signalCode) return;
    const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
    child.kill();
    await exited;
  }
  t.after(async () => { await stop(); await rm(data, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: { ...process.env, ...dbEnv, SERVER_PORT: String(port), DATA_DIR: data, SESSIONS_FILE: path.join(data, 'sessions.json') },
      stdio: 'ignore',
    });
    const end = Date.now() + 15_000;
    while (Date.now() < end) {
      if (await fetch(`${base}/healthz`).then((r) => r.ok).catch(() => false)) return;
      await delay(50);
    }
    throw new Error('Test server did not start');
  }
  async function peer(name: string) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    sockets.push(ws);
    let groups: Group[] | undefined;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'snapshot') groups = m.s.groups;
      if (m.t === 'groups') groups = m.list;
    });
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ t: 'hello', id: crypto.randomUUID(), name, compat: COMPAT_VERSION }));
    await until(() => groups);
    return { groups: () => groups!, send: (m: object) => ws.send(JSON.stringify(m)) };
  }
  const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const upload = (name: string, body: Uint8Array = image) => fetch(`${base}/group-image/legacy?name=${name}`, { method: 'POST', body: new Uint8Array(body), headers: { 'Content-Type': 'image/jpeg' } });
  await start();
  const owner = await peer('Owner'), editor = await peer('Editor'), member = await peer('Member'), outsider = await peer('Outsider');
  assert.deepEqual(owner.groups()[0].editors, []);
  member.send({ t: 'groupUpdate', groupId: 'legacy', name: 'Denied', editors: ['Member'] });
  outsider.send({ t: 'groupUpdate', groupId: 'legacy', name: 'Denied' });
  assert.equal((await upload('Member')).status, 204);
  assert.equal((await upload('Outsider')).status, 204);
  await delay(100);
  assert.equal(owner.groups()[0].name, 'Legacy');
  owner.send({ t: 'groupUpdate', groupId: 'legacy', name: '  Renamed  ', editors: ['Editor', 'Owner', 'Editor', 'Outsider', 42] });
  await until(() => outsider.groups()[0].name === 'Renamed' ? true : undefined);
  assert.deepEqual(outsider.groups()[0].editors, ['Editor']);
  editor.send({ t: 'groupUpdate', groupId: 'legacy', name: '  Editor name  ', editors: ['Member'] });
  await until(() => member.groups()[0].name === 'Editor name' ? true : undefined);
  assert.deepEqual(member.groups()[0].editors, ['Editor']);
  editor.send({ t: 'groupUpdate', groupId: 'legacy', name: 'x'.repeat(45) });
  await until(() => owner.groups()[0].name === 'x'.repeat(40) ? true : undefined);
  editor.send({ t: 'groupUpdate', groupId: 'legacy', name: 'Editor name' });
  await until(() => owner.groups()[0].name === 'Editor name' ? true : undefined);
  editor.send({ t: 'groupUpdate', groupId: 'legacy', name: '   ' });
  editor.send({ t: 'groupDelete', id: 'legacy' });
  assert.equal((await upload('Editor', new Uint8Array([1, 2]))).status, 400);
  const large = new Uint8Array(300_001); large.set(image);
  const oversized = await upload('Owner', large).catch(() => null);
  assert.ok(!oversized || oversized.status === 400);
  assert.equal((await upload('Editor')).status, 200);
  await until(() => outsider.groups()[0].imageVersion === 1 ? true : undefined);
  assert.equal(owner.groups()[0].name, 'Editor name');
  assert.deepEqual(new Uint8Array(await (await fetch(`${base}/group-image/legacy?v=1`)).arrayBuffer()), image);
  await writeFile(path.join(data, 'group-images', 'legacy.png'), 'old');
  assert.equal((await upload('Owner')).status, 200);
  assert.deepEqual(await readdir(path.join(data, 'group-images')), ['legacy.jpg']);
  await delay(1000);
  const saved = JSON.parse(await readFile(path.join(data, 'home.json'), 'utf8'));
  assert.equal(saved.groups[0].imageVersion, 2);
  await stop();
  await start();
  const restored = await peer('Owner');
  assert.equal(restored.groups()[0].name, 'Editor name');
  assert.deepEqual(restored.groups()[0].editors, ['Editor']);
  assert.equal(restored.groups()[0].imageVersion, 2);
  assert.equal((await fetch(`${base}/group-image/legacy?v=2`)).status, 200);
  restored.send({ t: 'groupUpdate', groupId: 'legacy', editors: [] });
  await until(() => restored.groups()[0].editors?.length === 0 ? true : undefined);
  assert.equal((await upload('Editor')).status, 204);
  restored.send({ t: 'groupDelete', id: 'legacy' });
  await until(() => restored.groups().length === 0 ? true : undefined);
  assert.deepEqual(await readdir(path.join(data, 'group-images')), []);
});
