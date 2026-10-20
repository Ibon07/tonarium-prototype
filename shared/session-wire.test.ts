import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64, importKey, open, pack, seal, unpack, MAX_PACKET } from './session-wire.ts';

test('MessagePack preserves binary, large canvas values and optional fields', async () => {
  const value = { omitted: undefined, bytes: new Uint8Array([0, 128, 255]), points: Array.from({ length: 30_000 }, (_, i) => i % 620) };
  const decoded = unpack(pack(value));
  assert.deepEqual(decoded, { bytes: value.bytes, points: value.points });
  assert.ok(pack(value).length > 16 * 1024);
  const key = await importKey(base64(crypto.getRandomValues(new Uint8Array(32))));
  const packet = await seal(key, 'grant-a', 'server', 12, value);
  assert.deepEqual((await open(key, 'grant-a', 'server', packet)).value, decoded);
});

test('private packets reject another recipient, direction, key, sequence and tampering', async () => {
  const key = await importKey(base64(crypto.getRandomValues(new Uint8Array(32))));
  const other = await importKey(base64(crypto.getRandomValues(new Uint8Array(32))));
  const packet = await seal(key, 'grant-a', 'server', 1, { secret: 'dice result' });
  await assert.rejects(open(key, 'grant-b', 'server', packet));
  await assert.rejects(open(key, 'grant-a', 'client', packet));
  await assert.rejects(open(other, 'grant-a', 'server', packet));
  await assert.rejects(open(key, 'grant-a', 'server', { ...packet, seq: 2 }));
  packet.body[0] ^= 1;
  await assert.rejects(open(key, 'grant-a', 'server', packet));
});

test('oversize payloads fail before sending', async () => {
  const key = await importKey(base64(crypto.getRandomValues(new Uint8Array(32))));
  await assert.rejects(seal(key, 'grant-a', 'client', 1, new Uint8Array(MAX_PACKET)), /32 MiB/);
});
