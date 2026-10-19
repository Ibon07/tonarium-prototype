import type { ChatMedia, ChatScope, Mode } from '../../shared/protocol.ts';
import { approach } from '../../shared/places.ts';
import { clampRoomPos } from './items/actions.ts';
import { get, set, recompute, spawnPoint, save, nameOf, type Notice } from './store.ts';
import { send } from './net/ws.ts';
import { connectVoice, leaveVoice } from './net/livekit.ts';
import { placesOf, resumeAudio } from './spatial.ts';

export function joinSession(sid: string) {
  if (get().session === sid) return;
  selectNote(null);
  resumeAudio();
  set({ session: sid, mode: '2d', selfAvatar: spawnPoint(), windows: [], maxWin: null, notices: [] });
  recompute();
  send({ t: 'join', sid });
  void connectVoice(sid);
}

export function leaveSession() {
  if (!get().session) return;
  selectNote(null);
  set({ session: null, mode: '2d', windows: [], maxWin: null });
  recompute();
  send({ t: 'leave' });
  void leaveVoice();
}

export function setMode(mode: Mode) {
  const s = get();
  if (s.mode === mode || !s.session) return;
  selectNote(null);
  // 3D には 2D でいた場所から入る（スポーンエリアにいたならその場所）
  if (mode === '3d') {
    const p = placesOf(s).get(s.selfId);
    if (p) set({ selfAvatar: clampRoomPos({ x: p.x, z: p.z, ry: p.ry }) });
  }
  set({ mode });
  send({ t: 'mode', mode });
  if (mode === '3d') send({ t: 'avatar', s: get().selfAvatar });
}

/** 2D/3D の切り替えに 1〜2 秒（× 倍率）の疑似ローディングを挟む */
export function switchMode(mode: Mode) {
  const s = get();
  if (s.switching || s.mode === mode || !s.session) return;
  const dur = (1000 + Math.random() * 1000) * s.loadScale;
  if (dur < 50) { setMode(mode); return; }
  set({ switching: { to: mode, dur } });
  setTimeout(() => {
    setMode(mode);
    set({ switching: null });
  }, dur);
}

export function setLoadScale(loadScale: number) {
  set({ loadScale });
  save('tonarium.loadScale', loadScale);
}

export function follow(target: string | null) {
  send({ t: 'follow', target });
  set({ liveRequested: null });
}

/** ついていっている相手に視点のライブを頼む。相手が始めたらウィンドウが開く */
export function requestLive(to: string) {
  send({ t: 'liveRequest', to });
  set({ liveRequested: to });
}

export function setViewLive(on: boolean, noticeId?: number) {
  send({ t: 'viewLive', on });
  if (noticeId !== undefined) set((s) => ({ notices: s.notices.filter((n) => n.id !== noticeId) }));
}

export function dropFollowers() {
  send({ t: 'dropFollowers' });
}

export function selectNote(id: string | null) {
  const prev = get().selectedNote;
  if (prev === id) return;
  if (prev) send({ t: 'itemAction', id: prev, action: { a: 'noteLock', lock: false } });
  if (id) send({ t: 'itemAction', id, action: { a: 'noteLock', lock: true } });
  set({ selectedNote: id });
}

/** 人なら `id`、アイテムなら `item:<id>`。持たれているアイテムは持っている人のそばへ */
export function goNear(target: string) {
  const s = get();
  const places = placesOf(s);
  let t: { x: number; z: number } | undefined;
  if (target.startsWith('item:')) {
    const it = s.items[target.slice(5)];
    if (!it) return;
    const holder = 'holder' in it ? it.holder : null;
    t = holder ? places.get(holder) : it;
  } else {
    t = places.get(target);
  }
  if (!t) return;
  const pos = clampRoomPos(approach(places.get(s.selfId), t, 1));
  if (s.mode === '3d') set({ teleport: pos });
  else send({ t: 'place2d', target: s.selfId, pos });
}

export const poke = (to: string) => send({ t: 'poke', to });
export const friendRequest = (to: string) => send({ t: 'friendRequest', to });

export function friendAccept(to: string, noticeId: number) {
  send({ t: 'friendAccept', to });
  set((s) => ({ notices: s.notices.filter((n) => n.id !== noticeId) }));
}

export function toggleBlock(name: string) {
  const blocked = get().blocked.includes(name) ? get().blocked.filter((n) => n !== name) : [...get().blocked, name];
  set({ blocked });
  save('tonarium.blocked', blocked);
}

export async function report(target: string, reason: string) {
  const res = await fetch('/report', { method: 'POST', body: JSON.stringify({ from: get().selfName, target, reason }) });
  return res.ok;
}

export function sendChat(text: string, scope: ChatScope, image?: string, media?: ChatMedia) {
  if (!get().session || (!text.trim() && !image && !media)) return;
  send({ t: 'chat', text, scope, image, media });
}

export const playSound = (id: string) => send({ t: 'sound', id });

export function markNoticesRead() {
  set((s) => ({ notices: s.notices.map((n) => ({ ...n, unread: false })) }));
}

let noticeSeq = 0;
export function pushNotice(kind: Notice['kind'], from: string, fromName = nameOf(from), key?: string) {
  if (get().blocked.includes(fromName)) return;
  set((s) => ({ notices: [{ id: ++noticeSeq, kind, from, fromName, key, at: Date.now(), unread: true }, ...s.notices].slice(0, 30) }));
}
