const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('builder rejection stays nonzero even when a dependency resets exitCode', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarium-build-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'app'));
  for (const name of ['build.cjs', 'collect.cjs']) fs.copyFileSync(path.join(__dirname, '../scripts', name), path.join(root, 'scripts', name));
  fs.copyFileSync(path.join(__dirname, '../package.json'), path.join(root, 'package.json'));
  const hook = path.join(root, 'fake-builder.cjs');
  fs.writeFileSync(hook, `
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name) {
      if (name === 'electron-builder') {
        process.on('exit', () => { process.exitCode = 0; });
        return {
          build: async () => { throw new Error('simulated installer failure'); },
          Platform: { WINDOWS: { createTarget: () => [] } }, Arch: { x64: 1 }
        };
      }
      return load.apply(this, arguments);
    };
  `);
  const result = spawnSync(process.execPath, ['--require', hook, path.join(root, 'scripts/build.cjs'), '--win'], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /simulated installer failure/);
  assert.equal(fs.existsSync(path.join(root, 'artifacts')), false);
});
