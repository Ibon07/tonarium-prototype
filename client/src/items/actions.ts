import type { ItemAction, ItemKind } from '../../../shared/items.ts';
import { ROOM_HALF } from '../../../shared/protocol.ts';
import { get, set, recompute, heldHammer } from '../store.ts';
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

export function setItemUi(id: string, ui: { sel?: number }) {
  set((s) => ({ itemUi: { ...s.itemUi, [id]: ui } }));
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
