import type { AvatarState, User } from '../shared/protocol.ts';
import {
  CELEBRATE_MS, MIN_PLAYERS, TILE_BREAK_MS, TILE_COUNT, inJoinArea, newGame, type GameState,
} from '../shared/game.ts';

/** 板わたりの進行。状態はセッションごとに 1 つ、サーバーが持つ */
export interface GameDeps {
  sendGame: (sid: string, g: GameState) => void;
  sendTile: (sid: string, tile: number, at: number) => void;
  event: (sid: string, text: string) => void;
}

const games = new Map<string, GameState>();
const resetTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const gameOf = (sid: string) => {
  let g = games.get(sid);
  if (!g) { g = newGame(); games.set(sid, g); }
  return g;
};
export const allGames = () => Object.fromEntries(games);

/** 参加エリアにいる 3D の人が 2 人以上いれば始める */
export function startGame(sid: string, by: User, here: User[], avatars: Map<string, AvatarState>, d: GameDeps) {
  const g = gameOf(sid);
  if (g.phase !== 'idle') return;
  const players = here.filter((u) => {
    const a = u.mode === '3d' ? avatars.get(u.id) : undefined;
    return a && inJoinArea(a.x, a.z);
  });
  if (players.length < MIN_PLAYERS) return;
  const next: GameState = {
    round: g.round + 1, phase: 'running', winner: null, startedAt: Date.now(), tiles: {},
    players: players.map((u) => ({ id: u.id, name: u.name, out: null })),
  };
  games.set(sid, next);
  d.sendGame(sid, next);
  d.event(sid, `${by.name} が板わたりを始めました（${players.map((u) => u.name).join('・')}）`);
}

export function stepTile(sid: string, u: User, tile: number, d: GameDeps) {
  const g = gameOf(sid);
  if (g.phase === 'idle' || !Number.isInteger(tile) || tile < 0 || tile >= TILE_COUNT || g.tiles[tile] !== undefined) return;
  if (!g.players.some((p) => p.id === u.id && p.out === null)) return;
  const at = Date.now() + TILE_BREAK_MS;
  g.tiles[tile] = at;
  d.sendTile(sid, tile, at);
}

/** 落ちた・抜けた人を脱落にし、残りが 1 人以下なら勝者を決める */
export function eliminate(sid: string, userId: string, d: GameDeps) {
  const g = games.get(sid);
  if (!g || g.phase !== 'running') return;
  const p = g.players.find((x) => x.id === userId && x.out === null);
  if (!p) return;
  p.out = Date.now();
  const alive = g.players.filter((x) => x.out === null);
  if (alive.length <= 1) {
    // 全員がほぼ同時に落ちたときは、最後に落ちた人の勝ち
    const winner = alive[0] ?? p;
    g.phase = 'ended';
    g.winner = winner.id;
    d.event(sid, `🏆 ${winner.name} が板わたりで優勝しました！`);
    clearTimeout(resetTimers.get(sid));
    resetTimers.set(sid, setTimeout(() => resetGame(sid, d), CELEBRATE_MS));
  } else {
    d.event(sid, `${p.name} が落ちました（残り ${alive.length} 人）`);
  }
  d.sendGame(sid, g);
}

/** 板を元に戻して次のゲームを受け付ける。勝者の表示は次が始まるまで残す */
export function resetGame(sid: string, d: GameDeps) {
  clearTimeout(resetTimers.get(sid));
  resetTimers.delete(sid);
  const g = gameOf(sid);
  const next: GameState = { ...newGame(g.round), winner: g.winner, players: g.players };
  games.set(sid, next);
  d.sendGame(sid, next);
}
