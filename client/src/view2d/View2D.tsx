import { useEffect, useRef, useState } from 'react';
import { DOOR_HALF, ROOM_HALF, entranceSlot, type User } from '../../../shared/protocol.ts';
import { ITEM_INFO, NOTE_COLORS, type Item } from '../../../shared/items.ts';
import { useStore, get, set, colorOf, nameOf, heldHammer } from '../store.ts';
import { PANELS } from '../items/panels.ts';
import { PanelCanvas } from '../items/PanelCanvas.tsx';
import { ItemMenu } from '../items/ItemMenu.tsx';
import { dropHammer, editNote, hitAndMove, itemAction, moveItem, place2d, removeItem, spawnItem } from '../items/actions.ts';
import { consumeHitFx, recentlyHit } from '../items/effects.ts';
import { camHolder, camVideos } from '../net/livekit.ts';
import { ShareVideoHost } from '../ShareVideo.tsx';
import { follow, leaveSession, openView, selectNote, setMode } from '../actions.ts';
import { placesOf } from '../spatial.ts';
import { toggleMic, toggleShare } from '../net/livekit.ts';
import { Avatar } from '../ui.tsx';

type StageTile =
  | { key: string; kind: 'stream' }
  | { key: string; kind: 'map' }
  | { key: string; kind: 'cam'; item: Item & { kind: 'camera' } }
  | { key: string; kind: 'view'; user: User }
  | { key: string; kind: 'item'; item: Item }
  | { key: string; kind: 'user'; user: User };

const toggleFocus = (key: string) => set((s) => ({ focus: s.focus === key ? null : key }));

function StreamTile({ big }: { big: boolean }) {
  const sharer = useStore((s) => s.sharer);
  useStore((s) => s.participants); // 名前解決のため購読
  return (
    <div className={`tile streamtile ${big ? 'big' : ''}`} onClick={() => toggleFocus('stream')}>
      <ShareVideoHost className="videohost" />
      <div className="caption"><span className="livebadge">LIVE</span> {nameOf(sharer)} の画面</div>
    </div>
  );
}

/** 受信したカメラ配信の <video> をタイルの中に移して表示する */
function CamVideoHost({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const feed = useStore((s) => s.camFeeds[id]);
  useEffect(() => {
    const el = camVideos.get(id);
    if (!el || !ref.current) return;
    ref.current.appendChild(el);
    void el.play().catch(() => {});
    return () => { camHolder.appendChild(el); void el.play().catch(() => {}); };
  }, [id, feed]);
  return <div ref={ref} className="videohost" />;
}

/** フォロー中の人の視点 */
function ViewTile({ user, big }: { user: User; big: boolean }) {
  const key = `view:${user.id}`;
  return (
    <div className={`tile streamtile ${big ? 'big' : ''}`} onClick={() => toggleFocus(key)}>
      <CamVideoHost id={key} />
      <div className="caption">👀 {user.name} の視点（フォロー中）</div>
      <button className="small unfollow" onClick={(e) => { e.stopPropagation(); follow(null); }}>フォロー解除</button>
    </div>
  );
}

function CamTile({ item, big }: { item: Item & { kind: 'camera' }; big: boolean }) {
  useStore((s) => s.participants);
  return (
    <div className={`tile streamtile ${big ? 'big' : ''}`} onClick={() => toggleFocus(item.id)}>
      <CamVideoHost id={item.id} />
      <div className="caption"><span className="livebadge">LIVE</span> 📷 {nameOf(item.operator)} のカメラ</div>
    </div>
  );
}

function ActivityTile({ item, big }: { item: Item; big: boolean }) {
  const info = ITEM_INFO[item.kind];
  return (
    <div className={`tile activity ${big ? 'big' : ''}`} onClick={big ? undefined : () => toggleFocus(item.id)}>
      <div className="activityhdr">
        <span>{info.icon} {info.name}</span>
        <div className="spacer" />
        {big && <button className="small" onClick={() => removeItem(item.id)}>片付ける</button>}
        {big && <button className="small" onClick={() => toggleFocus(item.id)}>縮小</button>}
      </div>
      <div className="activitybody"><PanelCanvas item={item} interactive={big} /></div>
    </div>
  );
}

function UserTile({ p }: { p: User }) {
  const speaking = useStore((s) => !!s.speaking[p.id]);
  const micOff = useStore((s) => s.voice === 'connected' && s.micOn[p.id] === false);
  const holding = useStore((s) => Object.values(s.items).some((i) => i.kind === 'hammer' && i.holder === p.id));
  const iHold = useStore((s) => !!heldHammer(s));
  const self = useStore((s) => s.selfId === p.id);
  const me = useStore((s) => s.participants.find((u) => u.id === s.selfId));
  useStore((s) => s.hits[p.id]);
  const canHit = iHold && !self;
  const canFollow = !self && me?.mode === '2d' && p.mode === '3d';
  const following = me?.follow === p.id;
  const followers = useStore((s) => s.participants.filter((u) => u.follow === p.id).length);
  return (
    <div
      data-uid={p.id}
      className={`tile ${speaking ? 'speaking' : ''} ${recentlyHit(p.id) ? 'hit' : ''} ${canHit ? 'hittable' : ''}`}
      onClick={canHit ? () => hitAndMove(p.id) : undefined}
      title={canHit ? 'クリックで叩く' : undefined}
    >
      <Avatar id={p.id} name={p.name} size={64} />
      <div className="tilename">{micOff && '🔇 '}{p.name}</div>
      {p.mode === '3d' && <div className="tilemode">3D空間</div>}
      {holding && <div className="tilehammer" title="ピコピコハンマーを持っている">🔨</div>}
      {followers > 0 && <div className="tilefollowers" title="フォローしている人数">👀 {followers}</div>}
      {canFollow && (
        <button
          className={`small followbtn ${following ? 'on' : ''}`}
          onClick={(e) => { e.stopPropagation(); follow(following ? null : p.id); }}
        >{following ? 'フォロー中' : '👀 フォロー'}</button>
      )}
    </div>
  );
}

/** 3D空間を上から見たマップ。2D からも空間のようすが分かるように、ステージに常に置く */
function MapTile({ big }: { big: boolean }) {
  const n3d = useStore((s) => s.participants.filter((p) => p.mode === '3d').length);
  return (
    <div className={`tile activity maptile ${big ? 'big' : ''}`} onClick={big ? undefined : () => toggleFocus('map')}>
      <div className="activityhdr">
        <span>🧊 3D空間のようす（{n3d}人）</span>
        <div className="spacer" />
        {big && <span className="sub">アイテムはドラッグで移動</span>}
        {big && <button className="small" onClick={() => toggleFocus('map')}>縮小</button>}
      </div>
      <div className="activitybody"><MiniMap bare /></div>
    </div>
  );
}

function StageTileView({ t, big }: { t: StageTile; big: boolean }) {
  if (t.kind === 'stream') return <StreamTile big={big} />;
  if (t.kind === 'map') return <MapTile big={big} />;
  if (t.kind === 'cam') return <CamTile item={t.item} big={big} />;
  if (t.kind === 'view') return <ViewTile user={t.user} big={big} />;
  if (t.kind === 'item') return <ActivityTile item={t.item} big={big} />;
  return <UserTile p={t.user} />;
}

/** 部屋にあるハンマーの一覧（拾う・手放す）と、自分の 3D 空間での居場所 */
function HammerBar() {
  const items = useStore((s) => s.items);
  const selfId = useStore((s) => s.selfId);
  const participants = useStore((s) => s.participants);
  const me = participants.find((p) => p.id === selfId);
  const hammers = Object.values(items).flatMap((i) => (i.kind === 'hammer' ? [i] : []));
  const placedSelf = me?.mode === '2d' && !!me.pos && !me.follow;
  if (!hammers.length && !placedSelf) return null;
  const iHold = hammers.some((h) => h.holder === selfId);
  return (
    <div className="hammerbar">
      {placedSelf && (
        <div className="hammerchip">
          📍 3D空間の中にいます
          <button className="small" onClick={() => place2d(selfId, null)}>入口に戻る</button>
        </div>
      )}
      {hammers.map((h) => (
        <div key={h.id} className="hammerchip">
          🔨 {h.holder ? (h.holder === selfId ? '持っています — 相手のタイルやマップの人をクリックで叩く' : `${nameOf(h.holder)} が持っている`) : '置いてある'}
          {h.holder === null && !iHold && <button className="small" onClick={() => itemAction(h.id, { a: 'pick' })}>拾う</button>}
          {h.holder === selfId && <button className="small" onClick={dropHammer}>手放す</button>}
          {h.holder === null && <button className="small" onClick={() => removeItem(h.id)}>片付ける</button>}
        </div>
      ))}
    </div>
  );
}

/** 叩いたときにハンマーが相手のタイルへ飛んでいく演出 */
function HitFxLayer({ stage }: { stage: React.RefObject<HTMLDivElement | null> }) {
  const fx = useStore((s) => s.hitFx);
  return (
    <>
      {fx.map((f) => {
        const root = stage.current;
        const a = root?.querySelector(`[data-uid="${f.from}"]`)?.getBoundingClientRect();
        const b = root?.querySelector(`[data-uid="${f.to}"]`)?.getBoundingClientRect();
        if (!root || !b) { queueMicrotask(() => consumeHitFx(f.key)); return null; }
        const base = root.getBoundingClientRect();
        const to = { x: b.left + b.width / 2 - base.left, y: b.top + b.height / 2 - base.top };
        const from = a ? { x: a.left + a.width / 2 - base.left, y: a.top + a.height / 2 - base.top } : { x: to.x, y: to.y - 120 };
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

function ControlBar() {
  const { voice, micEnabled, sharer, selfId } = useStore();
  const ok = voice === 'connected';
  const sharingSelf = sharer === selfId;
  return (
    <div className="controlbar">
      <button className={`round ${micEnabled ? '' : 'off'}`} onClick={toggleMic} title="マイク">
        {micEnabled ? '🎙' : '🔇'}
      </button>
      <button
        className={`round ${sharingSelf ? 'on' : ''}`} disabled={!ok || (!!sharer && !sharingSelf)}
        onClick={toggleShare} title={sharingSelf ? '配信を停止' : '画面を配信'}
      >🖥</button>
      <ItemMenu up />
      <button className="round enter3d" onClick={() => setMode('3d')}>🧊 3D空間に入る</button>
      <button className="round hangup" onClick={leaveSession} title="切断">📞</button>
    </div>
  );
}

type NoteItem = Item & { kind: 'note' };

function NoteCard({ note }: { note: NoteItem }) {
  const selfId = useStore((s) => s.selfId);
  const selected = useStore((s) => s.selectedNote === note.id);
  useStore((s) => s.participants);
  const lockedByOther = note.editingBy && note.editingBy !== selfId;
  return (
    <div className={`card ${selected ? 'selected' : ''}`} style={{ background: note.color }}>
      <textarea
        value={note.text}
        placeholder="（空の付箋）"
        onFocus={() => selectNote(note.id)}
        onBlur={() => selectNote(null)}
        onChange={(e) => editNote(note.id, { text: e.target.value })}
      />
      <div className="cardfoot">
        {NOTE_COLORS.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} onClick={() => editNote(note.id, { color: c })} />
        ))}
        <div className="spacer" />
        <button className="small" onClick={() => removeItem(note.id)}>片付ける</button>
      </div>
      <div className="meta">
        {lockedByOther ? `✏️ ${nameOf(note.editingBy)} が編集中` : `更新: ${nameOf(note.updatedBy)}`}
      </div>
    </div>
  );
}

function NoteBoard() {
  const items = useStore((s) => s.items);
  const [text, setText] = useState('');
  const add = () => {
    spawnItem('note', text.trim());
    setText('');
  };
  const notes = Object.values(items).flatMap((i) => (i.kind === 'note' ? [i] : []));
  return (
    <section className="board">
      <div className="addnote">
        <input
          placeholder="付箋に書く内容" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
        />
        <button className="primary" onClick={add}>付箋を追加</button>
      </div>
      <div className="cards">
        {notes.map((n) => <NoteCard key={n.id} note={n} />)}
      </div>
    </section>
  );
}

/** マップ上のアイテムの描き方 */
function MapItem({ item }: { item: Item }) {
  if (item.kind === 'note') {
    return (
      <>
        <rect x={-0.8} y={-0.15} width={1.6} height={0.3} fill={item.color} stroke={item.editingBy ? '#f43f5e' : '#555'} strokeWidth={0.06} />
        <text y={0.9} className="label" textAnchor="middle" transform={`rotate(${(item.ry * 180) / Math.PI})`}>{item.text.slice(0, 8) || '付箋'}</text>
      </>
    );
  }
  if (item.kind === 'chess') {
    return (
      <>
        <rect x={-0.95} y={-0.95} width={1.9} height={1.9} fill="#b58863" stroke="#5b3a1e" strokeWidth={0.08} />
        <text y={0.35} className="mapicon" textAnchor="middle">♟</text>
      </>
    );
  }
  const info = ITEM_INFO[item.kind];
  return (
    <>
      <circle r={0.55} className="mapitembg" />
      <text y={0.32} className="mapicon" textAnchor="middle">{info.icon}</text>
    </>
  );
}

/** マップでアイテムにマウスを乗せたときの操作 */
function MapTip({ item, onClose }: { item: Item; onClose: () => void }) {
  const iHold = useStore((s) => !!heldHammer(s));
  const feed = useStore((s) => s.camFeeds[item.id]);
  const info = ITEM_INFO[item.kind];
  const focusItem = (key: string) => { set({ focus: key }); openView('session'); onClose(); };
  return (
    <>
      <div className="maptiphdr">{info.icon} {info.name}</div>
      {PANELS[item.kind] && (
        <>
          <div className="maptippreview"><PanelCanvas item={item} interactive={false} /></div>
          <button className="small primary" onClick={() => focusItem(item.id)}>フォーカス</button>
        </>
      )}
      {item.kind === 'hammer' && (
        iHold
          ? <div className="sub">すでにハンマーを持っています</div>
          : <button className="small primary" onClick={() => { itemAction(item.id, { a: 'pick' }); onClose(); }}>持つ</button>
      )}
      {item.kind === 'note' && (
        <>
          <div className="maptipnote" style={{ background: item.color }}>{item.text || '（空の付箋）'}</div>
          <button className="small primary" onClick={() => { openView('board'); onClose(); }}>付箋ボードで開く</button>
        </>
      )}
      {item.kind === 'camera' && (
        item.live && feed
          ? <button className="small primary" onClick={() => focusItem(item.id)}>配信を見る</button>
          : <div className="sub">3D空間でのみ使えます</div>
      )}
    </>
  );
}

/** 3D空間を上から見たマップ。アイテムはドラッグで移動、自分（2D）もドラッグで動ける */
function MiniMap({ bare = false }: { bare?: boolean }) {
  const { avatars, items, participants, speaking, selfId, sharer } = useStore();
  useStore((s) => s.hits);
  const hammer = useStore((s) => !!heldHammer(s));
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const drag = useRef<{ kind: 'item' | 'self'; id: string; ry: number; last: number; x0: number; z0: number; moved: boolean } | null>(null);
  const [tip, setTip] = useState<{ id: string; left: number; top: number } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const toRoom = (e: React.PointerEvent, self = false) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const L = ROOM_HALF - 0.5;
    // 2D の自分は入口の外の控えにも置ける
    return { x: Math.max(-L, Math.min(L, p.x)), z: Math.max(-L, Math.min(self ? ROOM_HALF + 2.8 : L, p.y)) };
  };
  const sendDrag = (e: React.PointerEvent) => {
    const d = drag.current!;
    const p = toRoom(e, d.kind === 'self');
    if (!d.moved && Math.hypot(p.x - d.x0, p.z - d.z0) < 0.3) return;
    d.moved = true;
    if (d.kind === 'self') place2d(selfId, { x: p.x, z: p.z, ry: d.ry });
    else moveItem(d.id, p.x, p.z, d.ry);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    if (now - d.last < 60) return;
    d.last = now;
    sendDrag(e);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    sendDrag(e);
    drag.current = null;
  };
  const startDrag = (e: React.PointerEvent, kind: 'item' | 'self', id: string, ry: number) => {
    if (hammer && kind === 'self') return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = toRoom(e, kind === 'self');
    drag.current = { kind, id, ry, last: 0, x0: p.x, z0: p.z, moved: false };
    setTip(null);
  };
  const showTip = (e: React.MouseEvent, id: string) => {
    if (drag.current || !boxRef.current) return;
    window.clearTimeout(hideTimer.current);
    // マップの枠ではみ出さないよう、画面に対する位置で出す
    const r = (e.currentTarget as Element).getBoundingClientRect();
    setTip({ id, left: Math.min(window.innerWidth - 120, Math.max(120, r.left + r.width / 2)), top: r.bottom + 4 });
  };
  const hideTip = () => { hideTimer.current = window.setTimeout(() => setTip(null), 200); };
  // ハンマーを持っている間は、マップ上の人をクリックすると叩いて、その人の前に移る
  const hitProps = (id: string) => (hammer && id !== selfId ? {
    onClick: () => hitAndMove(id),
    className: 'hittable',
  } : {});

  const in2d = participants.filter((p) => p.mode === '2d');
  const in3d = participants.filter((p) => p.mode === '3d');
  const H = ROOM_HALF;
  // 誰かが持っているハンマー・カメラはその人と一緒に表示するので、置かれている物だけ描く
  const placed = Object.values(items).filter((i) => !('holder' in i && i.holder));
  const holding = (id: string) => Object.values(items).some((i) => i.kind === 'hammer' && i.holder === id);
  const holdingCam = (id: string) => Object.values(items).some((i) => i.kind === 'camera' && i.holder === id);
  const H2 = H + 3.6;
  const places = placesOf();
  const tipItem = tip ? items[tip.id] : undefined;

  return (
    <section ref={boxRef} className={`${bare ? 'map bare' : 'map'} ${hammer ? 'hammering' : ''}`}>
      {!bare && <h3>3D空間のようす <small>（3D: {in3d.length}人 / アイテムと自分はドラッグで移動）</small></h3>}
      <svg
        ref={svgRef} viewBox={`${-H - 0.5} ${-H - 0.5} ${2 * H + 1} ${H + H2 + 1}`}
        onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      >
        <rect x={-H} y={-H} width={2 * H} height={2 * H} className="floor" />
        <rect x={-DOOR_HALF - 0.8} y={H} width={2 * DOOR_HALF + 1.6} height={3.2} className="hall" />
        <line x1={-DOOR_HALF} y1={H} x2={DOOR_HALF} y2={H} className="door" />
        <text x={DOOR_HALF + 1.1} y={H + 1} className="label">入口</text>
        <line x1={-4} y1={-H + 0.2} x2={4} y2={-H + 0.2} className={`screen ${sharer ? 'live' : ''}`} />
        <text x={0} y={-H + 1.2} className="label" textAnchor="middle">スクリーン{sharer ? '（配信中）' : ''}</text>
        {placed.map((it) => (
          <g
            key={it.id} transform={`translate(${it.x} ${it.z}) rotate(${(-it.ry * 180) / Math.PI})`}
            className="mapitem"
            onPointerDown={(e) => startDrag(e, 'item', it.id, it.ry)}
            onMouseEnter={(e) => showTip(e, it.id)}
            onMouseLeave={hideTip}
          >
            <MapItem item={it} />
          </g>
        ))}
        {Object.entries(avatars).map(([id, a]) => {
          const name = participants.find((p) => p.id === id)?.name;
          if (!name || id === selfId) return null;
          const hp = hitProps(id);
          return (
            <g key={id} transform={`translate(${a.x} ${a.z})`} className={`${recentlyHit(id) ? 'maphit' : ''} ${hp.className ?? ''}`} onClick={hp.onClick}>
              {speaking[id] && <circle r={0.9} className="speakring" />}
              <circle r={0.5} fill={colorOf(id)} />
              <line x1={0} y1={0} x2={-Math.sin(a.ry) * 1} y2={-Math.cos(a.ry) * 1} stroke={colorOf(id)} strokeWidth={0.15} />
              <text y={-0.8} className="label" textAnchor="middle">{name}{holding(id) ? ' 🔨' : ''}{holdingCam(id) ? ' 📷' : ''}</text>
            </g>
          );
        })}
        {/* 2D の人: 入口の列・置かれた場所・フォロー先の後ろ（3D でも同じ位置に立っている） */}
        {in2d.map((p) => {
          const s = places.get(p.id) ?? { ...entranceSlot(0), ry: 0, small: false };
          const self = p.id === selfId;
          const hp = hitProps(p.id);
          return (
            <g
              key={p.id} transform={`translate(${s.x} ${s.z}) scale(${s.small ? 0.6 : 1})`}
              className={`${recentlyHit(p.id) ? 'maphit' : ''} ${self && !hammer ? 'mapself' : ''} ${hp.className ?? ''}`}
              onClick={hp.onClick}
              onPointerDown={self ? (e) => startDrag(e, 'self', p.id, s.ry) : undefined}
            >
              {speaking[p.id] && <circle r={0.55} className="speakring" />}
              {self && <rect x={-0.42} y={-0.42} width={0.84} height={0.84} rx={0.16} className="selfring" />}
              <rect x={-0.3} y={-0.3} width={0.6} height={0.6} rx={0.1} fill={colorOf(p.id)} />
              <text y={0.95} className="label small" textAnchor="middle">{p.name}{self ? '(自分)' : ''}{holding(p.id) ? '🔨' : ''}</text>
            </g>
          );
        })}
      </svg>
      {tip && tipItem && (
        <div
          className="maptip" style={{ left: tip.left, top: tip.top }}
          onMouseEnter={() => window.clearTimeout(hideTimer.current)} onMouseLeave={hideTip}
        >
          <MapTip item={tipItem} onClose={() => setTip(null)} />
        </div>
      )}
      <div className="twod">2Dで参加中: {in2d.map((p) => p.name).join('、') || 'なし'}{hammer && ' ・ 🔨 人をクリックで叩いてその前に移動'}</div>
    </section>
  );
}

export function SessionView() {
  const participants = useStore((s) => s.participants);
  const sharer = useStore((s) => s.sharer);
  const items = useStore((s) => s.items);
  const focus = useStore((s) => s.focus);
  const camFeeds = useStore((s) => s.camFeeds);
  const selfId = useStore((s) => s.selfId);
  const stageRef = useRef<HTMLDivElement>(null);
  const tiles: StageTile[] = [
    ...(sharer ? [{ key: 'stream', kind: 'stream' as const }] : []),
    // フォロー中の人の視点
    ...participants.flatMap((u) => {
      const me = participants.find((x) => x.id === selfId);
      return me?.follow === u.id && camFeeds[`view:${u.id}`] ? [{ key: `view:${u.id}`, kind: 'view' as const, user: u }] : [];
    }),
    // 届いているカメラ配信は画面共有と同じようにタイルで並べる
    ...Object.values(items).flatMap((i) => (i.kind === 'camera' && i.live && camFeeds[i.id] ? [{ key: i.id, kind: 'cam' as const, item: i }] : [])),
    { key: 'map', kind: 'map' as const },
    ...Object.values(items).filter((i) => PANELS[i.kind]).map((item) => ({ key: item.id, kind: 'item' as const, item })),
    ...participants.map((user) => ({ key: user.id, kind: 'user' as const, user })),
  ];
  const focused = tiles.find((t) => t.key === focus && t.kind !== 'user');
  const focusedItem = focused?.kind === 'item' ? focused.item : null;

  // 拡大中のアクティビティにキー操作を渡す（2048 の矢印キーなど）
  useEffect(() => {
    if (!focusedItem) return;
    const panel = PANELS[focusedItem.kind];
    const id = focusedItem.id;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const item = get().items[id];
      if (item && panel?.key?.(e.key, item)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedItem?.id, focusedItem?.kind]);

  return (
    <div className="session">
      <div className="stage" ref={stageRef}>
        {focused ? (
          <>
            <div className="focusarea"><StageTileView t={focused} big /></div>
            <div className="tilerow">
              {tiles.filter((t) => t !== focused).map((t) => <StageTileView key={t.key} t={t} big={false} />)}
            </div>
          </>
        ) : (
          <div className="tiles">{tiles.map((t) => <StageTileView key={t.key} t={t} big={false} />)}</div>
        )}
        <HammerBar />
        <ControlBar />
        <HitFxLayer stage={stageRef} />
      </div>
    </div>
  );
}

export function BoardView() {
  return (
    <div className="boardview">
      <NoteBoard />
      <MiniMap />
    </div>
  );
}
