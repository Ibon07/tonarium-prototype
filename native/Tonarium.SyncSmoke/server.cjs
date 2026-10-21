const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const data = path.resolve('native/artifacts/sync-receive/server-data');
fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(path.join(data, 'sessions.json'), JSON.stringify({
  name: 'Sync regression', sessions: [{ id: 'sync-load', name: 'Sync load' }, { id: 'sync-other', name: 'Other generation' }],
}));
fs.writeFileSync(path.join(data, 'items.json'), JSON.stringify({
  'sync-load': [
    {
      id: 'large-canvas', kind: 'canvas', x: 0, z: 0, ry: 0, createdBy: 'seed',
      strokes: Array.from({ length: 1800 }, (_, i) => ({
        id: 's' + i, by: 'seed', color: '#334455', size: 3,
        pts: Array.from({ length: 500 }, (_, n) => n % 400),
      })),
    },
    { id: 'load-note', kind: 'note', x: 1, z: 1, ry: 0, text: 'initial', createdBy: 'seed' },
  ],
}));
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, SERVER_PORT: '3027', DATA_DIR: data, SESSIONS_FILE: path.join(data, 'sessions.json'), LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '' },
  stdio: 'inherit',
});
process.on('SIGTERM', () => child.kill());
process.on('SIGINT', () => child.kill());
