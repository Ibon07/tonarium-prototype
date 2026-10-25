import { contentAvailable, productFor } from '../../../shared/market.ts';
import { useOwnedContent } from '../market/store.ts';
import { OriginBadge } from '../market/OriginBadge.tsx';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { SOUNDS } from '../../../shared/sounds.ts';
import { WORLDS, WORLD_COUNTDOWN_MS, WORLD_KINDS } from '../../../shared/worlds.ts';
import { useStore, get, set, save, nameOf, sessionOf, isBroadcast, worldKindOf, serverNow } from '../store.ts';
import { send } from '../net/ws.ts';
import { dropFollowers, follow, leaveSession, playSound, requestLive, setViewLive } from '../actions.ts';
import { dropHammer, place2d } from '../items/actions.ts';
import { consumeHitFx } from '../items/effects.ts';
import { toggleMic, toggleShare } from '../net/livekit.ts';
// 3D 空間は three 一式が重いので、3D モードに入るときだけ読み込む
const View3D = lazy(() => import('../view3d/View3D.tsx').then((m) => ({ default: m.View3D })));
import { ProfileDialog } from '../Profile.tsx';
import { Icon } from './Icon.tsx';
import { Popover, itemLabel } from './common.tsx';
import { NearList } from './NearList.tsx';
import { FaceStrip } from './FaceStrip.tsx';
import { NoticeLog } from './NoticeLog.tsx';
import { WindowLayer } from './WindowLayer.tsx';
import { ProfileCard } from './ProfileCard.tsx';
import { HoppingMascots } from './Mascot.tsx';
import { SessionMenu } from '../home/SessionMenu.tsx';
import { PortraitCanvas } from './Portraits.tsx';
import { MapLayer } from './MapLayer.tsx';
import { ConfirmOpen } from './Links.tsx';
import { shareFiles, shareYouTube, youTubeId } from '../media.ts';
import { MediaSync } from '../mediaSync.tsx';
import { closeWindow, openWindow, setWinMode } from './windows.ts';
import { touchOnly, usePhone } from '../phone.ts';
import { MasterVolume } from './VolumeMenus.tsx';
import { SurvivorPanel } from './SurvivorPanel.tsx';
import { EmoteDockButton } from './Emotes.tsx';
import { unlockEmoteAudio } from './sounds.ts';

/** 名前はだれでも変えられ、全員に反映されてログに出る */
function SessionRename({ current, onDone }: { current: string; onDone: () => void }) {
  const [name, setName] = useState(current);
  const v = name.trim();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!v || v === current) return;
    send({ t: 'sessionRename', name: v });
    onDone();
  };
  return (
    <form className="renamerow" onSubmit={submit}>
      <input aria-label="セッション名" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <button className="renamebtn" type="submit" disabled={!v || v === current}>変更</button>
    </form>
  );
}

function WorldBadge() {
  const owned = useOwnedContent();
  const world = useStore((s) => sessionOf(s.session));
  const selfName = useStore((s) => s.selfName);
  const wsConnected = useStore((s) => s.wsConnected);
  const broadcast = useStore((s) => isBroadcast(s));
  const kind = useStore((s) => worldKindOf(s));
  const mode = useStore((s) => s.mode);
  const survivorWindowOpen = useStore((s) => s.windows.some((w) => w.key === 'survivors'));
  const pending = useStore((s) => !!s.worldPending && s.worldPending.sid === s.session);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [profile, setProfile] = useState(false);
  return (
    <div className="worldbadge">
      <img className="wmark" src="/brand/mark.png" alt="" />
      <span className="wname">{world?.name}</span>
      {kind === 'survivors' && mode === '2d' && <button className="chipbtn survivor-window-button" onClick={() => openWindow('survivors')}>{survivorWindowOpen ? 'ゲーム画面' : 'ゲームを開く'}</button>}
      {broadcast && <span className="bcpill" title="ブロードキャストモード：距離に関係なく声が届きます"><Icon name="megaphone" size={12} />ブロードキャスト</span>}
      {!wsConnected && <span className="reconn">再接続中…</span>}
      <span className="vline" />
      <button
        className="ib" aria-label="設定" title="設定" data-popanchor
        onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
      ><Icon name="settings" size={18} /></button>
      {menu && (
        <Popover anchor={menu} side="down" onClose={() => setMenu(null)} className="settings">
          <span className="menutitle">セッションの設定</span>
          <SessionRename current={world?.name ?? ''} onDone={() => setMenu(null)} />
          <span className="menusep" />
          <label className="switchrow">
            <span><b>ブロードキャストモード</b><span className="sub wrap">距離に関係なく全員の声が聞こえ、声の範囲のチャットも全員に届く（全員に反映）</span></span>
            <input type="checkbox" role="switch" checked={broadcast} onChange={(e) => send({ t: 'broadcast', on: e.target.checked })} />
          </label>
          <span className="menusep" />
          <span className="menutitle">ワールド（全員に反映）</span>
          <div className="worldpick" role="radiogroup" aria-label="ワールド">
            {WORLD_KINDS.filter((k) => contentAvailable(owned, 'worlds', k)).map((k) => (
              <div key={k} className="market-entry"><button
                role="radio" aria-checked={k === kind} className={`ib wpick ${k === kind ? 'on' : ''}`} disabled={pending}
                onClick={() => { if (k !== kind) { setMenu(null); set({ confirmWorld: k }); } }}
              >
                <b>{WORLDS[k].name}</b><span className="sub wrap">{WORLDS[k].desc}</span>
              </button><OriginBadge productId={productFor('worlds', k)?.id} onOpen={() => setMenu(null)} /></div>
            ))}
          </div>
          <span className="menusep" />
          <button className="ib menuitem" onClick={() => { setProfile(true); setMenu(null); }}><Icon name="user" />プロフィールを編集</button>
          <button className="ib menuitem" onClick={() => { setMenu(null); leaveSession(); }}><Icon name="leave" />セッションを移動</button>
        </Popover>
      )}
      {profile && createPortal(<ProfileDialog name={selfName} onClose={() => setProfile(false)} />, document.body)}
    </div>
  );
}

function Soundboard({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const owned = useOwnedContent();
  return (
    <Popover anchor={anchor} side="up" onClose={onClose} className="soundboard">
      <span className="menutitle">サウンドボード（近くの人に聞こえます）</span>
      <div className="sgrid">
        {SOUNDS.filter((x) => contentAvailable(owned, 'sounds', x.id)).map((x) => <div key={x.id} className="market-entry"><button className="ib sbtn" onClick={() => { unlockEmoteAudio(); playSound(x.id); }}>{x.name}</button><OriginBadge productId={productFor('sounds', x.id)?.id} onOpen={onClose} /></div>)}
      </div>
    </Popover>
  );
}

function Dock() {
  const { voice, micEnabled, sharer, selfId, winMode } = useStore(useShallow((s) => ({
    voice: s.voice, micEnabled: s.micEnabled, sharer: s.sharer, selfId: s.selfId, winMode: s.winMode,
  })));
  const [sb, setSb] = useState<DOMRect | null>(null);
  const [vol, setVol] = useState<DOMRect | null>(null);
  const ok = voice === 'connected';
  const sharingSelf = sharer === selfId;
  return (
    <div role="toolbar" aria-label="セッション操作" className="dock">
      <button className={`dk ${micEnabled ? '' : 'muted'}`} onClick={() => void toggleMic()} aria-label={micEnabled ? 'マイクをミュート' : 'マイクのミュートを解除'} title={micEnabled ? 'ミュート' : 'ミュート解除'}>
        <Icon name={micEnabled ? 'mic' : 'micOff'} size={22} />
      </button>
      {/* スマホのブラウザは画面共有できない */}
      {!touchOnly && (
        <button
          className={`dk ${sharingSelf ? 'active' : ''}`} disabled={!ok || (!!sharer && !sharingSelf)} onClick={() => void toggleShare()}
          aria-label={sharingSelf ? '画面共有を停止' : '画面共有'} title={sharingSelf ? '画面共有を停止' : !ok ? '通話に接続すると使えます' : sharer ? `${nameOf(sharer)} が共有中` : '画面共有'}
        ><Icon name="screen" size={22} /></button>
      )}
      <button className="dk" aria-label="サウンドボード" title="サウンドボード" data-popanchor onClick={(e) => setSb(sb ? null : e.currentTarget.getBoundingClientRect())}>
        <Icon name="music" size={22} />
      </button>
      <EmoteDockButton />
      <button className="dk" aria-label="音量" title="音量" data-popanchor onClick={(e) => setVol(vol ? null : e.currentTarget.getBoundingClientRect())}>
        <Icon name="volume" size={22} />
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
      <button className="dk leave" onClick={leaveSession} aria-label="切断" title="切断（セッション選択に戻る）"><Icon name="leave" size={22} /></button>
      {sb && <Soundboard anchor={sb} onClose={() => setSb(null)} />}
      {vol && <MasterVolume anchor={vol} onClose={() => setVol(null)} />}
    </div>
  );
}

/** ドックの上に出す、いまの状態のお知らせ */
function StatusChips() {
  const s = useStore(useShallow((st) => ({
    participants: st.participants,
    selfId: st.selfId,
    items: st.items,
    sync: st.sync,
    syncError: st.syncError,
    syncTransport: st.syncTransport,
    syncRtt: st.syncRtt,
    syncRoutes: st.syncRoutes,
    users: st.users,
    voice: st.voice,
    voiceError: st.voiceError,
    mode: st.mode,
    camFeeds: st.camFeeds,
    liveRequested: st.liveRequested,
  })));
  const me = s.participants.find((p) => p.id === s.selfId);
  const hammer = Object.values(s.items).find((i) => i.kind === 'hammer' && i.holder === s.selfId);
  const followers = s.participants.filter((p) => p.follow === s.selfId);
  const placedSelf = me?.mode === '2d' && !!me.pos && !me.follow;
  const chips: React.ReactNode[] = [];
  if (s.sync === 'connecting') chips.push(<span key="sync">セッションを同期中…</span>);
  if (s.sync === 'unavailable') chips.push(<span key="sync" title={s.syncError ?? ''}>同期に再接続しています{ s.syncError ? `（${s.syncError}）` : ''}</span>);
  if (s.sync === 'connected') chips.push(<span key="sync" title={`kokosync · ${s.syncTransport ?? ''} · 中継サーバーとのRTT（P2PのRTTは相手別表示）`}>同期 {s.syncRtt === null ? '接続済み' : `${s.syncRtt} ms`}{s.syncTransport === 'websocket' ? ' · 互換接続' : ''}</span>);
  if (s.sync === 'connected' && s.syncRoutes.length) {
    const direct = s.syncRoutes.filter((r) => r.route === 'direct').length;
    const detail = s.syncRoutes.map((r) => `${s.users.find((u) => u.id === r.user)?.name ?? r.user}: ${r.route === 'direct' ? 'P2P' : '中継'} · ${r.reason}${r.rttMs === null ? '' : ` · ${Math.round(r.rttMs)} ms`} · P2P送/受 ${r.sentDirect}/${r.receivedDirect} · 中継送/受 ${r.sentRelay}/${r.receivedRelay}`).join('\n');
    chips.push(<span key="routes" title={detail}>位置同期 P2P {direct}人 · 中継 {s.syncRoutes.length - direct}人</span>);
  }
  if (s.voice === 'connecting') chips.push(<span key="v">通話に接続中…</span>);
  if (s.voice === 'unavailable') chips.push(<span key="v" title={s.voiceError ?? ''}>通話・映像に接続できません{ s.voiceError ? `（${s.voiceError}）` : ''}</span>);
  if (s.mode === '2d' && hammer) chips.push(<span key="h">ピコピコハンマーを持っています · 人をクリックで叩く<button className="chipbtn" onClick={dropHammer}>手放す</button></span>);
  if (placedSelf) chips.push(<span key="p"><Icon name="pin" size={14} />3D 空間の中にいます<button className="chipbtn" onClick={() => place2d(s.selfId, null)}>スポーンに戻る</button></span>);
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

/** 3D 空間の読み込み中は、切り替え時と同じ画面で待たせる */
function View3DFallback() {
  const world = useStore((s) => sessionOf(s.session));
  return (
    <div className="switchload to3d" role="status" aria-live="polite">
      <div className="slbox">
        <HoppingMascots to="3d" />
        <b>{world?.name ?? ''} の 3D 空間に入っています…</b>
      </div>
    </div>
  );
}

function SwitchLoading() {
  const switching = useStore((s) => s.switching);
  const world = useStore((s) => sessionOf(s.session));
  if (!switching) return null;
  const to3d = switching.to === '3d';
  return (
    <div className={`switchload ${to3d ? 'to3d' : 'to2d'}`} role="status" aria-live="polite">
      <div className="slbox">
        <HoppingMascots to={switching.to} />
        <b>{to3d ? `${world?.name ?? ''} の 3D 空間に入っています…` : '2D に切り替えています…'}</b>
        <div className="slbar"><span style={{ animationDuration: `${switching.dur}ms` }} /></div>
      </div>
    </div>
  );
}

function ConfirmWorld() {
  const world = useStore((s) => s.confirmWorld);
  const [clear, setClear] = useState(false);
  if (!world) return null;
  const cancel = () => { set({ confirmWorld: null }); setClear(false); };
  const ok = () => { send({ t: 'world', world, clearItems: clear }); cancel(); };
  return (
    <div className="modalbg light" onClick={cancel}>
      <div role="alertdialog" aria-modal="true" aria-label="ワールドの切り替えの確認" className="confirm" onClick={(e) => e.stopPropagation()}>
        <h2>ワールドを「{WORLDS[world].name}」に切り替えますか？</h2>
        <span className="sub wrap">このセッションの全員の画面が {WORLD_COUNTDOWN_MS / 1000} 秒後に切り替わり、全員がスポーン地点に戻ります。</span>
        <label className="checkrow">
          <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
          <span>置いてあるアイテムをすべて片付ける</span>
        </label>
        <div className="row end">
          <button onClick={cancel}>キャンセル</button>
          <button className="dark" autoFocus onClick={ok}>切り替える</button>
        </div>
      </div>
    </div>
  );
}

/** 切り替わる前に全員の上部へ出すカウントダウン */
function WorldCountdown() {
  const p = useStore((s) => (s.worldPending?.sid === s.session ? s.worldPending : null));
  const [, tick] = useState(0);
  useEffect(() => {
    if (!p) return;
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [p]);
  if (!p) return null;
  const left = Math.max(1, Math.ceil((p.at - serverNow()) / 1000));
  return (
    <div className="worldcount" role="status" aria-live="assertive">
      <b className="wcnum" key={left}>{left}</b>
      <span>
        ワールドが「{WORLDS[p.world].name}」に切り替わります<span className="sub">（{nameOf(p.by)} が切り替え{p.clearItems ? '・アイテムは片付けられます' : ''}）</span>
      </span>
    </div>
  );
}

function WorldLoading() {
  const loading = useStore((s) => s.worldLoading);
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => set({ worldLoading: null }), loading.dur);
    return () => clearTimeout(t);
  }, [loading]);
  if (!loading || loading.dur <= 0) return null;
  return (
    <div className="switchload to3d" role="status" aria-live="polite">
      <div className="slbox">
        <HoppingMascots to="3d" />
        <b>「{WORLDS[loading.world].name}」を読み込んでいます…</b>
        <div className="slbar"><span style={{ animationDuration: `${loading.dur}ms` }} /></div>
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

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const mediaFiles = (list: FileList | undefined | null) => [...(list ?? [])].filter((f) => /^(image|video)\//.test(f.type));

/**
 * Ctrl+V・ドラッグ＆ドロップで画像・動画・YouTube を共有する。
 * 3D では目の前にアイテムとして出してチャットにも投稿、2D ではチャットに投稿するだけ
 */
function useMediaInput() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const asItem = () => get().mode === '3d';
    const onPaste = (e: ClipboardEvent) => {
      const files = mediaFiles(e.clipboardData?.files);
      if (files.length) { e.preventDefault(); void shareFiles(files, asItem()); return; }
      if (isTyping(e.target)) return;
      const id = youTubeId(e.clipboardData?.getData('text') ?? '');
      if (id) { e.preventDefault(); void shareYouTube(id, asItem()); }
    };
    const wanted = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list' || t === 'text/plain');
    const onEnter = (e: DragEvent) => { if (wanted(e)) { depth++; setDragging(true); } };
    const onLeave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const onOver = (e: DragEvent) => { if (wanted(e)) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!e.dataTransfer) return;
      const files = mediaFiles(e.dataTransfer.files);
      const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const id = youTubeId(text);
      if (!files.length && !id) return;
      e.preventDefault();
      if (files.length) void shareFiles(files, asItem());
      else if (id) void shareYouTube(id, asItem());
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return dragging;
}

function DropHint() {
  const mode = useStore((s) => s.mode);
  return (
    <div className="drophint" aria-hidden="true">
      <div>
        <Icon name="image" size={36} stroke={1.6} />
        <b>{mode === '3d' ? 'ドロップすると目の前にアイテムとして置きます' : 'ドロップするとチャットに投稿します'}</b>
        <span>画像 10MB・動画（MP4/WebM）50MB まで。YouTube のリンクも OK</span>
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => tick((n) => n + 1), 4000 - (Date.now() - toast.at) + 20);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || Date.now() - toast.at > 4000) return null;
  return <div className="toast" role="status">{toast.text}</div>;
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

const PHONE_TABS = [
  { id: 'screen', name: '画面', icon: 'window' },
  { id: 'list', name: 'プレイヤー', icon: 'people' },
  { id: 'log', name: '通知・ログ', icon: 'chat' },
] as const;

/** スマホ幅では前面のパネルを全面に 1 つずつ出し、下のタブで切り替える */
function PhoneTabs() {
  const tab = useStore((s) => s.phoneTab);
  const unread = useStore((s) => s.notices.filter((n) => n.unread).length);
  return (
    <nav className="phonetabs" aria-label="表示の切り替え">
      {PHONE_TABS.map((t) => (
        <button key={t.id} className={`ib ${tab === t.id ? 'on' : ''}`} aria-pressed={tab === t.id} onClick={() => set({ phoneTab: t.id })}>
          <Icon name={t.icon} size={20} />{t.name}
          {t.id === 'log' && unread > 0 && <span className="badge">{unread}</span>}
        </button>
      ))}
    </nav>
  );
}

export function WorldScreen() {
  useEffect(() => {
    window.addEventListener('pointerdown', unlockEmoteAudio);
    window.addEventListener('keydown', unlockEmoteAudio);
    return () => {
      window.removeEventListener('pointerdown', unlockEmoteAudio);
      window.removeEventListener('keydown', unlockEmoteAudio);
    };
  }, []);
  useOpenRequestedLive();
  const phone = usePhone();
  const phoneTab = useStore((s) => s.phoneTab);
  // スマホでは左右のパネルはたたまず、ウィンドウはカンタン表示だけ（保存はしない）
  useEffect(() => {
    if (phone) set((s) => ({ folded: { ...s.folded, left: false, right: false }, winMode: 'simple' }));
  }, [phone]);
  const dragging = useMediaInput();
  const mode = useStore((s) => s.mode);
  const worldKind = useStore((s) => worldKindOf(s));
  const locked = useStore((s) => s.locked);
  const folded = useStore((s) => s.folded);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (worldKind === 'survivors' && mode === '2d') openWindow('survivors');
    else if (worldKind !== 'survivors') {
      closeWindow('survivors', true);
      closeWindow('survivor-library', true);
    }
  }, [worldKind, mode]);
  useEffect(() => {
    if (mode !== '3d') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Tab' || isTyping(e.target)) return;
      e.preventDefault();
      if (e.repeat) return;
      set((s) => {
        const fold = !(s.folded.left && s.folded.right);
        const folded = { ...s.folded, left: fold, right: fold };
        save('tonarium.folded', folded);
        return { folded };
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode]);
  return (
    <div ref={root} className={`world ${mode} ${locked ? 'locked' : ''} ${folded.left ? 'fl' : ''} ${folded.right ? 'fr' : ''} ${phone ? `phone pt-${phoneTab}` : ''}`}>
      {mode === '3d' && (
        <Suspense fallback={<View3DFallback />}>
          <View3D />
        </Suspense>
      )}
      {mode === '2d' && <MapLayer />}
      <WindowLayer />
      <PortraitCanvas />
      <div className="front">
        {worldKind === 'survivors' && mode === '3d' && <SurvivorPanel overlay />}
        <WorldBadge />
        <NearList />
        <FaceStrip />
        <NoticeLog />
        <StatusChips />
        <Dock />
        {phone && <PhoneTabs />}
      </div>
      <MediaSync />
      <Toast />
      {dragging && <DropHint />}
      <SwitchLoading />
      <WorldLoading />
      <WorldCountdown />
      <ConfirmClose />
      <ConfirmWorld />
      <ConfirmOpen />
      <ProfileCard />
      <SessionMenu />
      <HitFxLayer root={root} />
    </div>
  );
}
