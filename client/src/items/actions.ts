import { applyItemAction, type ItemAction, type ItemKind } from '../../../shared/items.ts';
import { ROOM_HALF } from '../../../shared/protocol.ts';
import { get, set, recompute, heldHammer, type ItemUi } from '../store.ts';
import { send } from '../net/ws.ts';

const LIMIT = ROOM_HALF - 0.5;
const clamp = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v));

/** 3D なら目の前、2D ならスクリーン前の空いていそうな場所に出す */
export function spawnItem(kind: ItemKind, text?: string) {
  const s = get();
  if (!s.session) return;
  if (s.mode === '3d') {
    const a = s.selfAvatar;
    send({ t: 'itemCreate', kind, text, x: clamp(a.x - Math.sin(a.ry) * 2.2), z: clamp(a.z - Math.cos(a.ry) * 2.2), ry: a.ry });
  } else {
    send({ t: 'itemCreate', kind, text, x: (Math.random() - 0.5) * 10, z: -3 + (Math.random() - 0.5) * 4, ry: 0 });
  }
}

/** 付箋の文字・色を変える（入力が途切れないよう手元にすぐ反映する） */
export function editNote(id: string, patch: { text?: string; color?: string }) {
  const sid = get().session;
  if (!sid) return;
  set((s) => {
    const it = s.itemsBy[sid]?.[id];
    return it?.kind === 'note' ? { itemsBy: { ...s.itemsBy, [sid]: { ...s.itemsBy[sid], [id]: { ...it, ...patch } } } } : {};
  });
  recompute();
  send({ t: 'itemAction', id, action: { a: 'noteEdit', ...patch } });
}

export function removeItem(id: string) {
  send({ t: 'itemRemove', id });
}

export function itemAction(id: string, action: ItemAction) {
  send({ t: 'itemAction', id, action });
}

export function moveItem(id: string, x: number, z: number, ry: number) {
  const sid = get().session;
  if (!sid) return;
  set((s) => {
    const it = s.itemsBy[sid]?.[id];
    return it ? { itemsBy: { ...s.itemsBy, [sid]: { ...s.itemsBy[sid], [id]: { ...it, x, z, ry } } } } : {};
  });
  recompute();
  send({ t: 'itemMove', id, x, z, ry });
}

export function setItemUi(id: string, ui: ItemUi) {
  set((s) => ({ itemUi: { ...s.itemUi, [id]: ui } }));
}

/** 操作だけを手元のアイテムに適用する（描画など。サーバーから届いたもの・自分の操作の両方） */
export function applyDelta(sid: string, id: string, action: ItemAction, by: string) {
  const cur = get().itemsBy[sid]?.[id];
  if (!cur) return;
  const next = cur.kind === 'canvas' ? { ...cur, strokes: [...cur.strokes] } : { ...cur };
  if (!applyItemAction(next, action, by, Math.random)) return;
  set((s) => ({ itemsBy: { ...s.itemsBy, [sid]: { ...s.itemsBy[sid], [id]: next } } }));
  if (sid === get().session) recompute();
}

/** 自分の描画操作: 手元にすぐ反映してから送る */
export function deltaAction(id: string, action: ItemAction) {
  const s = get();
  if (!s.session) return;
  applyDelta(s.session, id, action, s.selfId);
  send({ t: 'itemAction', id, action });
}

/** 持っているハンマーを手放す。3D では目の前の床、2D では元の場所に置く */
export function dropHammer() {
  const s = get();
  const h = heldHammer(s);
  if (!h) return;
  if (s.mode === '3d') {
    const a = s.selfAvatar;
    itemAction(h.id, { a: 'drop', x: clamp(a.x - Math.sin(a.ry) * 1.2), z: clamp(a.z - Math.cos(a.ry) * 1.2), ry: a.ry });
  } else {
    itemAction(h.id, { a: 'drop', x: h.x, z: h.z, ry: h.ry });
  }
}

export function hit(to: string) {
  if (to === get().selfId || !heldHammer(get())) return;
  send({ t: 'hit', to });
}
