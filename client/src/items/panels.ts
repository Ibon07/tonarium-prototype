// 2D 用のアイテム画面。Canvas に描き、クリックは座標で判定する。
// 同じ描画・クリック処理を 3D の互換モード（空間内のパネル）でも使うので、DOM に依存させない。
import type { Dir, Item } from '../../../shared/items.ts';
import { itemAction, setItemUi } from './actions.ts';

type Ui = { sel?: number };
type Rect = [number, number, number, number];

export interface Panel {
  w: number;
  h: number;
  draw(ctx: CanvasRenderingContext2D, item: Item, ui: Ui): void;
  click(x: number, y: number, item: Item, ui: Ui): void;
  /** キー操作（2D で拡大表示中のみ）。処理したら true */
  key?(key: string, item: Item): boolean;
}

const FONT = '"Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
const inRect = (x: number, y: number, [rx, ry, rw, rh]: Rect) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

function button(ctx: CanvasRenderingContext2D, [x, y, w, h]: Rect, label: string, bg = '#4e5058', size = 18) {
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
}

// ---------- チェス ----------
const GLYPH: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const SQ = 56;
const BX = 16;
const BY = 56;
const CHESS_RESET: Rect = [480 - 16 - 96, 10, 96, 34];

export const chessPanel: Panel = {
  w: 480,
  h: 520,
  draw(ctx, item, ui) {
    if (item.kind !== 'chess') return;
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#f2f3f5';
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('♟ チェス', 16, 28);
    button(ctx, CHESS_RESET, 'リセット');
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8);
      const c = i % 8;
      const x = BX + c * SQ;
      const y = BY + r * SQ;
      ctx.fillStyle = (r + c) % 2 ? '#b58863' : '#f0d9b5';
      if (item.last && (item.last[0] === i || item.last[1] === i)) ctx.fillStyle = (r + c) % 2 ? '#aaa23a' : '#cdd26a';
      if (ui.sel === i) ctx.fillStyle = '#5865f2';
      ctx.fillRect(x, y, SQ, SQ);
      const p = item.board[i];
      if (!p) continue;
      ctx.font = `${SQ * 0.82}px "Segoe UI Symbol", ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2;
      ctx.strokeStyle = p[0] === 'w' ? '#222' : '#ddd';
      ctx.fillStyle = p[0] === 'w' ? '#fff' : '#111';
      ctx.strokeText(GLYPH[p[1]], x + SQ / 2, y + SQ / 2 + 3);
      ctx.fillText(GLYPH[p[1]], x + SQ / 2, y + SQ / 2 + 3);
    }
  },
  click(x, y, item, ui) {
    if (item.kind !== 'chess') return;
    if (inRect(x, y, CHESS_RESET)) { itemAction(item.id, { a: 'chessReset' }); setItemUi(item.id, {}); return; }
    const c = Math.floor((x - BX) / SQ);
    const r = Math.floor((y - BY) / SQ);
    if (c < 0 || c > 7 || r < 0 || r > 7) return;
    chessSelect(item, ui, r * 8 + c);
  },
};

/** 1回目のクリックで駒を選び、2回目で移動（ルールなし）。3D の盤でも同じ処理を使う */
export function chessSelect(item: Item, ui: Ui, i: number) {
  if (item.kind !== 'chess') return;
  const sel = ui.sel;
  if (sel === undefined) {
    if (item.board[i]) setItemUi(item.id, { sel: i });
    return;
  }
  if (sel === i) { setItemUi(item.id, {}); return; }
  const a = item.board[sel];
  const b = item.board[i];
  if (a && b && a[0] === b[0]) { setItemUi(item.id, { sel: i }); return; }
  itemAction(item.id, { a: 'chessMove', from: sel, to: i });
  setItemUi(item.id, {});
}

// ---------- 2048 ----------
const TILE_BG: Record<number, string> = {
  0: '#3a3c42', 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b',
  128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e',
};
const G_RESET: Rect = [440 - 20 - 96, 18, 96, 36];
const GX = 20;
const GY = 80;
const CELL = 92;
const GAP = 8;
const BOARD = 4 * CELL + 5 * GAP;
const ARROWS: [Dir, string, Rect][] = [
  ['left', '←', [20, 500, 92, 72]],
  ['up', '↑', [122, 500, 92, 72]],
  ['down', '↓', [224, 500, 92, 72]],
  ['right', '→', [326, 500, 92, 72]],
];

export const panel2048: Panel = {
  w: 440,
  h: 590,
  draw(ctx, item) {
    if (item.kind !== 'g2048') return;
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#f2f3f5';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `800 30px ${FONT}`;
    ctx.fillText('2048', 20, 36);
    ctx.font = `600 18px ${FONT}`;
    ctx.fillStyle = '#b5bac1';
    ctx.fillText(`スコア ${item.score}`, 110, 38);
    button(ctx, G_RESET, 'リセット');
    ctx.fillStyle = '#1e1f22';
    ctx.beginPath();
    ctx.roundRect(GX - GAP, GY - GAP, BOARD, BOARD, 8);
    ctx.fill();
    for (let i = 0; i < 16; i++) {
      const v = item.grid[i];
      const x = GX + (i % 4) * (CELL + GAP);
      const y = GY + Math.floor(i / 4) * (CELL + GAP);
      ctx.fillStyle = TILE_BG[v] ?? '#3c3a32';
      ctx.beginPath();
      ctx.roundRect(x, y, CELL, CELL, 6);
      ctx.fill();
      if (!v) continue;
      ctx.fillStyle = v <= 4 ? '#776e65' : '#f9f6f2';
      ctx.font = `800 ${v < 100 ? 40 : v < 1000 ? 34 : 28}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 2);
    }
    for (const [, label, r] of ARROWS) button(ctx, r, label, '#5865f2', 34);
    if (item.over) {
      ctx.fillStyle = '#000a';
      ctx.fillRect(GX - GAP, GY - GAP, BOARD, BOARD);
      ctx.fillStyle = '#fff';
      ctx.font = `800 36px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('ゲームオーバー', GX - GAP + BOARD / 2, GY - GAP + BOARD / 2);
    }
  },
  click(x, y, item) {
    if (item.kind !== 'g2048') return;
    if (inRect(x, y, G_RESET)) { itemAction(item.id, { a: 'reset2048' }); return; }
    for (const [dir, , r] of ARROWS) if (inRect(x, y, r)) itemAction(item.id, { a: 'slide', dir });
  },
  key(key, item) {
    const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as Record<string, Dir>)[key];
    if (!dir) return false;
    itemAction(item.id, { a: 'slide', dir });
    return true;
  },
};

/** 2D 画面を持つアイテム（通話画面にアクティビティとして並ぶ） */
export const PANELS: Partial<Record<Item['kind'], Panel>> = { chess: chessPanel, g2048: panel2048 };
