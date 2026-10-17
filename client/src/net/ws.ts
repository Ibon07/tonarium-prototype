import type { ClientMsg, ServerMsg } from '../../../shared/protocol.ts';
import { get, set, recompute } from '../store.ts';
import { applyDelta } from '../items/actions.ts';
import { onHit } from '../items/effects.ts';

// 開発中のホットリロードでこのモジュールが読み直されても、接続中のソケットを使い続ける
// （読み直した側でソケットが null になり、送信だけが黙って捨てられるのを防ぐ）
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
  const ws = g.__tonariumWs;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function onMessage(msg: ServerMsg) {
  switch (msg.t) {
    case 'snapshot': {
      const { guild, users, chats, avatars, items } = msg.s;
      const firstText = guild.categories.flatMap((c) => c.channels).find((c) => c.type === 'text');
      set((s) => ({
        guild,
        users,
        chats,
        avatarsBy: avatars,
        itemsBy: Object.fromEntries(Object.entries(items).map(([sid, list]) => [sid, Object.fromEntries(list.map((n) => [n.id, n]))])),
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
    case 'item':
      set((s) => {
        let item = msg.item;
        // 自分が入力中の付箋は、遅れて返ってくる自分の変更で文字を巻き戻さない
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
          focus: s.focus === msg.id ? null : s.focus,
          selectedNote: s.selectedNote === msg.id ? null : s.selectedNote,
        };
      });
      break;
    case 'itemAction':
      applyDelta(msg.sid, msg.id, msg.action, msg.by);
      return;
    case 'hit':
      if (msg.sid === get().session) onHit(msg.from, msg.to);
      return;
  }
  recompute();
}
