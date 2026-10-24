const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeServer, sameOrigin, externalUrl, option } = require('../app/policy.cjs');

test('remote servers require HTTPS; explicit loopback development servers work', () => {
  assert.equal(normalizeServer('https://tonarium.rheni.work/#ignored'), 'https://tonarium.rheni.work/');
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(normalizeServer(`http://${host}:3040/`), `http://${host}:3040/`);
  for (const value of ['http://example.com/', 'file:///etc/passwd', 'data:text/html,hi', 'javascript:alert(1)', 'https://user:password@example.com', 'http://localhost.evil.test/', 'invalid']) assert.throws(() => normalizeServer(value));
});
test('navigation boundaries compare parsed origins, not prefixes', () => {
  assert.equal(sameOrigin('https://example.com/session', 'https://example.com/'), true);
  for (const value of ['https://example.com.evil.test', 'https://example.com@evil.test', 'http://example.com', 'https://example.com:444', 'file:///tmp/a', 'invalid']) assert.equal(sameOrigin(value, 'https://example.com/'), false);
});
test('external links cannot invoke executable or file URI handlers', () => {
  for (const value of ['https://example.com/a', 'http://localhost:3040/', 'mailto:test@example.com']) assert.equal(externalUrl(value), true);
  for (const value of ['file:///bin/sh', 'javascript:alert(1)', 'data:text/html,hi', 'steam://run/1', 'https://user:secret@example.com', 'invalid']) assert.equal(externalUrl(value), false);
});
test('CLI accepts split and equals forms and catches missing values', () => {
  assert.equal(option(['--server', 'https://example.com'], '--server'), 'https://example.com');
  assert.equal(option(['--server=https://example.com'], '--server'), 'https://example.com');
  assert.equal(option([], '--server'), undefined);
  assert.throws(() => option(['--server'], '--server'));
  assert.throws(() => option(['--server', '--data-dir', '/tmp/a'], '--server'));
});
