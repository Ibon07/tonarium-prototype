import { ROOM_HALF } from './protocol.ts';

/** Cooperative 10-minute survival run. The server owns all run and profile state. */
export const SURVIVOR_TITLE = '宵闇サバイバーズ：夜明けまで10分';
export const SURVIVOR_DURATION_MS = 10 * 60_000;
export const SURVIVOR_TICK_MS = 200;
export const SURVIVOR_JOIN = { x: 0, z: 6.5, r: 1.8 };
/** Player centers stay inside the ordinary Tonarium room walls (ROOM_HALF - 0.5). */
export const SURVIVOR_WORLD_LIMIT = ROOM_HALF - 0.5;
export const clampSurvivorPosition = (x: number, z: number) => ({
  x: Math.max(-SURVIVOR_WORLD_LIMIT, Math.min(SURVIVOR_WORLD_LIMIT, x)),
  z: Math.max(-SURVIVOR_WORLD_LIMIT, Math.min(SURVIVOR_WORLD_LIMIT, z)),
});
export const SURVIVOR_MOVE_SPEED = 4.2;
export const SURVIVOR_MAX_ENEMIES = 180;

export type SurvivorStyle = 'bloodrose' | 'stargazer' | 'wraith';
export type SurvivorRarity = 'common' | 'rare' | 'epic' | 'mythic';
export type SurvivorGearKind = 'weapon' | 'passive';

export const SURVIVOR_STYLES: Record<SurvivorStyle, { name: string; mark: string; desc: string; weapon: string; hp: number; speed: number }> = {
  bloodrose: { name: '紅蓮の剣士', mark: '⚔', desc: '周囲を薙ぐ刃。体力が高く、近距離戦が得意。', weapon: 'moonblade', hp: 120, speed: 4.2 },
  stargazer: { name: '星詠み', mark: '✦', desc: '最も近い敵へ星弾を放つ。攻撃の回転が速い。', weapon: 'starbolt', hp: 90, speed: 4.2 },
  wraith: { name: '宵渡り', mark: '☾', desc: '影の波で敵を貫く。移動が速く、敵をかわしやすい。', weapon: 'shade', hp: 100, speed: 4.8 },
};

export interface SurvivorGearDef {
  id: string; name: string; kind: SurvivorGearKind; rarity: SurvivorRarity; desc: string;
  maxLevel: number; synergy?: string; evolvedFrom?: string[];
}

export const SURVIVOR_GEAR: Record<string, SurvivorGearDef> = {
  moonblade: { id: 'moonblade', name: '月蝕の刃', kind: 'weapon', rarity: 'common', desc: '近くの敵を斬る回転刃。', maxLevel: 5, synergy: 'ironheart' },
  starbolt: { id: 'starbolt', name: '星屑の弾丸', kind: 'weapon', rarity: 'common', desc: '最も近い敵へ星弾を放つ。', maxLevel: 5, synergy: 'astralbook' },
  shade: { id: 'shade', name: '影縫い', kind: 'weapon', rarity: 'common', desc: '前方へ影の波を放ち、敵を貫く。', maxLevel: 5, synergy: 'nightcloak' },
  bloodaura: { id: 'bloodaura', name: '血月の輪', kind: 'weapon', rarity: 'rare', desc: '周囲を焼く血のオーラ。', maxLevel: 5, synergy: 'soulcrown' },
  ironheart: { id: 'ironheart', name: '鉄の心臓', kind: 'passive', rarity: 'common', desc: '最大体力と防御力が上がる。', maxLevel: 5 },
  astralbook: { id: 'astralbook', name: '星図の書', kind: 'passive', rarity: 'common', desc: '武器の攻撃間隔が短くなる。', maxLevel: 5 },
  nightcloak: { id: 'nightcloak', name: '夜渡りの外套', kind: 'passive', rarity: 'rare', desc: '移動速度と無敵時間が上がる。', maxLevel: 5 },
  soulcrown: { id: 'soulcrown', name: '魂喰らいの冠', kind: 'passive', rarity: 'epic', desc: '敵を倒したときの経験値が増える。', maxLevel: 5 },
  eclipse: { id: 'eclipse', name: '皆既の王冠', kind: 'weapon', rarity: 'mythic', desc: '月蝕・星・影を束ねる究極の魔具。', maxLevel: 1 },
  starfall: { id: 'starfall', name: '星界落とし', kind: 'weapon', rarity: 'mythic', desc: '広範囲へ星を降らせる。', maxLevel: 1 },
  umbralstorm: { id: 'umbralstorm', name: '常夜の嵐', kind: 'weapon', rarity: 'mythic', desc: '影の奔流が敵を呑み込む。', maxLevel: 1 },
  crimsonsun: { id: 'crimsonsun', name: '紅き太陽', kind: 'weapon', rarity: 'mythic', desc: '血月の輪が灼熱の太陽へ変わる。', maxLevel: 1 },
};

export const SURVIVOR_RARITY_ORDER: SurvivorRarity[] = ['common', 'rare', 'epic', 'mythic'];
export const SURVIVOR_META_UPGRADES = {
  might: { name: '夜狩りの鍛錬', desc: '攻撃力 +5%', cost: 2, max: 10 },
  vitality: { name: '血の祝福', desc: '最大体力 +10', cost: 2, max: 10 },
  haste: { name: '風切り', desc: '移動速度 +3%', cost: 2, max: 10 },
} as const;
export type SurvivorMetaUpgrade = keyof typeof SURVIVOR_META_UPGRADES;

export const SURVIVOR_ACHIEVEMENTS = {
  firstNight: { name: 'はじめての夜', desc: '初めてランを終える' },
  level10: { name: '夜明けの兆し', desc: '1回のランでレベル10に到達' },
  level25: { name: '宵闇の覇者', desc: '1回のランでレベル25に到達' },
  boss: { name: '夜を越えて', desc: '10分後の強敵を倒す' },
  mythic: { name: '神話の目撃者', desc: '神話級の装備を獲得' },
} as const;
export type SurvivorAchievement = keyof typeof SURVIVOR_ACHIEVEMENTS;

export interface SurvivorPlayer {
  id: string; name: string; style: SurvivorStyle; x: number; z: number;
  hp: number; maxHp: number; level: number; xp: number; nextXp: number;
  alive: boolean; kills: number; gear: Record<string, number>;
  choiceQueue: string[][]; hitAt: number; attackAt: Record<string, number>; moveAt: number;
}
export interface SurvivorEnemy {
  id: string; kind: 'ghoul' | 'bat' | 'knight' | 'boss'; x: number; z: number;
  hp: number; maxHp: number; speed: number; damage: number; xp: number; radius: number;
  hitAt: number; attackAt: number;
}
export interface SurvivorAttackEffect {
  id: string; playerId: string; gear: string; at: number;
  from: { x: number; z: number }; targets: { x: number; z: number }[]; reach: number;
}
export interface SurvivorState {
  run: number; phase: 'lobby' | 'running' | 'boss' | 'ended'; startedAt: number; endedAt: number | null;
  /** Level-up choices pause the shared run until every living player has chosen. */
  pausedAt: number | null;
  players: Record<string, SurvivorPlayer>; enemies: SurvivorEnemy[]; effects: SurvivorAttackEffect[]; stylePicks: Record<string, SurvivorStyle>;
  kills: number; spawnIndex: number; nextSpawnAt: number; randomSeed: number; bossDefeated: boolean;
}
export interface SurvivorProfile {
  points: number; upgrades: Record<SurvivorMetaUpgrade, number>;
  runs: number; bestLevel: number; bestKills: number;
  achievements: SurvivorAchievement[]; discovered: string[];
}

export const newSurvivorState = (): SurvivorState => ({
  run: 0, phase: 'lobby', startedAt: 0, endedAt: null, pausedAt: null, players: {}, enemies: [], effects: [], stylePicks: {},
  kills: 0, spawnIndex: 0, nextSpawnAt: 0, randomSeed: 1, bossDefeated: false,
});
export const newSurvivorProfile = (): SurvivorProfile => ({
  points: 0, upgrades: { might: 0, vitality: 0, haste: 0 }, runs: 0, bestLevel: 0, bestKills: 0,
  achievements: [], discovered: [],
});
export const survivorXpFor = (level: number) => 8 + level * 4;
export const survivorDistance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
export const SURVIVOR_EVOLUTIONS: Record<string, string> = {
  moonblade: 'eclipse', starbolt: 'starfall', shade: 'umbralstorm', bloodaura: 'crimsonsun',
};
