const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const output = path.resolve(process.argv[2] || 'native/verification/unity');
const compact = process.argv.includes('--compact');
fs.mkdirSync(output, { recursive: true });
const received = [];
const snapshot = {
  t: 'snapshot', selfId: 'smoke-self', name: 'ネイティブ確認', sessionId: 'room-a',
  serverUrl: 'http://localhost:3001', world: 'cafe', now: Date.now(),
  users: [{ id: 'smoke-self', name: 'ネイティブ確認', mode: '3d', session: 'room-a' },
    { id: 'smoke-peer', name: 'お絵描きアバター', mode: '3d', session: 'room-a' },
    { id: 'smoke-2d', name: '2D の参加者', mode: '2d', session: 'room-a' }],
  avatars: { 'smoke-self': { x: 0, z: 6.5, ry: 0 }, 'smoke-peer': { x: 0, z: 1, ry: Math.PI } },
  presence: { 'smoke-2d': { pos: { x: 1.5, z: 1, ry: Math.PI } } },
  items: [
    { id: 'note-a', kind: 'note', text: 'HTML からネイティブへ\nいっしょに過ごす場所', color: '#fde68a', x: -1.8, z: 2.2, ry: 0 },
    { id: 'chess-a', kind: 'chess', x: 2, z: -1, ry: 0, board: Array.from({ length: 64 }, (_, i) => i < 8 ? 'bP' : i > 55 ? 'wP' : null) },
    { id: 'dice-a', kind: 'dice', x: 2.5, z: 3, ry: 0 },
    { id: 'canvas-a', kind: 'canvas', x: -1, z: -2, ry: 0, strokes: [{ color: '#cc5566', size: 8, pts: [100, 100, 300, 350, 500, 100] }] }
  ], chats: [{ fromName: 'お絵描きアバター', text: '同じセッションで、3D に切り替わりました。' }],
  game: { round: 0, phase: 'idle', players: [], tiles: {} }
};
const server = net.createServer(socket => {
  socket.on('error', error => { if (error.code !== 'ECONNRESET') console.error(error.message); });
  let buffer = '';
  socket.on('data', data => {
    buffer += data;
    for (let p; (p = buffer.indexOf('\n')) !== -1;) {
      const msg = JSON.parse(buffer.slice(0, p)); buffer = buffer.slice(p + 1); received.push(msg);
      if (msg.t === 'ready') {
        socket.write(JSON.stringify(snapshot) + '\n');
        socket.write(JSON.stringify({ t: 'videoFrame', identity: 'smoke-peer', jpeg: fs.readFileSync('client/public/brand/og.png').toString('base64') }) + '\n');
        setTimeout(() => socket.write(JSON.stringify({ t: 'teleport', x: 1, z: 6.5, ry: 0 }) + '\n'), 400);
        if (compact) setTimeout(() => socket.write(JSON.stringify({ t: 'resize', width: 412, height: 507 }) + '\n'), 500);
      }
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  const exe = path.resolve('native/build/unity/Tonarium3D.exe');
  const child = spawn(exe, ['--tonarium-port', '' + server.address().port, '--tonarium-smoke', '--tonarium-output', output,
    '-screen-fullscreen', '0', '-screen-width', '1280', '-screen-height', '800', '-logFile', path.join(output, 'player.log'), ...(compact ? ['--tonarium-embedded'] : [])]);
  const timeout = setTimeout(() => { child.kill(); console.error('Unity smoke timed out'); process.exitCode = 1; server.close(); }, 45000);
  child.on('exit', code => {
    clearTimeout(timeout); server.close();
    const resultFile = path.join(output, 'result.json');
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile)) : {};
    const avatars = received.filter(m => m.t === 'room' && m.message.t === 'avatar').length;
    const teleport = received.some(m => m.t === 'room' && m.message.t === 'avatar' && Math.abs(m.message.s.x - 1) < 0.01);
    const good = code === 0 && result.ok && result.avatars === 2 && result.items === 4 && result.liveScreens === 1 && avatars > 5 && teleport;
    fs.writeFileSync(path.join(output, 'bridge-result.json'), JSON.stringify({ passed: good, exitCode: code, avatarMessages: avatars, teleport, ready: received.some(m => m.t === 'ready'), returned: received.some(m => m.t === 'return2d'), ...result }, null, 2));
    console.log(JSON.stringify({ passed: good, code, avatars, output, ...result }));
    if (!good) process.exitCode = 1;
  });
});
