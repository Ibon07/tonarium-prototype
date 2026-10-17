import type { Mode, Note } from '../../shared/protocol.ts';
import { NOTE_COLORS } from '../../shared/protocol.ts';
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
  const { selectedNote } = get();
  if (selectedNote) send({ t: 'noteLock', id: selectedNote, lock: false });
  set({ selectedNote: null });
}

export function createNote(text: string, at?: { x: number; z: number; ry: number }) {
  const pos = at ?? {
    // 2D から追加した付箋は部屋の中央付近に置く（3D側で気付けるように）
    x: (Math.random() - 0.5) * 6,
    z: -5 + (Math.random() - 0.5) * 3,
    ry: 0,
  };
  send({
    t: 'noteCreate',
    note: { text, color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)], ...pos },
  });
}

export function updateNote(id: string, patch: Partial<Pick<Note, 'text' | 'color' | 'x' | 'z' | 'ry'>>) {
  // 楽観的に手元へ反映してから送る
  const sid = get().session;
  if (!sid) return;
  set((s) => {
    const n = s.notesBy[sid]?.[id];
    return n ? { notesBy: { ...s.notesBy, [sid]: { ...s.notesBy[sid], [id]: { ...n, ...patch } } } } : {};
  });
  recompute();
  send({ t: 'noteUpdate', id, patch });
}

export function selectNote(id: string | null) {
  const prev = get().selectedNote;
  if (prev === id) return;
  if (prev) send({ t: 'noteLock', id: prev, lock: false });
  if (id) send({ t: 'noteLock', id, lock: true });
  set({ selectedNote: id });
}

export function deleteNote(id: string) {
  send({ t: 'noteDelete', id });
}
