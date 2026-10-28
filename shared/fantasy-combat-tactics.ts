import type { FantasyCombatFighter, FantasyCombatRange, FantasyCombatState } from './fantasy-combat.ts';
import { fantasyObstacleBreak, fantasyObstacleKind, fantasyObstaclePassage, type FantasyObstacleDamage } from './fantasy-obstacles.ts';

export interface FantasyCombatTile { x: number; y: number }
export interface FantasyCombatObstaclePlacement { kind: string; tile: FantasyCombatTile; hp?: number }
export interface FantasyCombatBattlefield { width: 10; height: 8; blocked: FantasyCombatTile[]; cover: FantasyCombatTile[]; obstacles?: FantasyCombatObstaclePlacement[] }
export const fantasyCombatTileKey = (tile: FantasyCombatTile) => `${tile.x}:${tile.y}`;
export const fantasyCombatDistance = (a: FantasyCombatTile, b: FantasyCombatTile) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const fantasyCombatActors = (state: FantasyCombatState): FantasyCombatFighter[] => [...state.fighters, ...(state.units ?? []), ...(state.escort ? [state.escort.wagon] : [])];
export const fantasyCombatField = (): FantasyCombatBattlefield => ({ width: 10, height: 8,
  blocked: [{ x: 4, y: 0 }, { x: 5, y: 0 }, { x: 4, y: 7 }, { x: 5, y: 7 }],
  cover: [{ x: 3, y: 2 }, { x: 3, y: 5 }, { x: 6, y: 2 }, { x: 6, y: 5 }],
});
/** 障害物の多い戦場。中央の列を塞ぐので、壊すか回り込まないと前線に出られない。 */
export function fantasyCombatBarricadeField(seed = 1): FantasyCombatBattlefield {
  const base = fantasyCombatField(), rng = (() => { let state = (seed + 1) >>> 0; return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296; })();
  const kinds = ['thick-vine', 'boulder', 'great-ice', 'fallen-log', 'rubble', 'barrel', 'low-wall', 'hole'];
  const taken = new Set([...base.blocked, ...base.cover].map(fantasyCombatTileKey));
  const obstacles: FantasyCombatObstaclePlacement[] = [];
  for (const tile of [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 1 }, { x: 5, y: 3 }, { x: 5, y: 5 }]) {
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const key = fantasyCombatTileKey(tile);
    if (taken.has(key)) continue;
    taken.add(key); obstacles.push({ kind, tile });
  }
  return { ...base, obstacles };
}
/** 遠距離の敵を置くための、敵側の後方タイル。 */
export function fantasyCombatRangedTiles(count: number): FantasyCombatTile[] {
  const tiles: FantasyCombatTile[] = [];
  for (const x of [8, 9, 7, 6]) for (let y = 0; y < 8 && tiles.length < count; y++) if (y % 2 === 1) tiles.push({ x, y });
  return tiles.slice(0, count);
}/** 戦場に障害物を置く。既に埋まっているタイルや上限超過は拒否する。 */
export function fantasyCombatPlaceObstacle(state: FantasyCombatState, kind: string, tile: FantasyCombatTile): boolean {
  const field = state.battlefield;
  if (!field || !fantasyObstacleKind(kind) || !fantasyCombatValidTile(field, tile)) return false;
  const obstacles = field.obstacles ?? [];
  if (obstacles.length >= 20) return false;
  const key = fantasyCombatTileKey(tile);
  if ([...field.blocked, ...field.cover, ...obstacles.map(value => value.tile)].some(value => fantasyCombatTileKey(value) === key)) return false;
  if (fantasyCombatActors(state).some(value => value.hp > 0 && !value.fled && value.tile && fantasyCombatTileKey(value.tile) === key)) return false;
  field.obstacles = [...obstacles, { kind, tile }];
  return true;
}
/** 盾役が仮の遮蔽を置ける、体の前の空きタイル。 */
export function fantasyCombatCoverTile(state: FantasyCombatState, actor: FantasyCombatFighter): FantasyCombatTile | undefined {
  const field = state.battlefield;
  if (!field || !actor.tile) return undefined;
  const occupied = new Set([...field.blocked, ...field.cover, ...(field.obstacles ?? []).map(value => value.tile), ...fantasyCombatActors(state)
    .filter(value => value.hp > 0 && !value.fled && value.tile).map(value => value.tile!)].map(fantasyCombatTileKey));
  const enemies = state.fighters.filter(value => value.side !== actor.side && value.hp > 0 && !value.fled && value.tile);
  const ahead = enemies.length ? { x: Math.sign(Math.round(enemies.reduce((sum, value) => sum + value.tile!.x, 0) / enemies.length - actor.tile.x)), y: 0 } : { x: 1, y: 0 };
  const candidates = [{ x: actor.tile.x + (ahead.x || 1), y: actor.tile.y }, { x: actor.tile.x, y: actor.tile.y - 1 }, { x: actor.tile.x, y: actor.tile.y + 1 }, { x: actor.tile.x - (ahead.x || 1), y: actor.tile.y }];
  return candidates.find(tile => fantasyCombatValidTile(field, tile) && !occupied.has(fantasyCombatTileKey(tile)));
}/** 障害物を攻撃で壊す。壊れた配置は戦場から消え、進路と視界が開く。 */
export function fantasyCombatBreakObstacle(state: FantasyCombatState, tile: FantasyCombatTile, damage: number, type: FantasyObstacleDamage): { destroyed: boolean; dealt: number } | undefined {
  const field = state.battlefield, key = fantasyCombatTileKey(tile);
  const entry = field?.obstacles?.find(value => fantasyCombatTileKey(value.tile) === key);
  const kind = entry && fantasyObstacleKind(entry.kind);
  if (!field?.obstacles || !entry || !kind) return undefined;
  const result = fantasyObstacleBreak({ ...kind, hp: entry.hp ?? kind.hp }, damage, type);
  if (!result) return undefined;
  if (result.hp <= 0) field.obstacles = field.obstacles.filter(value => fantasyCombatTileKey(value.tile) !== key);
  else entry.hp = result.hp;
  return { destroyed: result.hp <= 0, dealt: result.dealt };
}
export function fantasyCombatValidTile(field: FantasyCombatBattlefield, tile: unknown): tile is FantasyCombatTile {
  if (!tile || typeof tile !== 'object' || Array.isArray(tile)) return false;
  const value = tile as Record<string, unknown>;
  return Object.keys(value).length === 2 && Number.isInteger(value.x) && Number.isInteger(value.y)
    && Number(value.x) >= 0 && Number(value.x) < field.width && Number(value.y) >= 0 && Number(value.y) < field.height;
}
export function fantasyCombatValidField(value: unknown): value is FantasyCombatBattlefield {
  if (!value || typeof value !== 'object') return false;
  const field = value as FantasyCombatBattlefield;
  return [4, 5].includes(Object.keys(field).length) && field.width === 10 && field.height === 8
    && [field.blocked, field.cover].every(list => Array.isArray(list) && list.length <= 20
      && list.every(tile => fantasyCombatValidTile(field, tile)) && new Set(list.map(fantasyCombatTileKey)).size === list.length)
    && !field.cover.some(tile => field.blocked.some(block => fantasyCombatTileKey(tile) === fantasyCombatTileKey(block)))
    && (field.obstacles === undefined || Array.isArray(field.obstacles) && field.obstacles.length <= 20
      && field.obstacles.every(entry => entry && typeof entry.kind === 'string' && !!fantasyObstacleKind(entry.kind) && fantasyCombatValidTile(field, entry.tile)
        && (entry.hp === undefined || Number.isSafeInteger(entry.hp) && entry.hp > 0 && entry.hp <= fantasyObstacleKind(entry.kind)!.hp))
      && new Set(field.obstacles.map(entry => fantasyCombatTileKey(entry.tile))).size === field.obstacles.length
      && !field.obstacles.some(entry => [...field.blocked, ...field.cover].some(tile => fantasyCombatTileKey(tile) === fantasyCombatTileKey(entry.tile))));
}
export const fantasyCombatMoveRange = (actor: FantasyCombatFighter) => Math.max(1, Math.min(4, 2 + Math.floor(actor.stats.agility / 20) - (actor.effects.some(effect => effect.id === 'frost') ? 1 : 0)));
export function fantasyCombatPath(state: FantasyCombatState, actor: FantasyCombatFighter, destination: FantasyCombatTile): FantasyCombatTile[] | undefined {
  const field = state.battlefield;
  if (!field || !actor.tile || !fantasyCombatValidTile(field, destination)) return undefined;
  const obstacleBlocks = (field.obstacles ?? []).filter(entry => {
    const kind = fantasyObstacleKind(entry.kind);
    return !kind || fantasyObstaclePassage(kind, actor.body ?? {}) === 'block';
  }).map(entry => fantasyCombatTileKey(entry.tile));
  const passableObstacles = new Set((field.obstacles ?? []).filter(entry => !obstacleBlocks.includes(fantasyCombatTileKey(entry.tile))).map(entry => fantasyCombatTileKey(entry.tile)));
  if (passableObstacles.has(fantasyCombatTileKey(destination))) return undefined;
  const occupied = new Set([...field.blocked.map(fantasyCombatTileKey), ...obstacleBlocks, ...fantasyCombatActors(state)
    .filter(f => f.id !== actor.id && f.hp > 0 && !f.fled && f.tile).map(f => fantasyCombatTileKey(f.tile!))]);
  const queue: FantasyCombatTile[][] = [[actor.tile]], seen = new Set([fantasyCombatTileKey(actor.tile)]);
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index], current = path.at(-1)!;
    if (fantasyCombatTileKey(current) === fantasyCombatTileKey(destination)) return path;
    for (const next of [{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y }, { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }]) {
      const key = fantasyCombatTileKey(next);
      if (fantasyCombatValidTile(field, next) && !occupied.has(key) && !seen.has(key)) { seen.add(key); queue.push([...path, next]); }
    }
  }
  return undefined;
}
export function fantasyCombatLineOfSight(state: FantasyCombatState, a: FantasyCombatTile, b: FantasyCombatTile): boolean {
  const field = state.battlefield;
  if (!field) return true;
  const dx = b.x - a.x, dy = b.y - a.y, steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
  for (let i = 1; i < steps; i++) {
    const x = Math.round(a.x + dx * i / steps), y = Math.round(a.y + dy * i / steps);
    if (field.blocked.some(tile => tile.x === x && tile.y === y)) return false;
    if ((field.obstacles ?? []).some(entry => entry.tile.x === x && entry.tile.y === y && (fantasyObstacleKind(entry.kind)?.blocksSight ?? true))) return false;
  }
  return true;
}
export function fantasyCombatWithinRange(state: FantasyCombatState, actor: FantasyCombatFighter, target: FantasyCombatFighter, range: FantasyCombatRange): boolean {
  return !!actor.tile && !!target.tile && fantasyCombatDistance(actor.tile, target.tile) <= (range === 'melee' ? 1 : range === 'ranged' ? 7 : 8)
    && fantasyCombatLineOfSight(state, actor.tile, target.tile);
}
export function fantasyCombatCover(state: FantasyCombatState, target: FantasyCombatFighter): boolean {
  return !!target.tile && !!state.battlefield?.cover.some(tile => tile.x === target.tile!.x && tile.y === target.tile!.y);
}
export function fantasyCombatPlace(state: FantasyCombatState, actor: FantasyCombatFighter, preferred: FantasyCombatTile): boolean {
  if (!state.battlefield) return true;
  const occupied = new Set([...state.battlefield.blocked.map(fantasyCombatTileKey), ...(state.battlefield.obstacles ?? []).map(entry => fantasyCombatTileKey(entry.tile)), ...fantasyCombatActors(state)
    .filter(f => f.id !== actor.id && f.hp > 0 && !f.fled && f.tile).map(f => fantasyCombatTileKey(f.tile!))]);
  const candidates = Array.from({ length: 80 }, (_, index) => ({ x: index % 10, y: Math.floor(index / 10) }))
    .filter(tile => !occupied.has(fantasyCombatTileKey(tile)))
    .sort((a, b) => fantasyCombatDistance(a, preferred) - fantasyCombatDistance(b, preferred) || a.y - b.y || a.x - b.x);
  if (!candidates[0]) return false;
  actor.tile = candidates[0]; return true;
}
