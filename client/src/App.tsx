import { useEffect, useState } from 'react';
import { useStore, set } from './store.ts';
import { connectWs } from './net/ws.ts';
import { iconUrl } from './icon.ts';
import { ProfileDialog } from './Profile.tsx';
import { HammerCursor, Lightbox } from './world/common.tsx';
import { WorldSelect } from './world/WorldSelect.tsx';
import { WorldScreen } from './world/WorldScreen.tsx';

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
        <span className="wmark big">ト</span>
        <h1>Tonarium へようこそ</h1>
        <p>2D と 3D を行き来できるワールド（プロトタイプ）</p>
        <div className="joinicon">
          <button className="avbtn" title="アイコン・3D アバターを設定" onClick={() => setProfile(true)} disabled={!name.trim()}>
            {icon ? <img className="av" src={icon} alt="" /> : <div className="av noicon">{name.trim().slice(0, 1) || '?'}</div>}
          </button>
          <small>{name.trim() ? 'クリックでアイコン・3D アバター・自己紹介を設定' : '名前を入れるとプロフィールを設定できます'}</small>
        </div>
        <label htmlFor="joinname">表示名</label>
        <input
          id="joinname" autoFocus value={name} maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && join()}
        />
        <button className="primary" onClick={join}>はじめる</button>
        <small>推奨: デスクトップ版 Chrome / Edge</small>
      </div>
    </div>
  );
}

export function App() {
  const joined = useStore((s) => s.joined);
  const session = useStore((s) => s.session);
  if (!joined) return <JoinScreen />;
  return (
    <>
      {session ? <WorldScreen /> : <WorldSelect />}
      <Lightbox />
      <HammerCursor />
    </>
  );
}
