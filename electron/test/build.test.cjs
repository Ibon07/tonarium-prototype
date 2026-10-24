const { test } = require('node:test');
const assert = require('node:assert/strict');
const semver = require('semver');
const { configuration } = require('../scripts/build.cjs');
test('nightly version exceeds stable and increases with run and rerun', () => {
  const first = configuration(['--linux', '--nightly'], { GITHUB_RUN_NUMBER: '30' });
  const retry = configuration(['--linux', '--nightly'], { GITHUB_RUN_NUMBER: '30', GITHUB_RUN_ATTEMPT: '2' });
  const next = configuration(['--win', '--nightly'], { GITHUB_RUN_NUMBER: '31' });
  assert(semver.gt(first.version, require('../package.json').version));
  assert(semver.gt(retry.version, first.version));
  assert(semver.gt(next.version, retry.version));
});
test('disable updates is a build option and invalid arguments fail closed', () => {
  assert.equal(configuration(['--linux', '--disable-updates']).enabled, false);
  assert.equal(configuration(['--linux']).enabled, true);
  assert.throws(() => configuration(['--nightly'], {}));
  assert.throws(() => configuration(['--unknown']));
});
