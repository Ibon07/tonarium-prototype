import { useEffect, useState } from 'react';
import { sessionChatKey } from '../../shared/protocol.ts';
import { useStore, set, channelOf } from './store.ts';
import { connectWs } from './net/ws.ts';
import { openView, setMode } from './actions.ts';
import { ChannelSidebar, Chat, HammerCursor, Lightbox, MemberList } from './ui.tsx';
import { SessionView, BoardView } from './view2d/View2D.tsx';
import { View3D } from './view3d/View3D.tsx';
import { iconUrl } from './icon.ts';
import { ProfileDialog } from './Profile.tsx';

function loadId() {
  try {
    let id = localStorage.getItem('tonarium.id');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('tonarium.id', id); }
    // ?as=xxx で同一ブラウザから別人として入れる（動作確認用）
    const as = new URLSearchParams(location.search).get('as');
    return as ? `${id}-${as}` : id;
  } catch {
    return crypto.randomUUID();
  }
}

function JoinScreen() {
  const [name, setName] = useState(() => {
    try { return localStorage.getItem('tonarium.name') ?? ''; } catch { return ''; }
  });
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    const n = name.trim();
    if (!n) { setIcon(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      const url = iconUrl(n);
      void fetch(url).then((r) => { if (alive) setIcon(r.ok ? url : null); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [name]);
  const [profile, setProfile] = useState(false);
  const closeProfile = () => {
    setProfile(false);
    const n = name.trim();
    void fetch(iconUrl(n)).then((r) => setIcon(r.ok ? iconUrl(n) : null));
  };
  const join = () => {
    const n = name.trim() || 'ゲスト';
    try { localStorage.setItem('tonarium.name', n); } catch { /* ignore */ }
    set({ selfId: loadId(), selfName: n, joined: true });
    connectWs();
  };
  return (
    <div className="joinbg">
      {profile && <ProfileDialog name={name} onClose={closeProfile} />}
      <div className="join">
        <h1>Tonarium へようこそ</h1>
        <p>2D と 3D を行き来できる通話ルーム（プロトタイプ）</p>
        <div className="joinicon">
          <button className="avbtn" title="アイコン・3D アバターを設定" onClick={() => setProfile(true)} disabled={!name.trim()}>
            {icon ? <img className="av" src={icon} alt="" /> : <div className="av noicon">{name.trim().slice(0, 1) || '?'}</div>}
          </button>
          <small>{name.trim() ? 'クリックでアイコン・3D アバターを設定' : '名前を入れるとアイコン・3D アバターを設定できます'}</small>
        </div>
        <label>表示名</label>
        <input
          autoFocus value={name} maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && join()}
        />
        <button className="primary" onClick={join}>はじめる</button>
        <small>推奨: デスクトップ版 Chrome / Edge</small>
      </div>
    </div>
  );
}

const TOPIC_3D = 'クリックで操作開始 ・ マウス: 視点 ・ 照準で操作 ・ Esc: カーソルを出す';

function MainHeader() {
  const { mode, view, textChannel, session } = useStore();
  if (view === 'text' || !session) {
    const ch = channelOf(textChannel);
    return (
      <div className="mainhdr">
        <span className="chicon">#</span>
        <b>{ch?.name}</b>
        {ch?.topic && <span className="topic">{ch.topic}</span>}
      </div>
    );
  }
  return (
    <div className="mainhdr">
      <span className="chicon">🔊</span>
      <b>{channelOf(session)?.name}</b>
      {mode === '2d' ? (
        <div className="tabs">
          <button className={view === 'session' ? 'active' : ''} onClick={() => openView('session')}>通話</button>
          <button className={view === 'board' ? 'active' : ''} onClick={() => openView('board')}>付箋ボード</button>
        </div>
      ) : (
        <span className="topic">{TOPIC_3D}</span>
      )}
      <div className="spacer" />
      <div className="modeswitch">
        <button className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')}>2D</button>
        <button className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')}>3D</button>
      </div>
    </div>
  );
}

export function App() {
  const { joined, mode, view, textChannel, session } = useStore();
  if (!joined) return <JoinScreen />;
  const textView = view === 'text' || !session;
  const textName = `#${channelOf(textChannel)?.name ?? ''}`;
  const sessionChat = session ? (
    <Chat compact ch={sessionChatKey(session)} title={`🔊 ${channelOf(session)?.name ?? ''} のチャット`} />
  ) : null;
  return (
    <div className="dc">
      <nav className="rail"><div className="guild" title="Tonarium">T</div></nav>
      <ChannelSidebar />
      <div className="mainarea">
        <MainHeader />
        <div className="mainbody">
          <main>
            {textView ? <Chat key={textChannel} ch={textChannel} title={textName} />
              : mode === '3d' ? <View3D />
              : view === 'session' ? <SessionView /> : <BoardView />}
          </main>
          <aside>{textView ? <MemberList /> : sessionChat}</aside>
        </div>
      </div>
      <Lightbox />
      <HammerCursor />
    </div>
  );
}
