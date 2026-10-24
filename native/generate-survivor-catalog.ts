import './generate-survivor-audio.cjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOM_HALF } from '../shared/protocol.ts';
import { SURVIVOR_WORLD_LIMIT, SURVIVOR_JOIN, SURVIVOR_DURATION_MS, SURVIVOR_MOVE_SPEED, SURVIVOR_TITLE, SURVIVOR_STYLES, SURVIVOR_GEAR, SURVIVOR_META_UPGRADES, SURVIVOR_ACHIEVEMENTS } from '../shared/survivor.ts';
writeFileSync(fileURLToPath(new URL('./Tonarium.Desktop/Assets/survivor.json', import.meta.url)), JSON.stringify({ constants: { join: SURVIVOR_JOIN, durationMs: SURVIVOR_DURATION_MS, moveSpeed: SURVIVOR_MOVE_SPEED, roomHalf: ROOM_HALF, worldLimit: SURVIVOR_WORLD_LIMIT }, title: SURVIVOR_TITLE, styles: SURVIVOR_STYLES, gear: SURVIVOR_GEAR, upgrades: SURVIVOR_META_UPGRADES, achievements: SURVIVOR_ACHIEVEMENTS }, null, 2) + '\n');
