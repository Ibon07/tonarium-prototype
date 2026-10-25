import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocked, blockedByTrain, moveFlight, recoverPosition } from './movement.ts';
import { CAR, PLATFORM_Y, carPose, fromCarLocal } from '../../../shared/city.ts';
import type { Solid } from '../../../shared/worlds.ts';

const wall: Solid = { x: 1, z: 0, w: 0.1, d: 10, y0: 0, y1: 6 };
const ceiling = { x0: -5, x1: 5, z0: -5, z1: 5, ya: 3, yb: 3 };
const collides = (p: { x: number; y: number; z: number }) => blocked(p, [wall], [ceiling]);

test('fly stops at walls, floors and ceilings, including large movement steps', () => {
  const start = { x: 0, y: 0, z: 0 };
  const wallStop = moveFlight(start, { x: 4, y: 0, z: 0 }, collides);
  assert.ok(wallStop.x > 0.5 && wallStop.x <= 0.65);
  const ceilingStop = moveFlight(start, { x: 0, y: 5, z: 0 }, collides);
  assert.ok(ceilingStop.y > 1 && ceilingStop.y <= 1.18 + 1e-7);
  assert.equal(moveFlight(start, { x: 0, y: -5, z: 0 }, collides).y, 0);
  assert.equal(collides(wallStop), false);
  assert.equal(collides(ceilingStop), false);
});

test('flight moves in six directions and stays still without input; noclip crosses colliders', () => {
  const start = { x: -2, y: 0.5, z: 0 };
  for (const axis of ['x', 'y', 'z'] as const) for (const sign of [-1, 1]) {
    const delta = { x: 0, y: 0, z: 0, [axis]: sign * 0.1 };
    const end = moveFlight(start, delta, collides);
    assert.ok(Math.abs(end[axis] - start[axis] - delta[axis]) < 1e-8);
  }
  assert.deepEqual(moveFlight(start, { x: 0, y: 0, z: 0 }, collides), start);
  const end = moveFlight(start, { x: 6, y: -4, z: 0 }, () => false);
  assert.ok(Math.abs(end.x - 4) < 1e-8 && end.y < 0);
});

test('restoring collision validates correction, handles below-floor and ceiling penetration', () => {
  for (const inside of [{ x: 1, y: 1, z: 0 }, { x: 0, y: -2, z: 0 }, { x: 0, y: 2, z: 0 }]) {
    const safe = recoverPosition(inside, { x: -3, y: 0, z: 0 }, [wall], (p) => !collides(p));
    assert.ok(safe);
    assert.equal(collides(safe), false);
  }
  const airborne = { x: -2, y: 5, z: 0 };
  assert.deepEqual(recoverPosition(airborne, { x: 0, y: 0, z: 0 }, [wall], (p) => !collides(p)), airborne);
});

test('fallback uses verified spawn and rejects impossible recovery', () => {
  const inside = { x: 1, y: 1, z: 0 };
  const spawn = { x: 30, y: 0, z: 0 };
  assert.deepEqual(recoverPosition(inside, spawn, [wall], (p) => p.x === 30 && p.y === 0), spawn);
  assert.equal(recoverPosition(inside, spawn, [wall], () => false), null);
});

test('train floors, roofs and ends block flight in train coordinates', () => {
  const now = 10000;
  const pose = carPose(now, 0);
  const floor = fromCarLocal(pose, 0, 0);
  assert.equal(blockedByTrain({ ...floor, y: PLATFORM_Y - 0.2 }, now), true);
  assert.equal(blockedByTrain({ ...floor, y: PLATFORM_Y }, now), false);
  assert.equal(blockedByTrain({ ...floor, y: PLATFORM_Y + CAR.h - 0.2 }, now), true);
  const end = fromCarLocal(pose, CAR.len / 2, 0);
  assert.equal(blockedByTrain({ ...end, y: PLATFORM_Y }, now), true);
});
