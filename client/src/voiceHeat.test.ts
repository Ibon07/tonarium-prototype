import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEAT_HALF_LIFE_SEC, HEAT_MIN, addHeat, cellCenter, cellOf, decayHeat, heatCells } from './voiceHeat.ts';

test('位置は 3m のセルに分けられ、中心が戻る', () => {
  assert.deepEqual(cellOf(0, 0), { cx: 0, cz: 0 });
  assert.deepEqual(cellOf(2.9, -0.1), { cx: 0, cz: -1 });
  assert.deepEqual(cellCenter(0, -1), { x: 1.5, z: -1.5 });
});

test('発話で熱が溜まり、1 で頭打ちになる', () => {
  const cells = new Map<string, number>();
  addHeat(cells, 1, 1, 2);
  assert.equal(heatCells(cells)[0].heat, 0.5);
  addHeat(cells, 1, 1, 10);
  assert.equal(heatCells(cells)[0].heat, 1);
  addHeat(cells, 1, 1, 0);
  assert.equal(heatCells(cells).length, 1);
});

test('熱は半減期で冷め、下限を割ると消える', () => {
  const cells = new Map<string, number>();
  addHeat(cells, 0, 0, 4);
  decayHeat(cells, HEAT_HALF_LIFE_SEC);
  assert.equal(heatCells(cells)[0].heat, 0.5);
  decayHeat(cells, HEAT_HALF_LIFE_SEC * 20);
  assert.equal(heatCells(cells).length, 0);
  assert.ok(HEAT_MIN > 0);
});

test('別のセルの熱は混ざらない', () => {
  const cells = new Map<string, number>();
  addHeat(cells, 0, 0, 2);
  addHeat(cells, 10, 0, 2);
  assert.equal(heatCells(cells).length, 2);
});
