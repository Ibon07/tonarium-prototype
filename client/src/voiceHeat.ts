/** 声の湯気：発話があった場所に熱が溜まり、時間で冷めていく。会話の内容は持たず、場所と量だけ */
export const HEAT_CELL_M = 3;
/** この秒数で熱が半分になる */
export const HEAT_HALF_LIFE_SEC = 150;
/** これを下回ったセルは消す */
export const HEAT_MIN = 0.02;
/** 1 秒発話し続けると溜まる熱。数秒の会話で目に見えるくらいにする */
export const HEAT_PER_SEC = 0.25;

export interface HeatCell { cx: number; cz: number; heat: number }

const keyOf = (cx: number, cz: number) => `${cx},${cz}`;

export const cellOf = (x: number, z: number) => ({ cx: Math.floor(x / HEAT_CELL_M), cz: Math.floor(z / HEAT_CELL_M) });

export const cellCenter = (cx: number, cz: number) => ({ x: (cx + 0.5) * HEAT_CELL_M, z: (cz + 0.5) * HEAT_CELL_M });

/** 発話中の人の位置に、経過秒ぶんの熱を足す */
export function addHeat(cells: Map<string, number>, x: number, z: number, dtSec: number) {
  if (dtSec <= 0) return;
  const { cx, cz } = cellOf(x, z);
  const k = keyOf(cx, cz);
  cells.set(k, Math.min(1, (cells.get(k) ?? 0) + dtSec * HEAT_PER_SEC));
}

/** 全セルの熱を経過秒ぶん冷ます */
export function decayHeat(cells: Map<string, number>, dtSec: number) {
  if (dtSec <= 0) return;
  const f = 0.5 ** (dtSec / HEAT_HALF_LIFE_SEC);
  for (const [k, v] of cells) {
    const next = v * f;
    if (next < HEAT_MIN) cells.delete(k);
    else cells.set(k, next);
  }
}

export function heatCells(cells: Map<string, number>): HeatCell[] {
  return [...cells.entries()].map(([k, heat]) => {
    const [cx, cz] = k.split(',').map(Number);
    return { cx, cz, heat };
  });
}
