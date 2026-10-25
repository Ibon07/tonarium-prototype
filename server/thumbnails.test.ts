import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionThumbnails, THUMBNAIL_INTERVAL, THUMBNAIL_MAX_BYTES } from './thumbnails.ts';

const jpeg = (size = 4) => {
  const bytes = Buffer.alloc(size);
  bytes[0] = 0xff; bytes[1] = 0xd8;
  bytes[size - 2] = 0xff; bytes[size - 1] = 0xd9;
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
};
const a = { id: 'a', mode: '3d' as const }, b = { id: 'b', mode: '3d' as const };

test('elects one photographer, requests every three minutes and hands over on mode change or leave', () => {
  const requests: [string, string][] = [];
  const thumbnails = new SessionThumbnails((id, sid) => requests.push([id, sid]), () => {});
  thumbnails.register('fixed');
  thumbnails.register('created');
  thumbnails.update('fixed', [a, b], 0);
  thumbnails.update('fixed', [a, b], THUMBNAIL_INTERVAL - 1);
  assert.deepEqual(requests, [['a', 'fixed']]);
  thumbnails.update('fixed', [a, b], THUMBNAIL_INTERVAL);
  assert.deepEqual(requests, [['a', 'fixed'], ['a', 'fixed']]);
  thumbnails.update('fixed', [{ ...a, mode: '2d' }, b], THUMBNAIL_INTERVAL + 1);
  assert.deepEqual(requests.at(-1), ['b', 'fixed']);
  thumbnails.update('fixed', [a], THUMBNAIL_INTERVAL + 2);
  assert.deepEqual(requests.at(-1), ['a', 'fixed']);
  thumbnails.update('created', [b], 0);
  assert.deepEqual(requests.at(-1), ['b', 'created']);
});

test('accepts only the photographer JPEG up to 64 KiB and replaces the last image', () => {
  let rejected = 0, changed = 0;
  const thumbnails = new SessionThumbnails(() => {}, () => changed++, () => rejected++);
  thumbnails.register('s');
  thumbnails.update('s', [a, b], 0);
  const first = jpeg();
  thumbnails.upload('s', 'a', first);
  assert.equal(thumbnails.thumbnail('s'), first);
  const max = jpeg(THUMBNAIL_MAX_BYTES);
  thumbnails.upload('s', 'a', max);
  assert.equal(thumbnails.thumbnail('s'), max);
  const before = changed;
  for (const [id, image] of [
    ['b', first], ['a', jpeg(THUMBNAIL_MAX_BYTES + 1)], ['a', first.replace('image/jpeg', 'image/png')],
    ['a', 'data:image/jpeg;base64,!!!!'], ['a', 'data:image/jpeg;base64,YWJjZA=='], ['a', null],
  ]) thumbnails.upload('s', id as string, image);
  assert.equal(rejected, 6);
  assert.equal(changed, before);
  assert.equal(thumbnails.thumbnail('s'), max);
});

test('uses placeholders without 3D participants, clears empty sessions and isolates sessions', () => {
  let rejected = 0;
  const thumbnails = new SessionThumbnails(() => {}, () => {}, () => rejected++);
  for (const sid of ['fixed', 'created']) {
    thumbnails.register(sid);
    thumbnails.update(sid, [a], 0);
    thumbnails.upload(sid, 'a', jpeg());
  }
  thumbnails.update('fixed', [{ ...a, mode: '2d' }], 1);
  assert.equal(thumbnails.thumbnail('fixed'), undefined);
  thumbnails.upload('fixed', 'a', jpeg());
  assert.equal(rejected, 1);
  assert.equal(thumbnails.thumbnail('created'), jpeg());
  thumbnails.update('fixed', [], 2);
  thumbnails.update('fixed', [a], 3);
  assert.equal(thumbnails.thumbnail('fixed'), undefined);
  thumbnails.delete('created');
  assert.equal(thumbnails.thumbnail('created'), undefined);
});
