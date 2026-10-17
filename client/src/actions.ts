import type { Mode, Note } from '../../shared/protocol.ts';
import { NOTE_COLORS } from '../../shared/protocol.ts';
import { get, set } from './store.ts';
import { send } from './net/ws.ts';

export function setMode(mode: Mode) {
  if (get().mode === mode) return;
  const { selectedNote } = get();
  if (selectedNote) send({ t: 'noteLock', id: selectedNote, lock: false });
  set({ mode, selectedNote: null });
  send({ t: 'mode', mode });
  if (mode === '3d') send({ t: 'avatar', s: get().selfAvatar });
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
  set((s) => (s.notes[id] ? { notes: { ...s.notes, [id]: { ...s.notes[id], ...patch } } } : {}));
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
