// Discord 風レイアウトの共通部品（チャンネル一覧・メンバー一覧・チャット・ユーザーパネル）
import { useEffect, useRef, useState } from 'react';
import type { Participant } from '../../shared/protocol.ts';
import { useStore, set, colorOf, type View2D } from './store.ts';
import { send } from './net/ws.ts';
import { toggleMic, toggleShare } from './net/livekit.ts';
import { setMode } from './actions.ts';

export function Avatar({ id, name, size = 32, speaking = false }: { id: string; name: string; size?: number; speaking?: boolean }) {
  return (
    <div
      className={`av ${speaking ? 'speaking' : ''}`}
      style={{ width: size, height: size, background: colorOf(id), fontSize: size * 0.42 }}
    >
      {name.slice(0, 1)}
    </div>
  );
}

export function openView(view: View2D) {
  set({ view2d: view });
  setMode('2d');
}

// ---------- 左: チャンネル一覧 ----------
function Channel({ icon, name, active, onClick, children }: {
  icon: string; name: string; active: boolean; onClick: () => void; children?: React.ReactNode;
}) {
  return (
    <div className={`ch ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="chicon">{icon}</span>
      <span className="chname">{name}</span>
      {children}
    </div>
  );
}

function VoiceMember({ p }: { p: Participant }) {
  const speaking = useStore((s) => !!s.speaking[p.id]);
  const micOff = useStore((s) => s.voice === 'connected' && s.micOn[p.id] === false);
  const live = useStore((s) => s.sharer === p.id);
  return (
    <div className="vmember">
      <Avatar id={p.id} name={p.name} size={24} speaking={speaking} />
      <span className="vname">{p.name}</span>
      {micOff && <span className="ico" title="ミュート">🔇</span>}
      {live && <span className="livebadge">LIVE</span>}
      {p.mode === '3d' && <span className="modebadge">3D</span>}
    </div>
  );
}

function VoicePanel() {
  const { voice, voiceError, sharer, selfId, mode } = useStore();
  const sharingSelf = sharer === selfId;
  const ok = voice === 'connected';
  return (
    <div className="voicepanel">
      <div className="vstate">
        <div className={ok ? 'conn ok' : 'conn ng'}>
          {{ off: '通話未接続', connecting: '接続中…', connected: '通話中', unavailable: '通話を利用できません' }[voice]}
        </div>
        <div className="sub" title={voiceError ?? ''}>{voiceError ?? `セッション / Tonarium（${mode.toUpperCase()}）`}</div>
      </div>
      <div className="vbtns">
        <button
          title={sharingSelf ? '配信を停止' : '画面を配信'}
          className={sharingSelf ? 'on' : ''}
          disabled={!ok || (!!sharer && !sharingSelf)} onClick={toggleShare}
        >🖥</button>
        <button
          title={mode === '3d' ? '2Dに戻る' : '3D空間に入る'} className={mode === '3d' ? 'on' : ''}
          onClick={() => setMode(mode === '3d' ? '2d' : '3d')}
        >🧊</button>
      </div>
    </div>
  );
}

function UserPanel() {
  const { selfId, selfName, micEnabled, voice, mode } = useStore();
  const speaking = useStore((s) => !!s.speaking[s.selfId]);
  return (
    <div className="userpanel">
      <Avatar id={selfId} name={selfName} size={32} speaking={speaking} />
      <div className="uinfo">
        <div className="uname">{selfName}</div>
        <div className="sub">{mode === '3d' ? '3D空間にいます' : '2Dで参加中'}</div>
      </div>
      <button
        className={`iconbtn ${micEnabled ? '' : 'off'}`} disabled={voice !== 'connected'}
        title={micEnabled ? 'ミュート' : 'ミュート解除'} onClick={toggleMic}
      >{micEnabled ? '🎙' : '🔇'}</button>
    </div>
  );
}

export function ChannelSidebar() {
  const { mode, view2d, participants, sharer, wsConnected } = useStore();
  const in2d = mode === '2d';
  return (
    <div className="channels">
      <div className="guildhdr">
        Tonarium
        {!wsConnected && <span className="reconn">再接続中…</span>}
      </div>
      <div className="chlist">
        <div className="cat">テキストチャンネル</div>
        <Channel icon="#" name="雑談" active={in2d && view2d === 'chat'} onClick={() => openView('chat')} />
        <Channel icon="📌" name="付箋ボード" active={in2d && view2d === 'board'} onClick={() => openView('board')} />
        <div className="cat">ボイス・空間</div>
        <Channel icon="🔊" name="セッション" active={in2d && view2d === 'session'} onClick={() => openView('session')}>
          {sharer && <span className="livebadge">LIVE</span>}
        </Channel>
        <div className="vmembers">
          {participants.map((p) => <VoiceMember key={p.id} p={p} />)}
        </div>
        <Channel icon="🧊" name="3D空間" active={!in2d} onClick={() => setMode('3d')}>
          <span className="count">{participants.filter((p) => p.mode === '3d').length}</span>
        </Channel>
      </div>
      <VoicePanel />
      <UserPanel />
    </div>
  );
}

// ---------- 右: メンバー一覧 ----------
function MemberRow({ p }: { p: Participant }) {
  const speaking = useStore((s) => !!s.speaking[p.id]);
  const micOff = useStore((s) => s.voice === 'connected' && s.micOn[p.id] === false);
  const live = useStore((s) => s.sharer === p.id);
  const self = useStore((s) => s.selfId === p.id);
  return (
    <div className="member">
      <Avatar id={p.id} name={p.name} size={32} speaking={speaking} />
      <div className="minfo">
        <div className="mname">{p.name}{self && <span className="sub">（自分）</span>}</div>
        <div className="sub">{live ? '🔴 配信中' : micOff ? '🔇 ミュート中' : speaking ? '話しています' : ''}</div>
      </div>
    </div>
  );
}

export function MemberList() {
  const participants = useStore((s) => s.participants);
  const in3d = participants.filter((p) => p.mode === '3d');
  const in2d = participants.filter((p) => p.mode === '2d');
  return (
    <div className="members">
      <div className="cat">3D空間 — {in3d.length}</div>
      {in3d.map((p) => <MemberRow key={p.id} p={p} />)}
      <div className="cat">2D — {in2d.length}</div>
      {in2d.map((p) => <MemberRow key={p.id} p={p} />)}
    </div>
  );
}

// ---------- チャット ----------
export function Chat({ compact = false }: { compact?: boolean }) {
  const chat = useStore((s) => s.chat);
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
    <div className={`chat ${compact ? 'compact' : ''}`}>
      {compact && <div className="panelhdr"># 雑談</div>}
      <div className="messages" ref={listRef}>
        {chat.map((m, i) => {
          if (m.from === null) return <div key={m.id} className="sys">→ {m.text}</div>;
          const prev = chat[i - 1];
          const cont = prev && prev.from === m.from && m.at - prev.at < 5 * 60_000;
          const time = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return cont ? (
            <div key={m.id} className="msg cont"><div className="mtext">{m.text}</div></div>
          ) : (
            <div key={m.id} className="msg">
              <Avatar id={m.from} name={m.fromName} size={compact ? 32 : 40} />
              <div className="mbody">
                <div><b style={{ color: colorOf(m.from) }}>{m.fromName}</b><span className="time">{time}</span></div>
                <div className="mtext">{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="composer">
        <input
          placeholder="#雑談 へメッセージを送信" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
        />
      </div>
    </div>
  );
}
