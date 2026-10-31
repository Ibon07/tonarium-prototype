import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NPC_FRONTIER_PUBLIC } from './npc-frontier.ts';
import { FANTASY_FRONTIER_BASE } from './fantasy-frontier-data.ts';
import { NPC_PORTRAIT_DESIGNS, npcSvgPortraitUrl } from './npc-portraits.ts';
import { renderNpcPortrait } from '../scripts/generate-npc-portraits.ts';

test('the single dock quartermaster offers finite expedition provisions without lodging or training', () => {
  assert.equal(NPC_FRONTIER_PUBLIC.length, 1);
  const npc = NPC_FRONTIER_PUBLIC[0];
  assert.equal(npc.homeLocation, FANTASY_FRONTIER_BASE); assert.equal(npc.building, 'market');
  assert.deepEqual(npc.trainableJobs, []); assert.deepEqual(npc.trainableSkills, []);
  for (const locale of ['ko', 'en', 'ja'] as const) {
    assert.ok(npc.name[locale]); assert.ok(npc.role[locale]); assert.ok(npc.personality[locale]);
    assert.ok(npc.speech[locale]); assert.ok(npc.knownTopics[locale].length >= 3);
  }
  assert.match(npc.knownTopics.en.join(' '), /limited|rationed/);
  assert.match(npc.knownTopics.en.join(' '), /shelter|camp/);
});

test('the quartermaster has an individual local SVG portrait', () => {
  const npc = NPC_FRONTIER_PUBLIC[0], design = NPC_PORTRAIT_DESIGNS[npc.id];
  assert.ok(design); assert.equal(design.prop, 'ledger');
  const url = npcSvgPortraitUrl(npc.id)!;
  const svg = fs.readFileSync(new URL(`../client/public${url}`, import.meta.url), 'utf8');
  assert.equal(svg, renderNpcPortrait(npc, design));
  assert.ok(!/<script\b|<foreignObject\b|href=|url\(https?:/i.test(svg));
});
