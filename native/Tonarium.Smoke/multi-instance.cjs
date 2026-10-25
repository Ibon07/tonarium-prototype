const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');

const executable = path.resolve(process.argv[2] || 'native/artifacts/Tonarium-win-x64/Tonarium.exe');
const server = process.argv[3] || 'http://localhost:3015';
const output = path.resolve(process.argv[4] || 'native/artifacts/multi-instance');
const storage = path.join(output, 'profiles-' + Date.now());
const children = [];
const checks = [];
let observer;
let users = [];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + label);
    await delay(100);
  }
  checks.push(label);
  console.log('PASS ' + label);
}
function saved(slot) {
  try { return JSON.parse(fs.readFileSync(path.join(storage, slot === 1 ? '' : `instances/${slot}`, 'desktop.json'), 'utf8')); }
  catch { return undefined; }
}
function start(extra) {
  const child = spawn(executable, ['--data-dir', storage, '--connect', ...extra], { windowsHide: true, stdio: 'ignore' });
  child.ended = new Promise(resolve => child.once('exit', resolve));
  children.push(child);
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await child.ended;
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const suffix = Date.now();
  const first = start(['--server', server, '--name', `複数起動 A ${suffix}`]);
  await until(() => saved(1)?.name === `複数起動 A ${suffix}`, 'first instance keeps primary profile');
  const second = start(['--name', `複数起動 B ${suffix}`]);
  await until(() => saved(2)?.name === `複数起動 B ${suffix}`, 'second instance uses separate profile');
  const a = saved(1), b = saved(2);
  if (a.selfId === b.selfId || b.server !== a.server) throw new Error('Profiles must use different IDs and inherit the server');
  observer = new WebSocket(server.replace(/^http/, 'ws') + '/ws');
  observer.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.t === 'snapshot') users = message.s.users;
    if (message.t === 'users') users = message.list;
  });
  await new Promise((resolve, reject) => { observer.once('open', resolve); observer.once('error', reject); });
  observer.send(JSON.stringify({ t: 'hello', id: randomUUID(), name: `複数起動の確認 ${suffix}`, compat: 2 }));
  await until(() => users.some(u => u.id === a.selfId) && users.some(u => u.id === b.selfId), 'both native windows stay connected with distinct IDs');
  await delay(2000);
  if (!users.some(u => u.id === a.selfId) || !users.some(u => u.id === b.selfId)) throw new Error('One instance displaced the other');
  await stop(first);
  await until(() => !users.some(u => u.id === a.selfId) && users.some(u => u.id === b.selfId), 'closing one instance leaves the other connected');
  const restarted = start([]);
  await until(() => users.some(u => u.id === a.selfId) && users.some(u => u.id === b.selfId), 'reopened instance reuses the released profile and remembered identity');
  if (saved(1).name !== a.name || saved(2).name !== b.name) throw new Error('Remembered names were overwritten');
  const result = { passed: true, checks, profiles: [{ slot: 1, ...a }, { slot: 2, ...b }], processes: [restarted.pid, second.pid] };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
})().catch(error => {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2));
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  observer?.close();
  await Promise.all(children.map(stop));
});
