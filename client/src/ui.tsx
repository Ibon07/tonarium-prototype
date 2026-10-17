// Discord 風レイアウトの共通部品（チャンネル一覧・メンバー一覧・チャット・ユーザーパネル）
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ChannelDef, ChatMessage, User } from '../../shared/protocol.ts';
import { useStore, set, colorOf, channelOf, heldHammer } from './store.ts';
import { send } from './net/ws.ts';
import { toggleMic, toggleShare } from './net/livekit.ts';
import { joinSession, leaveSession, openText, setMode } from './actions.ts';
import { SILENT, formatDistance, useNearby } from './spatial.ts';

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

// ---------- 左: チャンネル一覧 ----------
function TextChannel({ ch }: { ch: ChannelDef }) {
  const active = useStore((s) => s.view === 'text' && s.textChannel === ch.id);
  return (
    <div className={`ch ${active ? 'active' : ''}`} onClick={() => openText(ch.id)} title={ch.topic}>
      <span className="chicon">#</span>
      <span className="chname">{ch.name}</span>
    </div>
  );
}

function VoiceMember({ u, dist, large = false }: { u: User; dist?: number; large?: boolean }) {
  // 発話は自分と同じセッションの人だけ LiveKit から分かる
  const speaking = useStore((s) => s.session === u.session && !!s.speaking[u.id]);
  const far = dist !== undefined && dist > SILENT;
  return (
    <div className={`vmember ${large ? 'large' : ''} ${far ? 'far' : ''}`}>
      <Avatar id={u.id} name={u.name} size={large ? 32 : 24} speaking={speaking} />
      <span className="vname">{u.name}</span>
      {!u.micOn && <span className="ico" title="ミュート">🔇</span>}
      {u.sharing && <span className="livebadge">LIVE</span>}
      {u.mode === '3d' && <span className="modebadge">3D</span>}
      {dist !== undefined && <span className="dist">{formatDistance(dist)}</span>}
    </div>
  );
}

/** 参加中セッションの参加者を自分から近い順に。声が届かない距離の手前に区切り線を入れる */
export function NearbyList({ large = false }: { large?: boolean }) {
  const list = useNearby();
  const cut = list.findIndex((x) => x.d > SILENT);
  return (
    <>
      {list.map((x, i) => (
        <Fragment key={x.user.id}>
          {i === cut && <div className="farline"><span>ここから先は声が届きません</span></div>}
          <VoiceMember u={x.user} dist={x.d} large={large} />
        </Fragment>
      ))}
    </>
  );
}

function SessionChannel({ ch }: { ch: ChannelDef }) {
  const users = useStore((s) => s.users);
  const joined = useStore((s) => s.session === ch.id);
  const active = useStore((s) => s.session === ch.id && s.view !== 'text');
  const members = users.filter((u) => u.session === ch.id);
  return (
    <>
      <div
        className={`ch ${active ? 'active' : ''} ${joined ? 'joined' : ''}`}
        onClick={() => joinSession(ch.id)} title={joined ? '通話画面を開く' : 'クリックで参加'}
      >
        <span className="chicon">🔊</span>
        <span className="chname">{ch.name}</span>
        {members.some((u) => u.sharing) && <span className="livebadge">LIVE</span>}
      </div>
      {members.length > 0 && (
        <div className="vmembers">
          {joined ? <NearbyList /> : members.map((u) => <VoiceMember key={u.id} u={u} />)}
        </div>
      )}
    </>
  );
}

function VoicePanel() {
  const { voice, voiceError, sharer, selfId, mode, session } = useStore();
  if (!session) return null;
  const sharingSelf = sharer === selfId;
  const ok = voice === 'connected';
  return (
    <div className="voicepanel">
      <div className="vstate">
        <div className={`conn ${ok ? 'ok' : voice === 'unavailable' ? 'ng' : 'wait'}`}>
          {{ off: '未接続', connecting: '接続中…', connected: '通話中', unavailable: '通話に接続できません' }[voice]}
        </div>
        <div className="sub" title={voiceError ?? ''}>{voiceError ?? `${channelOf(session)?.name}（${mode.toUpperCase()}）`}</div>
      </div>
      <div className="vbtns">
        <button
          title={sharingSelf ? '配信を停止' : '画面を配信'} className={sharingSelf ? 'on' : ''}
          disabled={!ok || (!!sharer && !sharingSelf)} onClick={toggleShare}
        >🖥</button>
        <button
          title={mode === '3d' ? '2Dに戻る' : '3D空間に入る'} className={mode === '3d' ? 'on' : ''}
          onClick={() => setMode(mode === '3d' ? '2d' : '3d')}
        >🧊</button>
        <button title="切断" className="hangup" onClick={leaveSession}>📞</button>
      </div>
    </div>
  );
}

function UserPanel() {
  const { selfId, selfName, micEnabled, mode, session } = useStore();
  const speaking = useStore((s) => !!s.speaking[s.selfId]);
  return (
    <div className="userpanel">
      <Avatar id={selfId} name={selfName} size={32} speaking={speaking} />
      <div className="uinfo">
        <div className="uname">{selfName}</div>
        <div className="sub">{!session ? 'オンライン' : mode === '3d' ? '3D空間にいます' : '2Dで参加中'}</div>
      </div>
      <button
        className={`iconbtn ${micEnabled ? '' : 'off'}`}
        title={micEnabled ? 'ミュート' : 'ミュート解除'} onClick={toggleMic}
      >{micEnabled ? '🎙' : '🔇'}</button>
    </div>
  );
}

export function ChannelSidebar() {
  const { guild, wsConnected } = useStore();
  return (
    <div className="channels">
      <div className="guildhdr">
        {guild.name}
        {!wsConnected && <span className="reconn">再接続中…</span>}
      </div>
      <div className="chlist">
        {guild.categories.map((cat) => (
          <div key={cat.name}>
            <div className="cat">{cat.name}</div>
            {cat.channels.map((ch) =>
              ch.type === 'text' ? <TextChannel key={ch.id} ch={ch} /> : <SessionChannel key={ch.id} ch={ch} />,
            )}
          </div>
        ))}
      </div>
      <VoicePanel />
      <UserPanel />
    </div>
  );
}

// ---------- 右: メンバー一覧（セッションごと） ----------
function MemberRow({ u }: { u: User }) {
  const speaking = useStore((s) => s.session === u.session && !!s.speaking[u.id]);
  const self = useStore((s) => s.selfId === u.id);
  const where = u.session ? `${u.mode === '3d' ? '🧊' : '🔊'} ${channelOf(u.session)?.name ?? ''}` : '';
  return (
    <div className="member">
      <Avatar id={u.id} name={u.name} size={32} speaking={speaking} />
      <div className="minfo">
        <div className="mname">{u.name}{self && <span className="sub">（自分）</span>}</div>
        <div className="sub">{u.sharing ? '🔴 配信中' : where}</div>
      </div>
    </div>
  );
}

export function MemberList() {
  const users = useStore((s) => s.users);
  const inSession = users.filter((u) => u.session);
  const idle = users.filter((u) => !u.session);
  return (
    <div className="members">
      <div className="cat">通話中 — {inSession.length}</div>
      {inSession.map((u) => <MemberRow key={u.id} u={u} />)}
      <div className="cat">オンライン — {idle.length}</div>
      {idle.map((u) => <MemberRow key={u.id} u={u} />)}
    </div>
  );
}

// ---------- チャット ----------
function ChatImage({ src }: { src?: string }) {
  if (!src) return null;
  return <img className="chatimg" src={src} alt="" onClick={() => set({ lightbox: src })} />;
}

/** 2D でハンマーを持っている間、マウスのところにハンマーを出す（クリックで振る） */
export function HammerCursor() {
  const on = useStore((s) => s.mode === '2d' && !!s.session && !!heldHammer(s));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return;
    const move = (e: MouseEvent) => {
      if (ref.current) ref.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    const down = () => {
      const el = ref.current?.firstElementChild as HTMLElement | null;
      if (!el) return;
      el.classList.remove('swing');
      void el.offsetWidth; // アニメーションをやり直す
      el.classList.add('swing');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mousedown', down);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mousedown', down); };
  }, [on]);
  if (!on) return null;
  return <div ref={ref} className="hammercursor"><div>🔨</div></div>;
}

/** チャット画像の拡大表示 */
export function Lightbox() {
  const src = useStore((s) => s.lightbox);
  if (!src) return null;
  return (
    <div className="lightbox" onClick={() => set({ lightbox: null })}>
      <img src={src} alt="" />
      <a className="dl" href={src} download="tonarium.jpg" onClick={(e) => e.stopPropagation()}>保存</a>
    </div>
  );
}

const NO_MESSAGES: ChatMessage[] = [];

export function Chat({ ch, title, compact = false }: { ch: string; title: string; compact?: boolean }) {
  const chat = useStore((s) => s.chats[ch] ?? NO_MESSAGES);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, ch]);
  const submit = () => {
    if (!text.trim()) return;
    send({ t: 'chat', ch, text });
    setText('');
  };
  return (
    <div className={`chat ${compact ? 'compact' : ''}`}>
      {compact && <div className="panelhdr">{title}</div>}
      <div className="messages" ref={listRef}>
        {!compact && (
          <div className="welcome">
            <div className="bigicon">#</div>
            <h2>{title} へようこそ！</h2>
            <div className="sub">{channelOf(ch)?.topic ?? ''}</div>
          </div>
        )}
        {chat.map((m, i) => {
          if (m.from === null) return <div key={m.id} className="sys">→ {m.text}</div>;
          const prev = chat[i - 1];
          const cont = prev && prev.from === m.from && m.at - prev.at < 5 * 60_000;
          const time = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return cont ? (
            <div key={m.id} className="msg cont"><div className="mtext">{m.text}</div><ChatImage src={m.image} /></div>
          ) : (
            <div key={m.id} className="msg">
              <Avatar id={m.from} name={m.fromName} size={compact ? 32 : 40} />
              <div className="mbody">
                <div><b style={{ color: colorOf(m.from) }}>{m.fromName}</b><span className="time">{time}</span></div>
                <div className="mtext">{m.text}</div>
                <ChatImage src={m.image} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="composer">
        <input
          placeholder={`${title} へメッセージを送信`} value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
        />
      </div>
    </div>
  );
}
