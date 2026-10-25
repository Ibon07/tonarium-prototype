import { useMarketNavigation } from './market/navigation.ts';
import { useEffect, useRef, useState } from 'react';
import { useStore, set } from './store.ts';
import { connectWs } from './net/ws.ts';
import { iconUrl } from './icon.ts';
import { ProfileDialog } from './Profile.tsx';
import { HammerCursor, Lightbox } from './world/common.tsx';
import { Home } from './home/Home.tsx';
import { WorldScreen } from './world/WorldScreen.tsx';
import { PeekMascot, type MascotHandle } from './world/Mascot.tsx';
import { FEEDBACK_URL } from './feedback.ts';
import { CompatOverlay, MaintenanceOverlay, UpdateBanner } from './world/ServerNotices.tsx';

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
  const tona = useRef<MascotHandle>(null);
  const rimu = useRef<MascotHandle>(null);
  const lastHop = useRef(0);
  // 名前を打つと、交互にぴょんと反応する
  const typed = (v: string) => {
    setName(v);
    const now = performance.now();
    if (now - lastHop.current < 700) return;
    lastHop.current = now;
    (v.length % 2 ? tona : rimu).current?.hop();
  };
  const join = () => {
    const n = name.trim() || 'ゲスト';
    try { localStorage.setItem('tonarium.name', n); } catch { /* ignore */ }
    const id = loadId();
    set({ selfId: id, selfName: n, joined: true });
    // AD の進行は Tonarium の ID に紐付けて開始する（認証として信用はしない）
    useStore.getState().adBindTonarium(id, n);
    connectWs();
  };
  return (
    <div className="joinbg">
      {profile && <ProfileDialog name={name} onClose={closeProfile} />}
      <div className="joinstage">
        <PeekMascot who="tona" ref={tona} />
        <PeekMascot who="rimu" ref={rimu} />
        <div className="join">
          <h1 className="joinlogo"><img src="/brand/logo.png" alt="Tonarium" /></h1>
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
            onChange={(e) => typed(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && join()}
          />
          <button className="primary" onClick={join}>はじめる</button>
          <small>推奨: デスクトップ版 Chrome / Edge</small>
        </div>
      </div>
      <aside className="joinnotice" aria-label="このサイトについて">
        <div className="jnbody">
          <h2><span className="jnsign" aria-hidden="true">!</span>このサイトについて</h2>
          <p className="jnlead">
            <span>Tonarium は、<b>理想のユーザー体験を試すためのプロトタイプ</b>です。</span>
            <span>性能や安全性などの現実的な制約は後回しにしているため、<b>実際の完成形は大きく変わります</b>。</span>
            <span>試験終了後は、<b>ソースコードもデータもすべて破棄</b>し、引き継ぎません。</span>
          </p>
          <ul>
            <li>名前・アイコン・チャットなどは誰でも見られます。個人情報や大切な情報は入力しないでください</li>
            <li>小さな VPS で動いています。たくさんのタブで入る、大きな画像を何度も送るなど、負荷をかけすぎないようにお願いします</li>
            <li>気づいたことや「こうだったらいいのに」は、<a href={FEEDBACK_URL} target="_blank" rel="noreferrer">フィードバックフォーム</a>から気軽に送ってください</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

export function App() {
  useMarketNavigation();
  const joined = useStore((s) => s.joined);
  const session = useStore((s) => s.session);
  const incompatible = useStore((s) => s.incompatible);
  if (!joined) return <JoinScreen />;
  if (incompatible) return <CompatOverlay />;
  return (
    <>
      {session ? <WorldScreen /> : <Home />}
      <Lightbox />
      <HammerCursor />
      <UpdateBanner />
      <MaintenanceOverlay />
    </>
  );
}
