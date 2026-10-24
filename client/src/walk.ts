import { ROOM_HALF } from '../../shared/protocol.ts';
import { pushOut } from '../../shared/worlds.ts';
import { get, set, solidsOf } from './store.ts';
import { send } from './net/ws.ts';

/** 3D の歩く速さと同じ（m/s） */
const SPEED = 4;
/** サーバーの PERSON と同じ。家具に当たったらこの太さで縁を滑る */
const PERSON_R = 0.35;
const TICK_MS = 33;
/** 歩いている間の位置はこの間隔でまとめて送る（毎フレーム送るとほかの人への presence が多すぎる） */
const SEND_MS = 200;
/** 止まった後、サーバーから自分の位置が届くまで手元の位置を見せておく長さ */
const HOLD_MS = 1500;

export interface Walk {
  /** 目的地。着いた・止まった後は null */
  to: { x: number; z: number } | null;
  at: { x: number; z: number; ry: number };
  /** to が null のとき、手元の位置を見せておく期限 */
  until: number;
}

const clamp = (v: number) => Math.max(-ROOM_HALF + 0.5, Math.min(ROOM_HALF - 0.5, v));

let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let lastSent = { at: 0, x: 0, z: 0 };
/** 目的地にいちばん近づいた距離と、その時刻。しばらく近づけなければ止まる */
let best = { d: Infinity, at: 0 };
/** まっすぐ進めないときに試す、進む向きからのずらし角（ラジアン） */
const DETOURS = [0, 0.5, -0.5, 1, -1, 1.4, -1.4, 1.9, -1.9];
/** よけ始めたら少しの間その向きを先に試す（毎フレームまっすぐに戻ると家具の前で行ったり来たりする） */
let detour = { a: 0, until: 0 };
const KEEP_DETOUR_MS = 300;
const GIVE_UP_MS = 1000;

function sendPos(at: Walk['at']) {
  const s = get();
  send({ t: 'place2d', target: s.selfId, pos: at });
  lastSent = { at: performance.now(), x: at.x, z: at.z };
}

function finish(at: Walk['at'], sendIt: boolean) {
  if (sendIt) sendPos(at);
  set({ walk: { to: null, at, until: performance.now() + HOLD_MS } });
}

function clear() {
  if (timer) clearInterval(timer);
  timer = null;
  set({ walk: null });
}

function tick() {
  const s = get();
  const w = s.walk;
  if (!w || s.mode !== '2d' || !s.session) { clear(); return; }
  const now = performance.now();
  const server = s.participants.find((p) => p.id === s.selfId)?.pos;
  if (!w.to) {
    // サーバーの位置が追いついたら、手元の位置はもう要らない
    if (now > w.until || (server && Math.hypot(server.x - w.at.x, server.z - w.at.z) < 0.05)) clear();
    return;
  }
  // 3D の人に運ばれるなど、自分で送っていない位置に変わったらそちらに従う
  if (server && now - lastSent.at > 600 && Math.hypot(server.x - lastSent.x, server.z - lastSent.z) > 1) { clear(); return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const dx = w.to.x - w.at.x;
  const dz = w.to.z - w.at.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) { finish(w.at, true); return; }
  const step = Math.min(d, SPEED * dt);
  const solids = solidsOf(s);
  // 丸いテーブルに正面から当たると押し戻されるだけなので、進めるまで向きを少しずつずらす
  let p = { x: w.at.x, z: w.at.z };
  let moved = 0;
  const tries = now < detour.until ? [detour.a, ...DETOURS] : DETOURS;
  for (const a of tries) {
    const ang = Math.atan2(dz, dx) + a;
    const q = pushOut(clamp(w.at.x + Math.cos(ang) * step), clamp(w.at.z + Math.sin(ang) * step), PERSON_R, solids);
    const m = Math.hypot(q.x - w.at.x, q.z - w.at.z);
    if (m < step * 0.5) continue;
    p = q;
    moved = m;
    if (a !== 0) detour = { a, until: Math.max(detour.until, now) + (now < detour.until ? 0 : KEEP_DETOUR_MS) };
    break;
  }
  const at = { x: p.x, z: p.z, ry: moved > 1e-3 ? Math.atan2(-(p.x - w.at.x), -(p.z - w.at.z)) : w.at.ry };
  // よけても近づけないまま時間がたったら、その場で止まる
  const left = Math.hypot(w.to.x - at.x, w.to.z - at.z);
  if (left < best.d - 0.1) best = { d: left, at: now };
  if (now - best.at > GIVE_UP_MS) { finish(at, true); return; }
  set({ walk: { ...w, at } });
  if (now - lastSent.at >= SEND_MS) sendPos(at);
}

/** 2D の自分を目的地まで歩かせる。歩いている間の位置は placesOf が手元の値を使う */
export function walkTo(x: number, z: number, from: { x: number; z: number; ry: number }) {
  set({ walk: { to: { x: clamp(x), z: clamp(z) }, at: get().walk?.at ?? from, until: 0 } });
  last = performance.now();
  best = { d: Infinity, at: last };
  detour = { a: 0, until: 0 };
  // 運ばれたかどうかは「最後に送った位置」と比べるので、歩き始めた位置を基準にしておく
  if (!timer) lastSent = { at: last, x: from.x, z: from.z };
  if (!timer) timer = setInterval(tick, TICK_MS);
}

/** ほかの方法（そばにいく・ついていく・スポーンに戻る など）で動くときは歩くのをやめる */
export function stopWalk() {
  if (get().walk) clear();
}
