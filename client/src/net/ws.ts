import type { ClientMsg, ServerMsg } from '../../../shared/protocol.ts';
import { get, set } from '../store.ts';

let ws: WebSocket | null = null;
let retry = 0;

export function connectWs() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    retry = 0;
    set({ wsConnected: true });
    const s = get();
    send({ t: 'hello', id: s.selfId, name: s.selfName, mode: s.mode });
    if (s.mode === '3d') send({ t: 'avatar', s: s.selfAvatar });
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data) as ServerMsg);
  ws.onclose = () => {
    set({ wsConnected: false });
    setTimeout(connectWs, Math.min(5000, 500 * 2 ** retry++));
  };
}

export function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function onMessage(msg: ServerMsg) {
  switch (msg.t) {
    case 'snapshot': {
      const avatars = { ...msg.s.avatars };
      delete avatars[get().selfId];
      set({
        participants: msg.s.participants,
        chat: msg.s.chat,
        notes: Object.fromEntries(msg.s.notes.map((n) => [n.id, n])),
        avatars,
      });
      return;
    }
    case 'participants':
      set({ participants: msg.list });
      return;
    case 'chat':
      set((s) => ({ chat: [...s.chat, msg.m].slice(-500) }));
      return;
    case 'avatar':
      if (msg.id === get().selfId) return;
      set((s) => ({ avatars: { ...s.avatars, [msg.id]: msg.s } }));
      return;
    case 'avatarRemove':
      set((s) => {
        const avatars = { ...s.avatars };
        delete avatars[msg.id];
        return { avatars };
      });
      return;
    case 'note':
      set((s) => ({ notes: { ...s.notes, [msg.note.id]: msg.note } }));
      return;
    case 'noteDelete':
      set((s) => {
        const notes = { ...s.notes };
        delete notes[msg.id];
        return { notes, selectedNote: s.selectedNote === msg.id ? null : s.selectedNote };
      });
      return;
  }
}
