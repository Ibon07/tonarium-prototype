import { ARENA, START_BUTTON } from './game.ts';

/** ワールド＝ 3D 空間の種類。セッションはどれか 1 つを読み込み、途中で切り替えられる */
export type WorldKind = 'room' | 'cafe' | 'game';

/** 床の上の通り抜けられない物。r があれば円、なければ w×d の箱（x, z が中心） */
export type Solid = { x: number; z: number; r: number } | { x: number; z: number; w: number; d: number };

export interface WorldInfo {
  name: string;
  desc: string;
  solids: Solid[];
  /** 3D の人がいられる範囲がいつもの部屋より広いとき（ゲームの塔など） */
  extent?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const chairsAround = (x: number, z: number, n: number, dist: number, start = 0): Solid[] =>
  Array.from({ length: n }, (_, i) => {
    const a = start + (i * Math.PI * 2) / n;
    return { x: x + Math.sin(a) * dist, z: z + Math.cos(a) * dist, r: 0.24 };
  });

/** カフェの家具の配置。見た目（View3D）と当たり判定で共用する */
export const CAFE = {
  counter: { x: -8.3, z: -1, w: 1.1, d: 8 },
  shelf: { x: -9.6, z: -1, w: 0.5, d: 8 },
  stools: [-4.2, -2.6, -1, 0.6, 2.2].map((z) => ({ x: -7.25, z, r: 0.22 })),
  /** 2 人用の丸テーブル。スポーンエリアはあけておく */
  tables: [
    { x: 3.2, z: -3.5 }, { x: 6.8, z: -3.5 },
    { x: 3.2, z: 0.5 }, { x: 6.8, z: 0.5 },
    { x: -3.8, z: 4.2 },
  ],
  /** 東の壁ぞいのソファ席 */
  sofa: { x: 9.25, z: 5, w: 0.9, d: 3.6 },
  sofaTable: { x: 7.9, z: 5, w: 0.8, d: 1.8 },
  plants: [{ x: 8.9, z: -8.9 }, { x: -8.9, z: 8.9 }, { x: 8.9, z: 8.9 }, { x: -3.2, z: -8.9 }],
};
export const CAFE_TABLE_R = 0.5;

export const WORLDS: Record<WorldKind, WorldInfo> = {
  room: { name: 'ホール', desc: '何も置いていない広い部屋', solids: [] },
  cafe: {
    name: 'カフェ',
    desc: 'カウンターとテーブル席のある落ち着いたカフェ',
    solids: [
      CAFE.counter, CAFE.shelf, ...CAFE.stools,
      ...CAFE.tables.flatMap((t) => [{ ...t, r: CAFE_TABLE_R }, ...chairsAround(t.x, t.z, 2, 0.85, Math.PI / 2)]),
      CAFE.sofa, CAFE.sofaTable,
      ...CAFE.plants.map((p) => ({ ...p, r: 0.4 })),
    ],
  },
  game: {
    name: 'ゲーム',
    desc: '板わたりサバイバル。ガラスの向こうの 5 層の塔で、最後まで落ちずに残った人が勝ち',
    solids: [{ x: START_BUTTON.x, z: START_BUTTON.z, r: 0.45 }],
    extent: { minX: -10, maxX: 10, minZ: ARENA.z - ARENA.half, maxZ: 10 },
  },
};

/** 切り替えを決めてから実際に切り替わるまで（全員に予告を出す） */
export const WORLD_COUNTDOWN_MS = 3000;

export const WORLD_KINDS = Object.keys(WORLDS) as WorldKind[];
export const isWorldKind = (v: unknown): v is WorldKind => typeof v === 'string' && v in WORLDS;

/** 半径 r の体が家具にめり込んでいたら外へ押し出した位置 */
export function pushOut(x: number, z: number, r: number, solids: Solid[]) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const s of solids) {
      if ('r' in s) {
        const dx = x - s.x;
        const dz = z - s.z;
        const d = Math.hypot(dx, dz);
        const min = s.r + r;
        if (d >= min) continue;
        const k = d < 1e-4 ? 1 : 1 / d;
        x = s.x + (d < 1e-4 ? min : dx * k * min);
        z = s.z + (d < 1e-4 ? 0 : dz * k * min);
        moved = true;
      } else {
        const hx = s.w / 2;
        const hz = s.d / 2;
        const cx = Math.max(s.x - hx, Math.min(s.x + hx, x));
        const cz = Math.max(s.z - hz, Math.min(s.z + hz, z));
        const dx = x - cx;
        const dz = z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-4) {
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // 中心が箱の中：いちばん近い辺から出す
          const out = [
            [s.x - hx - r - x, 0], [s.x + hx + r - x, 0], [0, s.z - hz - r - z], [0, s.z + hz + r - z],
          ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
          x += out[0];
          z += out[1];
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, z };
}
