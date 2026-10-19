import type { ClientMsg, ServerMsg } from '../../../shared/protocol.ts';
import { get, set, recompute } from '../store.ts';
import { applyDelta } from '../items/actions.ts';
import { onHit } from '../items/effects.ts';
import { pushNotice } from '../actions.ts';
import { volumeFrom } from '../spatial.ts';
import { playPoke, playSynth } from '../world/sounds.ts';
import { resendViewing } from '../world/windows.ts';

// HMR でこのモジュールが読み直されても同じソケットを使う（新しい側で送信が黙って捨てられるのを防ぐ）
const g = globalThis as unknown as { __tonariumWs?: WebSocket | null };
let retry = 0;

export function connectWs() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const ws = new WebSocket(url);
  g.__tonariumWs = ws;
  ws.onopen = () => {
    retry = 0;
    set({ wsConnected: true });
    const s = get();
    send({ t: 'hello', id: s.selfId, name: s.selfName });
    if (s.session) {
      send({ t: 'join', sid: s.session });
      if (s.mode === '3d') {
        send({ t: 'mode', mode: '3d' });
        send({ t: 'avatar', s: s.selfAvatar });
      }
      resendViewing();
    }
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data) as ServerMsg);
  ws.onclose = () => {
    set({ wsConnected: false });
    setTimeout(connectWs, Math.min(5000, 500 * 2 ** retry++));
  };
}

export function send(msg: ClientMsg) {
  const ws = g.__tonariumWs;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function onMessage(msg: ServerMsg) {
  switch (msg.t) {
    case 'snapshot': {
      const { guild, users, chats, avatars, items, friends } = msg.s;
      set({
        guild,
        users,
        chats,
        friends,
        avatarsBy: avatars,
        itemsBy: Object.fromEntries(Object.entries(items).map(([sid, list]) => [sid, Object.fromEntries(list.map((n) => [n.id, n]))])),
      });
      break;
    }
    case 'users':
      set({ users: msg.list });
      break;
    case 'chat':
      set((s) => ({ chats: { ...s.chats, [msg.sid]: [...(s.chats[msg.sid] ?? []), msg.m].slice(-500) } }));
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
    case 'item':
      set((s) => {
        let item = msg.item;
        // 入力中の付箋は、遅れて返ってくる自分の変更で巻き戻さない
        const cur = s.itemsBy[msg.sid]?.[item.id];
        if (item.kind === 'note' && cur?.kind === 'note' && s.selectedNote === item.id && item.updatedBy === s.selfId)
          item = { ...item, text: cur.text };
        return { itemsBy: { ...s.itemsBy, [msg.sid]: { ...s.itemsBy[msg.sid], [item.id]: item } } };
      });
      break;
    case 'itemRemove':
      set((s) => {
        const m = { ...s.itemsBy[msg.sid] };
        delete m[msg.id];
        return {
          itemsBy: { ...s.itemsBy, [msg.sid]: m },
          selectedNote: s.selectedNote === msg.id ? null : s.selectedNote,
        };
      });
      break;
    case 'itemAction':
      applyDelta(msg.sid, msg.id, msg.action, msg.by);
      return;
    case 'hit':
      if (msg.sid !== get().session) return;
      onHit(msg.from, msg.to);
      if (msg.to === get().selfId) pushNotice('hit', msg.from);
      return;
    case 'poke': {
      if (msg.sid !== get().session) return;
      const from = get().users.find((u) => u.id === msg.from);
      if (from && get().blocked.includes(from.name)) return;
      set((s) => ({ pokes: { ...s.pokes, [msg.to]: performance.now() } }));
      if (msg.to === get().selfId) { pushNotice('poke', msg.from); playPoke(); }
      return;
    }
    case 'sound':
      if (msg.sid !== get().session) return;
      if (!get().blocked.includes(get().users.find((u) => u.id === msg.from)?.name ?? '')) playSynth(msg.id, volumeFrom(msg.from));
      return;
    case 'liveRequest':
      if (msg.sid === get().session) pushNotice('live', msg.from);
      return;
    case 'friendRequest':
      pushNotice('friend', msg.from, msg.fromName);
      return;
    case 'friends':
      set({ friends: msg.names });
      return;
  }
  recompute();
}
