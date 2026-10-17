import type { Mode } from '../../shared/protocol.ts';
import { get, set, recompute, DEFAULT_AVATAR, type View } from './store.ts';
import { send } from './net/ws.ts';
import { connectVoice, leaveVoice } from './net/livekit.ts';

/** セッションに入る（入っていればその画面を開くだけ）。別セッションからは移動する */
export function joinSession(sid: string) {
  if (get().session === sid) { openView('session'); return; }
  releaseNote();
  set({ session: sid, mode: '2d', view: 'session', selfAvatar: DEFAULT_AVATAR });
  recompute();
  send({ t: 'join', sid });
  void connectVoice(sid);
}

export function leaveSession() {
  if (!get().session) return;
  releaseNote();
  set({ session: null, mode: '2d', view: 'text' });
  recompute();
  send({ t: 'leave' });
  void leaveVoice();
}

export function openText(id: string) {
  set({ textChannel: id, view: 'text' });
  setMode('2d');
}

/** 参加中セッションの画面（通話 / 付箋ボード）を開く */
export function openView(view: Exclude<View, 'text'>) {
  if (!get().session) return;
  set({ view });
  setMode('2d');
}

export function setMode(mode: Mode) {
  const s = get();
  if (s.mode === mode || !s.session) return;
  releaseNote();
  set({ mode, view: s.view === 'text' ? 'session' : s.view });
  send({ t: 'mode', mode });
  if (mode === '3d') send({ t: 'avatar', s: get().selfAvatar });
}

function releaseNote() {
  selectNote(null);
}

/** 付箋の編集を始める／やめる（他の人には「編集中」と表示される） */
export function selectNote(id: string | null) {
  const prev = get().selectedNote;
  if (prev === id) return;
  if (prev) send({ t: 'itemAction', id: prev, action: { a: 'noteLock', lock: false } });
  if (id) send({ t: 'itemAction', id, action: { a: 'noteLock', lock: true } });
  set({ selectedNote: id });
}
