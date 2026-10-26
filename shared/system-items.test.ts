import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ITEM_INFO, type ItemKind } from './items.ts';
import { MARKET_PRODUCTS } from './market.ts';
import { systemItemDefinition, systemItemDefinitions, systemItemInstanceId } from './system-items.ts';
import { createSystemMap } from './system-map.ts';
import type { SystemCatalog, SystemManifest, SystemObject } from './system-types.ts';
import { validateSystemMap } from './systems.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../shared-systems/button/1.0.0/system.json', import.meta.url), 'utf8')) as SystemManifest;
const catalog: SystemCatalog = { schema: 1, commit: 'a'.repeat(40), entries: [{ id: manifest.id, version: manifest.version, integrity: 'sha256-' + 'b'.repeat(64), manifest }] };
const mapWith = (object: SystemObject) => ({ schema: 1 as const, id: 'map', objects: [object], systems: [], connections: [] });

test('registry exposes only non-market builtins without mutating shared metadata or the normal market', () => {
  const originalItems = structuredClone(ITEM_INFO), originalMarket = structuredClone(MARKET_PRODUCTS);
  const definitions = systemItemDefinitions();
  assert.equal(new Set(definitions.map(definition => definition.id)).size, definitions.length);
  for (const kind of Object.keys(ITEM_INFO) as ItemKind[]) {
    const marketKind = MARKET_PRODUCTS.some(product => product.category === 'items' && (product.id === kind || product.kind === kind));
    assert.equal(definitions.some(definition => definition.kind === kind), !ITEM_INFO[kind].media && !marketKind, kind);
  }
  for (const product of MARKET_PRODUCTS.filter(product => product.category === 'items')) {
    assert.equal(systemItemDefinition(product.id), undefined);
    assert.throws(() => validateSystemMap(mapWith({ id: 'target', itemId: product.id, capabilities: [], position: [0, 0, 0] }), catalog), /item ID/);
    if (product.category === 'items' && product.kind) assert.equal(systemItemDefinition(product.kind), undefined);
  }
  const note = systemItemDefinition('note')!; note.info.tint = '#000000';
  assert.notEqual(ITEM_INFO.note.tint, '#000000');
  assert.notEqual(systemItemDefinition('note')!.info.tint, '#000000');
  assert.deepEqual(ITEM_INFO, originalItems); assert.deepEqual(MARKET_PRODUCTS, originalMarket);
});

test('catalog IDs keep existing camelCase while unknown, media and other catalog categories fail', () => {
  for (const id of ['chessAi', 'g2048', 'jumpPad']) assert.equal(systemItemDefinition(id)?.kind, id);
  for (const id of ['unknown', 'chessai', 'image', 'video', 'youtube', 'star-lounge', 'sparkle-sound', 'constructor', '__proto__', '', null, 1, {}]) {
    assert.equal(systemItemDefinition(id), undefined);
    assert.throws(() => validateSystemMap(mapWith({ id: 'object', itemId: id as string, capabilities: [], position: [0, 0, 0] }), catalog), /item ID/);
  }
});

test('native item placements default to native functionality and independent stable instance identities', () => {
  const placement = { id: 'left-note', itemId: 'note', position: [1, 0, 2] as [number, number, number] };
  const builder = createSystemMap('lounge').item(placement).item({ id: 'right-note', itemId: 'note', position: [-1, 0, 2] });
  placement.position[0] = 100;
  const map = builder.build(catalog);
  assert.deepEqual(map.objects[0].position, [1, 0, 2]);
  assert.equal(map.objects[0].itemMode, 'native'); assert.deepEqual(map.objects[0].capabilities, []);
  assert.equal(systemItemInstanceId(map.id, map.objects[0].id), 'system-map:lounge:left-note');
  assert.notEqual(systemItemInstanceId(map.id, map.objects[0].id), systemItemInstanceId(map.id, map.objects[1].id));
  assert.notEqual(systemItemInstanceId('other-lounge', map.objects[0].id), systemItemInstanceId(map.id, map.objects[0].id));
  map.objects[0].position[0] = 9; assert.equal(builder.build().objects[0].position[0], 1);
  validateSystemMap(createSystemMap('all-items').item({ id: 'ai', itemId: 'chessAi', position: [0, 0, 0] }).item({ id: 'pad', itemId: 'jumpPad', position: [2, 0, 0] }).build(), catalog);
});

test('maximum map and object IDs are stable without truncation or ambiguous namespace collisions', () => {
  const mapId = 'm'.repeat(64), objectId = 'o'.repeat(64);
  const map = createSystemMap(mapId).item({ id: objectId, itemId: 'note', position: [0, 0, 0] }).build(catalog);
  const id = systemItemInstanceId(map.id, map.objects[0].id);
  assert.equal(id, `system-map:${mapId}:${objectId}`);
  assert.equal(systemItemInstanceId(mapId, objectId), id);
  for (const invalid of ['a'.repeat(65), 'map:object', 'camelCase', 'constructor', '', null]) {
    assert.throws(() => systemItemInstanceId(invalid as string, 'object'), /identity/);
    assert.throws(() => systemItemInstanceId('map', invalid as string), /identity/);
  }
  assert.throws(() => createSystemMap('duplicate').item({ id: 'same', itemId: 'note', position: [0, 0, 0] }).item({ id: 'same', itemId: 'chess', position: [1, 0, 0] }).build(catalog), /object identity/);
});

test('system mode allows explicit button bindings and supported capabilities while native bindings fail', () => {
  for (const definition of systemItemDefinitions()) {
    validateSystemMap(createSystemMap('controlled').item({ id: 'target', itemId: definition.id, itemMode: 'system', capabilities: ['interact', 'move', 'seat'], position: [0, 0, 0] })
      .system({ instanceId: 'button', systemId: 'button', bindings: { target: ['target'] }, config: {} }).build(), catalog);
  }
  const native = createSystemMap('native').item({ id: 'target', itemId: 'note', position: [0, 0, 0] })
    .system({ instanceId: 'button', systemId: 'button', bindings: { target: ['target'] }, config: {} }).build();
  assert.throws(() => validateSystemMap(native, catalog), /binding target\/capability/);
  for (const mode of [undefined, 'native'] as const) {
    assert.throws(() => validateSystemMap(mapWith({ id: 'target', itemId: 'note', itemMode: mode, capabilities: ['interact'], position: [0, 0, 0] }), catalog), /native item cannot/);
    assert.throws(() => validateSystemMap(mapWith({ id: 'target', itemId: 'chess', itemMode: mode, capabilities: [], position: [0, 0, 0], solid: true }), catalog), /system collision body/);
  }
});

test('only note-based system items can display text and all item placements stay on the ground', () => {
  validateSystemMap(mapWith({ id: 'target', itemId: 'note', itemMode: 'system', capabilities: ['text'], position: [0, 0, 0] }), catalog);
  for (const id of ['chess', 'canvas', 'camera']) assert.throws(() => validateSystemMap(mapWith({ id: 'target', itemId: id, itemMode: 'system', capabilities: ['text'], position: [0, 0, 0] }), catalog), /text capability requires note/);
  for (const mode of ['native', 'system'] as const) {
    for (const y of [-1, 0.1]) assert.throws(() => validateSystemMap(mapWith({ id: 'target', itemId: 'note', itemMode: mode, capabilities: [], position: [0, y, 0] }), catalog), /on ground/);
  }
  assert.throws(() => validateSystemMap(mapWith({ id: 'target', itemId: 'note', itemMode: 'both' as 'system', capabilities: [], position: [0, 0, 0] }), catalog), /item mode/);
  assert.throws(() => validateSystemMap(mapWith({ id: 'target', itemMode: 'system', capabilities: [], position: [0, 1, 0] }), catalog), /requires item ID/);
  validateSystemMap(mapWith({ id: 'plain-object', capabilities: ['text'], position: [0, 2, 0] }), catalog);
});
