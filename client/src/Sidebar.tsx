// 参加者一覧とチャット。2D/3D どちらの表示でも同じものを出す。
import { useEffect, useRef, useState } from 'react';
import { useStore, colorOf } from './store.ts';
import { send } from './net/ws.ts';

export function ParticipantList() {
  const { participants, speaking, micOn, sharer, selfId, voice } = useStore();
  return (
    <ul className="plist">
      {participants.map((p) => (
        <li key={p.id} className={speaking[p.id] ? 'speaking' : ''}>
          <span className="dot" style={{ background: colorOf(p.id) }} />
          <span className="pname">{p.name}{p.id === selfId && '（自分）'}</span>
          <span className={`badge m${p.mode}`}>{p.mode.toUpperCase()}</span>
          {voice === 'connected' && <span title="マイク">{micOn[p.id] ? '🎙' : '🔇'}</span>}
          {sharer === p.id && <span className="badge live">配信中</span>}
        </li>
      ))}
    </ul>
  );
}

export function Chat() {
  const chat = useStore((s) => s.chat);
  const selfId = useStore((s) => s.selfId);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);
  const submit = () => {
    if (!text.trim()) return;
    send({ t: 'chat', text });
    setText('');
  };
  return (
    <div className="chat">
      <div className="messages" ref={listRef}>
        {chat.map((m) =>
          m.from === null ? (
            <div key={m.id} className="sys">{m.text}</div>
          ) : (
            <div key={m.id} className={`msg ${m.from === selfId ? 'mine' : ''}`}>
              <b style={{ color: colorOf(m.from) }}>{m.fromName}</b>
              <span className="time">{new Date(m.at).toLocaleTimeString().slice(0, 5)}</span>
              <div>{m.text}</div>
            </div>
          ),
        )}
      </div>
      <input
        placeholder="メッセージ（Enterで送信）" value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
      />
    </div>
  );
}

export function Sidebar() {
  const count = useStore((s) => s.participants.length);
  return (
    <aside>
      <h3>参加者 {count}</h3>
      <ParticipantList />
      <h3>チャット</h3>
      <Chat />
    </aside>
  );
}
