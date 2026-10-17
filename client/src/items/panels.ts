// 2D 用のアイテム画面。Canvas に描き、クリックは座標で判定する。
// 同じ描画・クリック処理を 3D の互換モード（空間内のパネル）でも使うので、DOM に依存させない。
import { CANVAS_H, CANVAS_W, type Dir, type Item } from '../../../shared/items.ts';
import type { ItemUi } from '../store.ts';
import { deltaAction, itemAction, postImage, setItemUi } from './actions.ts';

type Ui = ItemUi;
type Rect = [number, number, number, number];

export interface Panel {
  w: number;
  h: number;
  draw(ctx: CanvasRenderingContext2D, item: Item, ui: Ui): void;
  click(x: number, y: number, item: Item, ui: Ui): void;
  /** キー操作（2D で拡大表示中のみ）。処理したら true */
  key?(key: string, item: Item): boolean;
  /** 押したまま動かす操作（描画など）。あれば click の代わりに使う */
  drag?(phase: 'start' | 'move' | 'end', x: number, y: number, item: Item, ui: Ui): void;
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

// ---------- キャンバス ----------
const PEN_COLORS = ['#111111', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
const AREA: Rect = [10, 58, CANVAS_W, CANVAS_H];
const SIZE_BTNS: [number, string, Rect][] = [[3, '細', [272, 12, 44, 34]], [10, '太', [320, 12, 44, 34]]];
const ERASER: Rect = [370, 12, 92, 34];
const SAVE: Rect = [468, 12, 70, 34];
const CLEAR: Rect = [544, 12, 84, 34];
const colorRect = (i: number): Rect => [16 + i * 40, 13, 32, 32];

/** 描いている途中の線（送信は間引いてまとめる） */
let active: null | { itemId: string; strokeId: string; buf: number[]; lastX: number; lastY: number; lastSend: number } = null;

function flush() {
  if (!active || !active.buf.length) return;
  deltaAction(active.itemId, { a: 'strokeAdd', id: active.strokeId, pts: active.buf });
  active.buf = [];
  active.lastSend = performance.now();
}

export const canvasPanel: Panel = {
  w: 640,
  h: 520,
  draw(ctx, item, ui) {
    if (item.kind !== 'canvas') return;
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, this.w, this.h);
    const erase = !!ui.erase;
    const color = ui.color ?? PEN_COLORS[0];
    const size = ui.size ?? 3;
    PEN_COLORS.forEach((c, i) => {
      const [x, y, w] = colorRect(i);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + w / 2, 13, 0, Math.PI * 2);
      ctx.fill();
      if (!erase && c === color) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + w / 2, y + w / 2, 16, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    for (const [v, label, r] of SIZE_BTNS) button(ctx, r, label, size === v ? '#5865f2' : '#4e5058');
    button(ctx, ERASER, '🧽 消しゴム', erase ? '#5865f2' : '#4e5058', 15);
    button(ctx, SAVE, '💾 保存', '#248046', 15);
    button(ctx, CLEAR, '全部消す', '#da373c', 15);
    drawStrokes(ctx, item, AREA[0], AREA[1]);
  },
  click(x, y, item, ui) {
    this.drag!('start', x, y, item, ui);
    this.drag!('end', x, y, item, ui);
  },
  drag(phase, x, y, item, ui) {
    if (item.kind !== 'canvas') return;
    const [ax, ay] = AREA;
    const px = x - ax;
    const py = y - ay;
    if (phase === 'start') {
      // ツールバー
      for (let i = 0; i < PEN_COLORS.length; i++)
        if (inRect(x, y, colorRect(i))) { setItemUi(item.id, { ...ui, color: PEN_COLORS[i], erase: false }); return; }
      for (const [v, , r] of SIZE_BTNS) if (inRect(x, y, r)) { setItemUi(item.id, { ...ui, size: v }); return; }
      if (inRect(x, y, ERASER)) { setItemUi(item.id, { ...ui, erase: !ui.erase }); return; }
      if (inRect(x, y, SAVE)) { saveCanvas(item); return; }
      if (inRect(x, y, CLEAR)) { deltaAction(item.id, { a: 'canvasClear' }); return; }
      if (!inRect(x, y, AREA)) return;
      const strokeId = Math.random().toString(36).slice(2, 10);
      const erase = !!ui.erase;
      deltaAction(item.id, {
        a: 'strokeStart', id: strokeId,
        color: erase ? 'erase' : ui.color ?? PEN_COLORS[0],
        size: erase ? 28 : ui.size ?? 3,
        x: px, y: py,
      });
      active = { itemId: item.id, strokeId, buf: [], lastX: px, lastY: py, lastSend: performance.now() };
      return;
    }
    if (!active || active.itemId !== item.id) return;
    if (phase === 'move') {
      if (Math.hypot(px - active.lastX, py - active.lastY) < 2) return;
      active.buf.push(Math.round(px), Math.round(py));
      active.lastX = px;
      active.lastY = py;
      if (performance.now() - active.lastSend > 50) flush();
      return;
    }
    flush();
    active = null;
  },
};

/** 描画領域（白地と線）を (ox, oy) を左上に描く */
function drawStrokes(ctx: CanvasRenderingContext2D, item: Item, ox: number, oy: number) {
  if (item.kind !== 'canvas') return;
  const ax = ox;
  const ay = oy;
  const aw = CANVAS_W;
  const ah = CANVAS_H;
  {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ax, ay, aw, ah);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ax, ay, aw, ah);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const st of item.strokes) {
      ctx.strokeStyle = st.color === 'erase' ? '#ffffff' : st.color;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = st.size;
      const p = st.pts;
      if (p.length <= 2) {
        ctx.beginPath();
        ctx.arc(ax + p[0], ay + p[1], st.size / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(ax + p[0], ay + p[1]);
      for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(ax + p[i], ay + p[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** キャンバスの絵を画像にしてセッションのチャットに投稿する */
function saveCanvas(item: Item) {
  const cv = document.createElement('canvas');
  cv.width = CANVAS_W * 2;
  cv.height = CANVAS_H * 2;
  const ctx = cv.getContext('2d')!;
  ctx.scale(2, 2);
  drawStrokes(ctx, item, 0, 0);
  postImage('🎨 キャンバスを保存しました', cv.toDataURL('image/jpeg', 0.85));
}

/** 2D 画面を持つアイテム（通話画面にアクティビティとして並ぶ） */
export const PANELS: Partial<Record<Item['kind'], Panel>> = { chess: chessPanel, g2048: panel2048, canvas: canvasPanel };
/** 2D 専用で、3D では互換モード（2D 画面をそのまま置く）で表示するもの */
export const COMPAT_ONLY: Partial<Record<Item['kind'], boolean>> = { g2048: true };
