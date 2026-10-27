import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { testServerEnv } from './test-db.ts';
import { WebSocket } from 'ws';
import { COMPAT_VERSION, type ServerMsg, type User } from '../shared/protocol.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined): Promise<T> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const value = read();
    if (value !== undefined) return value;
    await delay(25);
  }
  throw new Error('Timed out');
}
async function freePort() {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}
const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`));

test('guests, dev and Misskey logins decide who you are and what you may do', { timeout: 60_000 }, async (t) => {
  // 偽の Misskey。許可済みのセッションだけ check に user を返す
  const granted = new Set<string>();
  const misskey = http.createServer((req, res) => {
    const m = /^\/api\/miauth\/([^/]+)\/check$/.exec(req.url ?? '');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(m && granted.has(m[1]) ? { ok: true, token: 'secret', user: { id: 'mk-1', username: 'alice', name: 'Alice M' } } : { ok: false }));
  });
  const misskeyPort = await freePort();
  await new Promise<void>((resolve) => misskey.listen(misskeyPort, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => misskey.close(() => resolve())));

  const dbEnv = await testServerEnv(t);
  const data = await mkdtemp(path.join(os.tmpdir(), 'tonarium-auth-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  await writeFile(path.join(data, 'sessions.json'), JSON.stringify({ name: 'Test', sessions: [{ id: 'room', name: 'Room' }] }));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, ...dbEnv, MISSKEY_URL: `http://127.0.0.1:${misskeyPort}`, SERVER_PORT: String(port), DATA_DIR: data, SESSIONS_FILE: path.join(data, 'sessions.json'), LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('server on http://')) ready = true; });
  child.stderr.resume();
  t.after(async () => {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill(); });
  });
  await until(() => ready ? true : undefined);

  const post = (p: string, body: unknown, cookie?: string, origin: string | null = base) => fetch(`${base}${p}`, {
    method: 'POST', redirect: 'manual', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  async function connect(cookie: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
    t.after(() => ws.terminate());
    const messages: ServerMsg[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ t: 'hello', compat: COMPAT_VERSION }));
    await until(() => messages.find((m) => m.t === 'snapshot'));
    return { ws, messages, send: (m: unknown) => ws.send(JSON.stringify(m)), users: () => [...messages].reverse().find((m) => m.t === 'users' || m.t === 'snapshot') };
  }
  const usersOf = (msg: ServerMsg | undefined): User[] => (msg?.t === 'users' ? msg.list : msg?.t === 'snapshot' ? msg.s.users : []);

  // セッションが無い接続は hello で断る。ログイン導入前の古い画面（版が古い）には再読み込みを促す
  async function anonymous(compat: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: ServerMsg[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => ws.once('open', resolve));
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ t: 'hello', compat }));
    return { code: await closed, messages };
  }
  const old = await anonymous(COMPAT_VERSION - 1);
  assert.equal(old.messages[0]?.t, 'incompatible');
  const current = await anonymous(COMPAT_VERSION);
  assert.equal(current.code, 4401);
  assert.equal(current.messages.length, 0);
  // 他サイトからの POST（Origin 違い・無し）は受けない
  assert.equal((await post('/auth/guest', { name: 'x' }, undefined, 'https://evil.example')).status, 403);
  assert.equal((await post('/auth/guest', { name: 'x' }, undefined, null)).status, 403);

  // ゲスト。同じ名前の開発用アカウントとは別人になる
  const guestRes = await post('/auth/guest', { name: 'Sam' });
  const guestCookie = cookieOf(guestRes, 'tonarium_session')!;
  const guestAccount = (await guestRes.json() as { account: { id: string; kind: string } }).account;
  assert.equal(guestAccount.kind, 'guest');
  // 開発用ログインは Cookie を付けない（同じブラウザのほかのタブを巻き込まない）。セッションは本文で受け取る
  const devRes = await post('/auth/dev', { name: 'Sam' });
  assert.equal(cookieOf(devRes, 'tonarium_session'), undefined);
  const devBody = await devRes.json() as { account: { id: string }; session: string };
  const devAccount = devBody.account;
  const devCookie = `tonarium_session=${devBody.session}`;
  assert.notEqual(devAccount.id, guestAccount.id);
  // 同じ端末でもう一度ゲストで入ると、同じアカウントのまま名前だけ変わる
  const again = await (await post('/auth/guest', { name: 'Sammy' }, guestCookie)).json() as { account: { id: string; name: string } };
  assert.deepEqual([again.account.id, again.account.name], [guestAccount.id, 'Sammy']);

  const guest = await connect(guestCookie);
  const dev = await connect(devCookie);
  const seen = await until(() => { const list = usersOf(dev.users()); return list.length === 2 ? list : undefined; });
  assert.deepEqual(seen.map((u) => [u.id, u.guest]).sort(), [[devAccount.id, false], [guestAccount.id, true]].sort());

  // ゲストは人に残る操作ができない
  guest.send({ t: 'postCreate', text: 'hi', withPlace: false });
  await until(() => guest.messages.find((m) => m.t === 'loginRequired'));
  assert.equal((await fetch(`${base}/profile`, { method: 'POST', body: JSON.stringify({ bio: 'x' }), headers: { Cookie: guestCookie } })).status, 403);
  // アイコンは残せる（自分の分だけ。URL の名前は使わない）
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.equal((await fetch(`${base}/icon?name=Someone`, { method: 'POST', body: jpeg, headers: { Cookie: guestCookie } })).status, 200);
  assert.equal((await fetch(`${base}/icon?name=Sammy`)).status, 200);
  assert.equal((await fetch(`${base}/icon?name=Someone`)).status, 404);
  assert.equal((await fetch(`${base}/icon`, { method: 'POST', body: jpeg })).status, 401);

  // 表示名を変えると、つないでいる全員に新しい名前が届く
  assert.equal((await post('/auth/name', { name: 'Samuel' }, devCookie)).status, 200);
  await until(() => usersOf(guest.users()).find((u) => u.id === devAccount.id && u.name === 'Samuel'));

  // Misskey（同じブラウザ）: 始めた端末だけがコールバックでセッションを受け取る
  const start = await post('/auth/miauth/start', {});
  const pending = cookieOf(start, 'tonarium_login')!;
  const { url } = await start.json() as { url: string };
  const session = new URL(url).pathname.split('/').pop()!;
  assert.ok(url.startsWith(`http://127.0.0.1:${misskeyPort}/miauth/`));
  assert.equal(new URL(url).searchParams.get('callback'), `${base}/auth/miauth/callback`);
  const denied = await fetch(`${base}/auth/miauth/callback?session=${session}`, { headers: { Cookie: pending }, redirect: 'manual' });
  assert.equal(denied.status, 400);
  granted.add(session);
  const other = await fetch(`${base}/auth/miauth/callback?session=${session}`, { redirect: 'manual' });
  assert.equal(other.status, 200, 'another browser only gets the code confirmation page');
  assert.match(await other.text(), /@alice/);
  assert.equal(cookieOf(other, 'tonarium_session'), undefined);
  const back = await fetch(`${base}/auth/miauth/callback?session=${session}`, { headers: { Cookie: pending }, redirect: 'manual' });
  assert.equal(back.status, 302);
  const mkCookie = cookieOf(back, 'tonarium_session')!;
  const me = await (await fetch(`${base}/auth/me`, { headers: { Cookie: mkCookie } })).json() as { account: { kind: string; username: string; name: string } };
  assert.deepEqual([me.account.kind, me.account.username, me.account.name], ['misskey', 'alice', 'Alice M']);

  const confirm = (session: string, code: string) => fetch(`${base}/auth/miauth/confirm`, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams({ session, code }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  });
  const pollStatus = async (cookie: string) => (await (await post('/auth/miauth/poll', {}, cookie)).json() as { status: string }).status;

  // 他人が始めたログインの許可 URL を開かされても、始めた画面のコードを知らなければ他人に結び付かない（ログイン CSRF）
  const attacker = await post('/auth/miauth/start', {});
  const attackerPending = cookieOf(attacker, 'tonarium_login')!;
  const attackSession = new URL((await attacker.json() as { url: string }).url).pathname.split('/').pop()!;
  granted.add(attackSession);
  assert.equal((await fetch(`${base}/auth/miauth/callback?session=${attackSession}`, { redirect: 'manual' })).status, 200);
  assert.equal(await pollStatus(attackerPending), 'pending', 'approval alone never logs the starter in');
  for (let i = 0; i < 4; i++) assert.equal((await confirm(attackSession, 'AAAA-AAAA')).status, 400);
  assert.equal(await pollStatus(attackerPending), 'pending');
  assert.equal((await confirm(attackSession, 'AAAA-AAAA')).status, 400);
  assert.equal(await pollStatus(attackerPending), 'expired', 'too many wrong codes cancel the sign-in');
  // 確認はほかのサイトからは送れない
  assert.equal((await fetch(`${base}/auth/miauth/confirm`, { method: 'POST', body: 'session=x&code=y', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' } })).status, 403);

  // Misskey（Electron）: 許可したブラウザで始めた画面のコードを入れると、待っている端末が poll で受け取る。同じ Misskey の人は同じアカウント
  const start2 = await post('/auth/miauth/start', {});
  const pending2 = cookieOf(start2, 'tonarium_login')!;
  const started2 = await start2.json() as { url: string; code: string };
  const session2 = new URL(started2.url).pathname.split('/').pop()!;
  assert.match(started2.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(await pollStatus(pending2), 'pending');
  granted.add(session2);
  assert.equal((await fetch(`${base}/auth/miauth/callback?session=${session2}`, { redirect: 'manual' })).status, 200);
  assert.equal(await pollStatus(pending2), 'pending');
  assert.equal((await confirm(session2, started2.code.toLowerCase().replace('-', ' '))).status, 200, 'case and separators do not matter');
  const done = await post('/auth/miauth/poll', {}, pending2);
  const polled = await done.json() as { status: string; account: { username: string } };
  assert.equal(polled.status, 'done');
  assert.ok(cookieOf(done, 'tonarium_session'));
  const me2 = await (await fetch(`${base}/auth/me`, { headers: { Cookie: cookieOf(done, 'tonarium_session')! } })).json() as { account: { username: string } };
  assert.equal(me2.account.username, 'alice');

  // Cookie はブラウザの上限まで持たせ、期限は DB で決める（使うたびに延びる期限に Cookie を合わせ直さないため）
  assert.match(back.headers.getSetCookie().find((c) => c.startsWith('tonarium_session='))!, /Max-Age=34560000; .*HttpOnly|HttpOnly; .*Max-Age=34560000/);
  // 1 つの接続元から作れるゲストには上限がある（ここまでに 1 人作っている）
  const statuses: number[] = [];
  for (let i = 0; i < 20; i++) statuses.push((await post('/auth/guest', { name: `g${i}` })).status);
  assert.deepEqual([statuses.slice(0, 19).every((x) => x === 200), statuses[19]], [true, 429]);

  // ログアウトすると、そのセッションではもう入れない
  await post('/auth/logout', {}, mkCookie);
  assert.equal((await (await fetch(`${base}/auth/me`, { headers: { Cookie: mkCookie } })).json() as { account: unknown }).account, null);
});
