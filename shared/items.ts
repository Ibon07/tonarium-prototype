// セッション内に出せるアイテム（ハードコード）。状態の更新はサーバーが権威的に行う。
// 最終的には UGC にする想定なので、種類ごとの振る舞いはこのファイルの関数に閉じ込めておく。

export type ItemKind = 'note' | 'hammer' | 'chess' | 'g2048';

export const NOTE_COLORS = ['#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#d8b4fe'];

interface ItemBase {
  id: string;
  /** 3D空間での床上の位置と向き */
  x: number;
  z: number;
  ry: number;
  createdBy: string;
  updatedBy: string;
}

export type Item =
  /** 付箋。編集中の人がいれば editingBy（簡易ロック、表示のみ） */
  | (ItemBase & { kind: 'note'; text: string; color: string; editingBy: string | null })
  /** ピコピコハンマー。持てるのは1本につき1人 */
  | (ItemBase & { kind: 'hammer'; holder: string | null })
  /** チェス。ルールなし、駒を自由に動かすだけ。board[row*8+col]、row 0 が黒側（8段目） */
  | (ItemBase & { kind: 'chess'; board: (string | null)[]; last: [number, number] | null })
  /** 2048。全員で1つの盤面を操作する */
  | (ItemBase & { kind: 'g2048'; grid: number[]; score: number; over: boolean });

export type Dir = 'up' | 'down' | 'left' | 'right';

export type ItemAction =
  | { a: 'noteEdit'; text?: string; color?: string }
  | { a: 'noteLock'; lock: boolean }
  | { a: 'pick' }
  | { a: 'drop'; x: number; z: number; ry: number }
  | { a: 'chessMove'; from: number; to: number }
  | { a: 'chessReset' }
  | { a: 'slide'; dir: Dir }
  | { a: 'reset2048' };

export const ITEM_INFO: Record<ItemKind, { name: string; icon: string; desc: string }> = {
  note: { name: '付箋', icon: '📝', desc: '文字を書ける付箋（2D/3D）' },
  hammer: { name: 'ピコピコハンマー', icon: '🔨', desc: '拾って誰かを叩けます（2D/3D）' },
  chess: { name: 'チェス', icon: '♟️', desc: '駒を自由に動かせる盤（2D/3D）' },
  g2048: { name: '2048', icon: '🔢', desc: 'みんなで操作する2Dゲーム（3Dは互換表示）' },
};

// ---------- チェス ----------
const BACK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
export function chessInitial(): (string | null)[] {
  const b: (string | null)[] = Array(64).fill(null);
  for (let c = 0; c < 8; c++) {
    b[c] = `b${BACK[c]}`;
    b[8 + c] = 'bP';
    b[48 + c] = 'wP';
    b[56 + c] = `w${BACK[c]}`;
  }
  return b;
}

// ---------- 2048 ----------
function spawnTile(grid: number[], rng: () => number) {
  const empty = grid.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (!empty.length) return;
  grid[empty[Math.floor(rng() * empty.length)]] = rng() < 0.9 ? 2 : 4;
}

export function g2048Initial(rng: () => number) {
  const grid = Array(16).fill(0);
  spawnTile(grid, rng);
  spawnTile(grid, rng);
  return grid;
}

/** 1列を左に寄せて合体させる */
function slideLine(line: number[]): { out: number[]; gained: number } {
  const vals = line.filter((v) => v);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] === vals[i + 1]) {
      out.push(vals[i] * 2);
      gained += vals[i] * 2;
      i++;
    } else out.push(vals[i]);
  }
  while (out.length < 4) out.push(0);
  return { out, gained };
}

function lineIndices(dir: Dir, k: number): number[] {
  // 各方向について「寄せる側から順」のマス番号
  const idx = [0, 1, 2, 3];
  switch (dir) {
    case 'left': return idx.map((i) => k * 4 + i);
    case 'right': return idx.map((i) => k * 4 + 3 - i);
    case 'up': return idx.map((i) => i * 4 + k);
    case 'down': return idx.map((i) => (3 - i) * 4 + k);
  }
}

export function slide2048(grid: number[], dir: Dir): { grid: number[]; gained: number; moved: boolean } {
  const next = [...grid];
  let gained = 0;
  for (let k = 0; k < 4; k++) {
    const ids = lineIndices(dir, k);
    const r = slideLine(ids.map((i) => grid[i]));
    ids.forEach((i, j) => { next[i] = r.out[j]; });
    gained += r.gained;
  }
  return { grid: next, gained, moved: next.some((v, i) => v !== grid[i]) };
}

function canMove(grid: number[]) {
  return (['up', 'down', 'left', 'right'] as Dir[]).some((d) => slide2048(grid, d).moved);
}

// ---------- 共通 ----------
export function createItem(
  kind: ItemKind, base: Omit<ItemBase, 'updatedBy'>, rng: () => number,
): Item {
  const b = { ...base, updatedBy: base.createdBy };
  switch (kind) {
    case 'note': return { ...b, kind, text: '', color: NOTE_COLORS[Math.floor(rng() * NOTE_COLORS.length)], editingBy: null };
    case 'hammer': return { ...b, kind, holder: null };
    case 'chess': return { ...b, kind, board: chessInitial(), last: null };
    case 'g2048': return { ...b, kind, grid: g2048Initial(rng), score: 0, over: false };
  }
}

/** アクションを適用する（item を書き換える）。変化があれば true */
export function applyItemAction(item: Item, act: ItemAction, userId: string, rng: () => number): boolean {
  switch (item.kind) {
    case 'note':
      if (act.a === 'noteEdit') {
        if (act.text !== undefined) item.text = act.text.slice(0, 300);
        if (act.color !== undefined && NOTE_COLORS.includes(act.color)) item.color = act.color;
        break;
      }
      if (act.a === 'noteLock') {
        if (act.lock) item.editingBy = userId;
        else if (item.editingBy === userId) item.editingBy = null;
        else return false;
        break;
      }
      return false;
    case 'hammer':
      if (act.a === 'pick' && item.holder === null) { item.holder = userId; break; }
      if (act.a === 'drop' && item.holder === userId) {
        item.holder = null;
        item.x = act.x; item.z = act.z; item.ry = act.ry;
        break;
      }
      return false;
    case 'chess':
      if (act.a === 'chessMove') {
        const { from, to } = act;
        if (from === to || from < 0 || from > 63 || to < 0 || to > 63 || !item.board[from]) return false;
        item.board[to] = item.board[from];
        item.board[from] = null;
        item.last = [from, to];
        break;
      }
      if (act.a === 'chessReset') { item.board = chessInitial(); item.last = null; break; }
      return false;
    case 'g2048':
      if (act.a === 'slide') {
        if (item.over) return false;
        const r = slide2048(item.grid, act.dir);
        if (!r.moved) return false;
        spawnTile(r.grid, rng);
        item.grid = r.grid;
        item.score += r.gained;
        item.over = !canMove(item.grid);
        break;
      }
      if (act.a === 'reset2048') { item.grid = g2048Initial(rng); item.score = 0; item.over = false; break; }
      return false;
  }
  item.updatedBy = userId;
  return true;
}
