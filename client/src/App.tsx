import { useState } from 'react';
import { useStore, set } from './store.ts';
import { connectWs } from './net/ws.ts';
import { connectVoice } from './net/livekit.ts';
import { setMode } from './actions.ts';
import { ChannelSidebar, Chat, MemberList } from './ui.tsx';
import { SessionView, BoardView } from './view2d/View2D.tsx';
import { View3D } from './view3d/View3D.tsx';

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
  const join = () => {
    const n = name.trim() || 'ゲスト';
    try { localStorage.setItem('tonarium.name', n); } catch { /* ignore */ }
    set({ selfId: loadId(), selfName: n, joined: true });
    connectWs();
    void connectVoice();
  };
  return (
    <div className="joinbg">
      <div className="join">
        <h1>Tonarium へようこそ</h1>
        <p>2D と 3D を行き来できる通話ルーム（プロトタイプ）</p>
        <label>表示名</label>
        <input
          autoFocus value={name} maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && join()}
        />
        <button className="primary" onClick={join}>参加する</button>
        <small>マイクの許可を求められます。推奨: デスクトップ版 Chrome / Edge</small>
      </div>
    </div>
  );
}

const TITLES = {
  chat: { icon: '#', name: '雑談', topic: 'テキストで話そう' },
  session: { icon: '🔊', name: 'セッション', topic: '通話と配信。3D空間のようすもここで見られます' },
  board: { icon: '📌', name: '付箋ボード', topic: '付箋は3D空間にも置かれます' },
  '3d': { icon: '🧊', name: '3D空間', topic: 'WASD/矢印: 移動 ・ ドラッグ: 視点 ・ 付箋クリック: 選択/ドラッグで移動' },
};

function MainHeader() {
  const mode = useStore((s) => s.mode);
  const view2d = useStore((s) => s.view2d);
  const t = TITLES[mode === '3d' ? '3d' : view2d];
  return (
    <div className="mainhdr">
      <span className="chicon">{t.icon}</span>
      <b>{t.name}</b>
      <span className="topic">{t.topic}</span>
      <div className="spacer" />
      <div className="modeswitch">
        <button className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')}>2D</button>
        <button className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')}>3D</button>
      </div>
    </div>
  );
}

export function App() {
  const joined = useStore((s) => s.joined);
  const mode = useStore((s) => s.mode);
  const view2d = useStore((s) => s.view2d);
  if (!joined) return <JoinScreen />;
  const chatIsMain = mode === '2d' && view2d === 'chat';
  return (
    <div className="dc">
      <nav className="rail"><div className="guild" title="Tonarium">T</div></nav>
      <ChannelSidebar />
      <div className="mainarea">
        <MainHeader />
        <div className="mainbody">
          <main>
            {mode === '3d' ? <View3D /> : view2d === 'chat' ? <Chat /> : view2d === 'session' ? <SessionView /> : <BoardView />}
          </main>
          {/* チャットがメインでないときは右側に常に出す（どの表示でも会話に参加できるように） */}
          <aside>{chatIsMain ? <MemberList /> : <Chat compact />}</aside>
        </div>
      </div>
    </div>
  );
}
