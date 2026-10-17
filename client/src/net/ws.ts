import type { ClientMsg, ServerMsg } from '../../../shared/protocol.ts';
import { get, set, recompute } from '../store.ts';

let ws: WebSocket | null = null;
let retry = 0;

export function connectWs() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    retry = 0;
    set({ wsConnected: true });
    const s = get();
    send({ t: 'hello', id: s.selfId, name: s.selfName });
    // 再接続時はセッション参加状態を復元する
    if (s.session) {
      send({ t: 'join', sid: s.session });
      if (s.mode === '3d') {
        send({ t: 'mode', mode: '3d' });
        send({ t: 'avatar', s: s.selfAvatar });
      }
    }
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
      const { guild, users, chats, notes, avatars } = msg.s;
      const firstText = guild.categories.flatMap((c) => c.channels).find((c) => c.type === 'text');
      set((s) => ({
        guild,
        users,
        chats,
        notesBy: Object.fromEntries(Object.entries(notes).map(([sid, list]) => [sid, Object.fromEntries(list.map((n) => [n.id, n]))])),
        avatarsBy: avatars,
        textChannel: s.textChannel || firstText?.id || '',
      }));
      break;
    }
    case 'users':
      set({ users: msg.list });
      break;
    case 'chat':
      set((s) => ({ chats: { ...s.chats, [msg.ch]: [...(s.chats[msg.ch] ?? []), msg.m].slice(-500) } }));
      return;
    case 'avatar':
      set((s) => ({ avatarsBy: { ...s.avatarsBy, [msg.sid]: { ...s.avatarsBy[msg.sid], [msg.id]: msg.s } } }));
      break;
    case 'avatarRemove':
      set((s) => {
        const m = { ...s.avatarsBy[msg.sid] };
        delete m[msg.id];
        return { avatarsBy: { ...s.avatarsBy, [msg.sid]: m } };
      });
      break;
    case 'note':
      set((s) => ({ notesBy: { ...s.notesBy, [msg.sid]: { ...s.notesBy[msg.sid], [msg.note.id]: msg.note } } }));
      break;
    case 'noteDelete':
      set((s) => {
        const m = { ...s.notesBy[msg.sid] };
        delete m[msg.id];
        return { notesBy: { ...s.notesBy, [msg.sid]: m }, selectedNote: s.selectedNote === msg.id ? null : s.selectedNote };
      });
      break;
  }
  recompute();
}
