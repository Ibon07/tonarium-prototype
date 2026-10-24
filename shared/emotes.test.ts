import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOTES, emotePose, isEmoteId, type EmoteId } from './emotes.ts';
import { isRoomClientMsg } from './protocol.ts';

test('only supported emotes can be accepted; reactions route through the room', () => {
  for (const id of Object.keys(EMOTES) as EmoteId[]) {
    assert.equal(isEmoteId(id), true);
    assert.equal(isRoomClientMsg({ t: 'emote', id }), true);
  }
  for (const value of ['toString', '__proto__', 'dance', null, 1, {}, '']) assert.equal(isEmoteId(value), false);
});

test('all animations finish at rest with bounded, finite transforms', () => {
  const rest = { y: 0, rx: 0, rz: 0, sx: 1, sy: 1, left: 0, right: 0, bow: 0, liftLeft: 0, liftRight: 0, hands: 0 };
  for (const id of Object.keys(EMOTES) as EmoteId[]) {
    for (const at of [-100, 0, EMOTES[id].duration, EMOTES[id].duration + 1000]) assert.deepEqual(emotePose(id, at), rest);
    for (let at = 0; at < EMOTES[id].duration; at += 16) {
      const p = emotePose(id, at);
      assert.ok(Object.values(p).every(Number.isFinite));
      assert.ok(p.sy > 0.7 && p.sy < 1.2);
      assert.ok(p.y >= -0.2 && p.y <= 0.4);
    }
  }
  assert.ok(emotePose('wave', 650).liftRight > 30);
  assert.ok(emotePose('hop', 500).y > 0.3);
  assert.ok(emotePose('slump', 1000).bow > 0.4);
  assert.equal(emotePose('fall', 1200).rz, -Math.PI / 2);
});
