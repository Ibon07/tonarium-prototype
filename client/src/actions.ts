import type { Mode } from '../../shared/protocol.ts';
import { get, set, recompute, spawnPoint, type View } from './store.ts';
import { send } from './net/ws.ts';
import { connectVoice, leaveVoice } from './net/livekit.ts';
import { resumeAudio } from './spatial.ts';

export function joinSession(sid: string) {
  if (get().session === sid) { openView('session'); return; }
  releaseNote();
  resumeAudio();
  set({ session: sid, mode: '2d', view: 'session', selfAvatar: spawnPoint() });
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

export function follow(target: string | null) {
  send({ t: 'follow', target });
  if (target) set({ focus: `view:${target}`, view: 'session' });
  else if (get().focus?.startsWith('view:')) set({ focus: null });
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
