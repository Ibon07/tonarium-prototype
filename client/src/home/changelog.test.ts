import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGELOG } from '../../../shared/changelog.ts';
import { loadChangelogSeen, markChangelogSeen, useChangelog } from './changelog.ts';

test('履歴は日付の新しい順で、日付・見出し・本文を持つ', () => {
  assert.ok(CHANGELOG.length >= 3);
  CHANGELOG.forEach((entry, i) => {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.title && entry.items.length && entry.items.every(Boolean));
    if (i) assert.ok(CHANGELOG[i - 1].date >= entry.date);
  });
});

test('既読日付を保存して再読み込みし、保存できない環境では今回だけ既読にする', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    assert.ok(CHANGELOG[0].date > loadChangelogSeen());
    markChangelogSeen();
    assert.equal(values.get('tonarium.changelog.seen'), CHANGELOG[0].date);
    assert.equal(useChangelog.getState().seen, CHANGELOG[0].date);
    assert.equal(loadChangelogSeen(), CHANGELOG[0].date);
    assert.equal(CHANGELOG[0].date > loadChangelogSeen(), false);
    Reflect.deleteProperty(globalThis, 'localStorage');
    assert.equal(loadChangelogSeen(), '');
    assert.doesNotThrow(markChangelogSeen);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.equal(loadChangelogSeen(), '');
    useChangelog.setState({ seen: '' });
    assert.doesNotThrow(markChangelogSeen);
    assert.equal(useChangelog.getState().seen, CHANGELOG[0].date);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => null, setItem: () => { throw new Error('denied'); },
    } });
    assert.doesNotThrow(markChangelogSeen);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
