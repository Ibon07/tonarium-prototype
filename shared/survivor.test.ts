import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSurvivorState } from './survivor.ts';

test('survivor state records treat __proto__ as an ordinary key', () => {
  const s = newSurvivorState();
  const marker = { id: '__proto__' } as never;
  s.players['__proto__'] = marker;
  s.stylePicks['__proto__'] = 'bloodrose';
  assert.equal(s.players['__proto__'], marker);
  assert.equal(Object.keys(s.players).length, 1);
  assert.equal(({} as Record<string, unknown>).id, undefined);
  assert.equal(Object.getPrototypeOf(s.players), null);
  assert.equal(Object.getPrototypeOf(s.stylePicks), null);
});
