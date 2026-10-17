import { useState } from 'react';
import { useStore, set } from './store.ts';
import { connectWs } from './net/ws.ts';
import { connectVoice, toggleMic, toggleShare } from './net/livekit.ts';
import { setMode } from './actions.ts';
import { Sidebar } from './Sidebar.tsx';
import { View2D } from './view2d/View2D.tsx';
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
    <div className="join">
      <h1>Tonarium</h1>
      <p>2D と 3D を行き来できる通話ルーム（プロトタイプ）</p>
      <input
        autoFocus placeholder="表示名" value={name} maxLength={24}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && join()}
      />
      <button className="primary" onClick={join}>参加する</button>
      <small>マイクの許可を求められます。推奨: デスクトップ版 Chrome / Edge</small>
    </div>
  );
}

function Header() {
  const { mode, voice, voiceError, micEnabled, sharer, selfId, wsConnected } = useStore();
  const sharingSelf = sharer === selfId;
  const voiceOk = voice === 'connected';
  return (
    <header>
      <strong>Tonarium</strong>
      <span className={`status ${wsConnected ? 'ok' : 'ng'}`}>{wsConnected ? '接続中' : '再接続中…'}</span>
      <span className={`status ${voiceOk ? 'ok' : 'ng'}`} title={voiceError ?? ''}>
        通話: {{ off: '未接続', connecting: '接続中…', connected: '参加中', unavailable: '利用不可' }[voice]}
      </span>
      <div className="spacer" />
      <button disabled={!voiceOk} className={micEnabled ? '' : 'warn'} onClick={toggleMic}>
        {micEnabled ? '🎙 マイクON' : '🔇 ミュート中'}
      </button>
      <button disabled={!voiceOk || (!!sharer && !sharingSelf)} className={sharingSelf ? 'warn' : ''} onClick={toggleShare}>
        {sharingSelf ? '■ 配信を停止' : '🖥 画面を配信'}
      </button>
      <div className="modeswitch">
        <button className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')}>2D</button>
        <button className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')}>3D</button>
      </div>
      {voiceError && <span className="error" title={voiceError}>⚠ {voiceError}</span>}
    </header>
  );
}

export function App() {
  const joined = useStore((s) => s.joined);
  const mode = useStore((s) => s.mode);
  if (!joined) return <JoinScreen />;
  return (
    <div className="app">
      <Header />
      <div className="body">
        <main>{mode === '2d' ? <View2D /> : <View3D />}</main>
        <Sidebar />
      </div>
    </div>
  );
}
