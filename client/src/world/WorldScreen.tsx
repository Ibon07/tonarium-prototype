import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SOUNDS } from '../../../shared/sounds.ts';
import { useStore, set, nameOf, worldOf } from '../store.ts';
import { dropFollowers, follow, leaveSession, playSound, requestLive, setViewLive, switchMode } from '../actions.ts';
import { dropHammer, place2d } from '../items/actions.ts';
import { consumeHitFx } from '../items/effects.ts';
import { toggleMic, toggleShare } from '../net/livekit.ts';
import { View3D } from '../view3d/View3D.tsx';
import { ProfileDialog } from '../Profile.tsx';
import { Icon } from './Icon.tsx';
import { Popover, itemLabel } from './common.tsx';
import { NearList } from './NearList.tsx';
import { FaceStrip } from './FaceStrip.tsx';
import { NoticeLog } from './NoticeLog.tsx';
import { WindowLayer } from './WindowLayer.tsx';
import { ProfileCard } from './ProfileCard.tsx';
import { PortraitCanvas } from './Portraits.tsx';
import { ConfirmOpen } from './Links.tsx';
import { closeWindow, openWindow, setWinMode } from './windows.ts';

function WorldBadge() {
  const world = useStore((s) => worldOf(s.session));
  const selfName = useStore((s) => s.selfName);
  const wsConnected = useStore((s) => s.wsConnected);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [profile, setProfile] = useState(false);
  return (
    <div className="worldbadge">
      <span className="wmark">ト</span>
      <span className="wname">{world?.name}</span>
      {!wsConnected && <span className="reconn">再接続中…</span>}
      <span className="vline" />
      <button
        className="ib" aria-label="設定" title="設定" data-popanchor
        onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
      ><Icon name="settings" size={18} /></button>
      {menu && (
        <Popover anchor={menu} side="down" onClose={() => setMenu(null)} className="settings">
          <button className="ib menuitem" onClick={() => { setProfile(true); setMenu(null); }}><Icon name="user" />プロフィールを編集</button>
          <button className="ib menuitem" onClick={() => { setMenu(null); leaveSession(); }}><Icon name="leave" />ワールドを移動</button>
        </Popover>
      )}
      {profile && createPortal(<ProfileDialog name={selfName} onClose={() => setProfile(false)} />, document.body)}
    </div>
  );
}

function Soundboard({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  return (
    <Popover anchor={anchor} side="up" onClose={onClose} className="soundboard">
      <span className="menutitle">サウンドボード（近くの人に聞こえます）</span>
      <div className="sgrid">
        {SOUNDS.map((x) => <button key={x.id} className="ib sbtn" onClick={() => playSound(x.id)}>{x.name}</button>)}
      </div>
    </Popover>
  );
}

function Dock() {
  const { voice, micEnabled, sharer, selfId, mode, winMode, switching } = useStore();
  const [sb, setSb] = useState<DOMRect | null>(null);
  const ok = voice === 'connected';
  const sharingSelf = sharer === selfId;
  return (
    <div role="toolbar" aria-label="セッション操作" className="dock">
      <button className={`dk ${micEnabled ? '' : 'muted'}`} onClick={() => void toggleMic()} aria-label={micEnabled ? 'マイクをミュート' : 'マイクのミュートを解除'} title={micEnabled ? 'ミュート' : 'ミュート解除'}>
        <Icon name={micEnabled ? 'mic' : 'micOff'} size={22} />
      </button>
      <button
        className={`dk ${sharingSelf ? 'active' : ''}`} disabled={!ok || (!!sharer && !sharingSelf)} onClick={() => void toggleShare()}
        aria-label={sharingSelf ? '画面共有を停止' : '画面共有'} title={sharingSelf ? '画面共有を停止' : !ok ? '通話に接続すると使えます' : sharer ? `${nameOf(sharer)} が共有中` : '画面共有'}
      ><Icon name="screen" size={22} /></button>
      <button className="dk" aria-label="サウンドボード" title="サウンドボード" data-popanchor onClick={(e) => setSb(sb ? null : e.currentTarget.getBoundingClientRect())}>
        <Icon name="music" size={22} />
      </button>
      <span className="dsep" />
      <div className="dseg" role="radiogroup" aria-label="ウィンドウの表示">
        <button role="radio" aria-checked={winMode === 'simple'} className={winMode === 'simple' ? 'on' : ''} onClick={() => setWinMode('simple')} title="開いたものを 1 つ大きく表示し、ほかは下に並べる">
          <Icon name="window" size={15} />カンタン
        </button>
        <button role="radio" aria-checked={winMode === 'free'} className={winMode === 'free' ? 'on' : ''} onClick={() => setWinMode('free')} title="ウィンドウを重ねて表示し、ドラッグで動かす">
          <Icon name="layers" size={15} />フリー
        </button>
      </div>
      <span className="dsep" />
      <button className="dk mode" disabled={!!switching} onClick={() => switchMode(mode === '2d' ? '3d' : '2d')} title={mode === '2d' ? '3D 空間に入る' : '2D に戻る'}>
        <Icon name={mode === '2d' ? 'cube' : 'flat'} size={20} />{mode === '2d' ? '3D' : '2D'}
      </button>
      <button className="dk leave" onClick={leaveSession} aria-label="切断" title="切断（ワールド選択に戻る）"><Icon name="leave" size={22} /></button>
      {sb && <Soundboard anchor={sb} onClose={() => setSb(null)} />}
    </div>
  );
}

/** ドックの上に出す、いまの状態のお知らせ */
function StatusChips() {
  const s = useStore();
  const me = s.participants.find((p) => p.id === s.selfId);
  const hammer = Object.values(s.items).find((i) => i.kind === 'hammer' && i.holder === s.selfId);
  const followers = s.participants.filter((p) => p.follow === s.selfId);
  const placedSelf = me?.mode === '2d' && !!me.pos && !me.follow;
  const chips: React.ReactNode[] = [];
  if (s.voice === 'connecting') chips.push(<span key="v">通話に接続中…</span>);
  if (s.voice === 'unavailable') chips.push(<span key="v" title={s.voiceError ?? ''}>通話に接続できません{s.voiceError ? `（${s.voiceError}）` : ''}</span>);
  if (s.mode === '2d' && hammer) chips.push(<span key="h">ピコピコハンマーを持っています · 人をクリックで叩く<button className="chipbtn" onClick={dropHammer}>手放す</button></span>);
  if (placedSelf) chips.push(<span key="p"><Icon name="pin" size={14} />3D 空間の中にいます<button className="chipbtn" onClick={() => place2d(s.selfId, null)}>入口に戻る</button></span>);
  if (followers.length) {
    chips.push(
      <span key="f">
        {followers.map((f) => f.name).join('、')} がついてきています{me?.viewLive && ' · 視点をライブ中'}
        {me?.viewLive
          ? <button className="chipbtn" onClick={() => setViewLive(false)}>ライブを止める</button>
          : s.mode === '3d' && <button className="chipbtn" onClick={() => setViewLive(true)}>視点をライブ</button>}
        <button className="chipbtn" onClick={dropFollowers}>解除</button>
      </span>,
    );
  }
  const target = me?.follow ? s.participants.find((p) => p.id === me.follow) : undefined;
  if (target) {
    const key = `view:${target.id}`;
    const feed = target.viewLive && !!s.camFeeds[key];
    chips.push(
      <span key="t">
        <Icon name="follow" size={14} />{target.name} についていっています
        {feed
          ? <button className="chipbtn" onClick={() => openWindow(key)}>ライブを見る</button>
          : target.viewLive ? <span className="sub light">ライブ接続中…</span>
          : <button className="chipbtn" disabled={s.liveRequested === target.id} onClick={() => requestLive(target.id)}>{s.liveRequested === target.id ? 'リクエスト済み' : 'ライブをリクエスト'}</button>}
        <button className="chipbtn" onClick={() => follow(null)}>やめる</button>
      </span>,
    );
  }
  if (!chips.length) return null;
  return <div className="statuschips">{chips.map((c, i) => <div key={i} className="schip">{c}</div>)}</div>;
}

function SwitchLoading() {
  const switching = useStore((s) => s.switching);
  const world = useStore((s) => worldOf(s.session));
  if (!switching) return null;
  const to3d = switching.to === '3d';
  return (
    <div className={`switchload ${to3d ? 'to3d' : 'to2d'}`} role="status" aria-live="polite">
      <div className="slbox">
        <Icon name={to3d ? 'cube' : 'flat'} size={40} stroke={1.6} />
        <b>{to3d ? `${world?.name ?? ''} の 3D 空間に入っています…` : '2D に切り替えています…'}</b>
        <div className="slbar"><span style={{ animationDuration: `${switching.dur}ms` }} /></div>
      </div>
    </div>
  );
}

function ConfirmClose() {
  const key = useStore((s) => s.confirmClose);
  const sharer = useStore((s) => s.sharer);
  const items = useStore((s) => s.items);
  if (!key) return null;
  const id = key.slice(key.indexOf(':') + 1);
  const it = items[id];
  const title = key === 'share' ? `${nameOf(sharer)} の画面共有`
    : key.startsWith('cam:') ? 'カメラのライブ'
    : key.startsWith('view:') ? `${nameOf(id)} の視点`
    : it ? itemLabel(it) : 'ウィンドウ';
  const cancel = () => set({ confirmClose: null });
  return (
    <div className="modalbg light" onClick={cancel}>
      <div role="alertdialog" aria-modal="true" aria-label="ウィンドウを閉じる確認" className="confirm" onClick={(e) => e.stopPropagation()}>
        <h2>{title} を閉じますか？</h2>
        <span className="sub wrap">リストからいつでも開き直せます。</span>
        <div className="row end">
          <button onClick={cancel}>キャンセル</button>
          <button className="dark" autoFocus onClick={() => closeWindow(key)}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

function HitFxLayer({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const fx = useStore((s) => s.hitFx);
  const mode = useStore((s) => s.mode);
  if (mode !== '2d') return null;
  return (
    <>
      {fx.map((f) => {
        const el = root.current;
        const a = el?.querySelector(`[data-uid="${f.from}"]`)?.getBoundingClientRect();
        const b = el?.querySelector(`[data-uid="${f.to}"]`)?.getBoundingClientRect();
        if (!el || !b) { queueMicrotask(() => consumeHitFx(f.key)); return null; }
        const to = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        const from = a ? { x: a.left + a.width / 2, y: a.top + a.height / 2 } : { x: to.x, y: to.y - 120 };
        return (
          <div key={f.key} className="hitfx" style={{ left: to.x, top: to.y }}>
            <div
              className="flyhammer"
              style={{ '--dx': `${from.x - to.x}px`, '--dy': `${from.y - to.y}px` } as React.CSSProperties}
              onAnimationEnd={() => consumeHitFx(f.key)}
            >🔨</div>
            <div className="pico">ピコッ!</div>
          </div>
        );
      })}
    </>
  );
}

/** 頼んだ視点のライブが届いたら開く */
function useOpenRequestedLive() {
  const requested = useStore((s) => s.liveRequested);
  const ready = useStore((s) => !!requested && !!s.camFeeds[`view:${requested}`]);
  useEffect(() => {
    if (!ready || !requested) return;
    openWindow(`view:${requested}`);
    set({ liveRequested: null });
  }, [ready, requested]);
}

export function WorldScreen() {
  useOpenRequestedLive();
  const mode = useStore((s) => s.mode);
  const locked = useStore((s) => s.locked);
  const folded = useStore((s) => s.folded);
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className={`world ${mode} ${locked ? 'locked' : ''} ${folded.left ? 'fl' : ''} ${folded.right ? 'fr' : ''}`}>
      {mode === '3d' && <View3D />}
      <WindowLayer />
      <PortraitCanvas />
      <div className="front">
        <WorldBadge />
        <NearList />
        <FaceStrip />
        <NoticeLog />
        <StatusChips />
        <Dock />
      </div>
      <SwitchLoading />
      <ConfirmClose />
      <ConfirmOpen />
      <ProfileCard />
      <HitFxLayer root={root} />
    </div>
  );
}
