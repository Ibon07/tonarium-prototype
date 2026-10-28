import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFantasyWorld, applyFantasyAction, newFantasyProfile, startFantasyActivity } from './fantasy-engine.ts';
import type { FantasyProfile } from './fantasy.ts';
import { isFantasyAction } from '../server/fantasy-store.ts';

function player() {
  const profile = applyFantasyAction(newFantasyProfile(), { type: 'create', name: 'Cancel test', gender: 'female', source: 'human' }, () => .5).profile;
  Object.assign(profile.character!, { job: 'thief', level: 25, birthBonuses: {}, hp: 100, mp: 50 });
  profile.character!.jobXp.thief = 0;
  return profile;
}
const summaries = (p: FantasyProfile) => p.log.filter(log => log.text.startsWith('仕事の集計［'));

test('cancel stops work midway, keeps rewards already settled and pays nothing more', () => {
  const started = startFantasyActivity(player(), { type: 'work' }, 8, () => .71).profile;
  const partial = advanceFantasyWorld(started, 8.5).profile;
  assert.equal(partial.activity!.work!.completed, 2);
  const gold = partial.character!.gold, xp = partial.character!.xp;
  assert.ok(gold > player().character!.gold);
  const cancelled = applyFantasyAction(partial, { type: 'cancel' }, () => .5);
  assert.equal(cancelled.error, undefined); assert.equal(cancelled.changed, true);
  assert.equal(cancelled.profile.activity, undefined);
  assert.equal(cancelled.profile.character!.gold, gold);
  assert.equal(cancelled.profile.character!.xp, xp);
  assert.equal(cancelled.profile.character!.hour, partial.character!.hour);
  assert.match(summaries(cancelled.profile)[0].text, /途中の受取分を含む/);
  assert.match(cancelled.profile.log.at(-1)!.text, /取り消した/);
  const later = advanceFantasyWorld(cancelled.profile, 12).profile;
  assert.equal(later.character!.gold, gold); assert.equal(later.character!.xp, xp);
  assert.equal(later.character!.jobXp.thief, 0);
});

test('cancelled work is not counted as a completed job or quest progress', () => {
  const started = startFantasyActivity(player(), { type: 'work' }, 8, () => .71).profile;
  const cancelled = applyFantasyAction(advanceFantasyWorld(started, 8.75).profile, { type: 'cancel' }).profile;
  assert.deepEqual(cancelled.character!.completed, started.character!.completed);
  assert.deepEqual(cancelled.character!.quests, started.character!.quests);
  assert.deepEqual(cancelled.character!.taskProgress, started.character!.taskProgress);
  assert.deepEqual(cancelled.character!.practice, started.character!.practice);
});

test('cancelling travel leaves the traveller in place without the fare', () => {
  const source = player();
  source.character!.gold = 50;
  const started = startFantasyActivity(source, { type: 'travel', destination: 'greenwood', transport: 'foot' }, 8, () => .5).profile;
  const cancelled = applyFantasyAction(started, { type: 'cancel' }).profile;
  assert.equal(cancelled.character!.location, source.character!.location);
  assert.equal(cancelled.character!.gold, 50);
  assert.equal(cancelled.character!.visited.includes('greenwood'), false);
  assert.equal(cancelled.activity, undefined);
});

test('escort travel cannot be cancelled and points to abandoning the escort', () => {
  const profile = player();
  profile.activity = { action: { type: 'travel', destination: 'greenwood', transport: 'escort' }, startedAt: 8, endsAt: 20, seed: 7 };
  const result = applyFantasyAction(profile, { type: 'cancel' });
  assert.equal(result.changed, false);
  assert.match(result.error!, /護衛/);
  assert.deepEqual(result.profile, profile);
});

test('cancel needs an activity, and a cancelled traveller can start again', () => {
  const idle = player();
  const rejected = applyFantasyAction(idle, { type: 'cancel' });
  assert.equal(rejected.changed, false); assert.ok(rejected.error);
  assert.deepEqual(rejected.profile, idle);
  const started = startFantasyActivity(idle, { type: 'work' }, 8, () => .71).profile;
  const cancelled = applyFantasyAction(started, { type: 'cancel' }).profile;
  const again = startFantasyActivity(cancelled, { type: 'work' }, cancelled.character!.hour, () => .71);
  assert.equal(again.error, undefined); assert.ok(again.profile.activity);
});

test('the server accepts exactly the cancel action shape', () => {
  assert.equal(isFantasyAction({ type: 'cancel' }), true);
  assert.equal(isFantasyAction({ type: 'cancel', extra: 1 }), false);
  assert.equal(isFantasyAction({ type: 'cancel', quest: 'x' }), false);
});
