import { useEffect, useRef, useState } from 'react';
import { ROOM_HALF, NOTE_COLORS, type Note, type User } from '../../../shared/protocol.ts';
import { ITEM_INFO, type Item } from '../../../shared/items.ts';
import { useStore, get, set, colorOf, nameOf, heldHammer } from '../store.ts';
import { PANELS } from '../items/panels.ts';
import { PanelCanvas } from '../items/PanelCanvas.tsx';
import { ItemMenu } from '../items/ItemMenu.tsx';
import { dropHammer, hit, itemAction, removeItem } from '../items/actions.ts';
import { consumeHitFx, recentlyHit } from '../items/effects.ts';
import { ShareVideoHost } from '../ShareVideo.tsx';
import { createNote, deleteNote, leaveSession, selectNote, setMode, updateNote } from '../actions.ts';
import { toggleMic, toggleShare } from '../net/livekit.ts';
import { Avatar } from '../ui.tsx';

type StageTile =
  | { key: string; kind: 'stream' }
  | { key: string; kind: 'map' }
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
  useStore((s) => s.hits[p.id]);
  const canHit = iHold && !self;
  return (
    <div
      data-uid={p.id}
      className={`tile ${speaking ? 'speaking' : ''} ${recentlyHit(p.id) ? 'hit' : ''} ${canHit ? 'hittable' : ''}`}
      onClick={canHit ? () => hit(p.id) : undefined}
      title={canHit ? 'クリックで叩く' : undefined}
    >
      <Avatar id={p.id} name={p.name} size={64} />
      <div className="tilename">{micOff && '🔇 '}{p.name}</div>
      {p.mode === '3d' && <div className="tilemode">3D空間</div>}
      {holding && <div className="tilehammer" title="ピコピコハンマーを持っている">🔨</div>}
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
        {big && <span className="sub">付箋はドラッグで移動</span>}
        {big && <button className="small" onClick={() => toggleFocus('map')}>縮小</button>}
      </div>
      <div className="activitybody"><MiniMap bare /></div>
    </div>
  );
}

function StageTileView({ t, big }: { t: StageTile; big: boolean }) {
  if (t.kind === 'stream') return <StreamTile big={big} />;
  if (t.kind === 'map') return <MapTile big={big} />;
  if (t.kind === 'item') return <ActivityTile item={t.item} big={big} />;
  return <UserTile p={t.user} />;
}

/** 部屋にあるハンマーの一覧（拾う・手放す） */
function HammerBar() {
  const items = useStore((s) => s.items);
  const selfId = useStore((s) => s.selfId);
  useStore((s) => s.participants);
  const hammers = Object.values(items).flatMap((i) => (i.kind === 'hammer' ? [i] : []));
  if (!hammers.length) return null;
  const iHold = hammers.some((h) => h.holder === selfId);
  return (
    <div className="hammerbar">
      {hammers.map((h) => (
        <div key={h.id} className="hammerchip">
          🔨 {h.holder ? (h.holder === selfId ? '持っています — 相手のタイルをクリックで叩く' : `${nameOf(h.holder)} が持っている`) : '置いてある'}
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

function NoteCard({ note }: { note: Note }) {
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
        onChange={(e) => updateNote(note.id, { text: e.target.value })}
      />
      <div className="cardfoot">
        {NOTE_COLORS.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} onClick={() => updateNote(note.id, { color: c })} />
        ))}
        <div className="spacer" />
        <button className="small" onClick={() => deleteNote(note.id)}>削除</button>
      </div>
      <div className="meta">
        {lockedByOther ? `✏️ ${nameOf(note.editingBy)} が編集中` : `更新: ${nameOf(note.updatedBy)}`}
      </div>
    </div>
  );
}

function NoteBoard() {
  const notes = useStore((s) => s.notes);
  const [text, setText] = useState('');
  const add = () => {
    createNote(text.trim());
    setText('');
  };
  const list = Object.values(notes).sort((a, b) => a.updatedAt - b.updatedAt);
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
        {list.map((n) => <NoteCard key={n.id} note={n} />)}
      </div>
    </section>
  );
}

/** 3D空間を上から見た簡易マップ。付箋はドラッグで移動できる */
function MiniMap({ bare = false }: { bare?: boolean }) {
  const { avatars, notes, participants, speaking, selfId, sharer } = useStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; last: number } | null>(null);

  const toRoom = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, z: p.y };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const now = performance.now();
    if (now - drag.current.last < 60) return;
    drag.current.last = now;
    updateNote(drag.current.id, toRoom(e));
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    updateNote(drag.current.id, toRoom(e));
    drag.current = null;
  };
  const in2d = participants.filter((p) => p.mode === '2d');
  const in3d = participants.filter((p) => p.mode === '3d');
  const H = ROOM_HALF;

  return (
    <section className={bare ? 'map bare' : 'map'}>
      {!bare && <h3>3D空間のようす <small>（3D: {in3d.length}人 / 付箋はドラッグで移動）</small></h3>}
      <svg
        ref={svgRef} viewBox={`${-H - 0.5} ${-H - 0.5} ${2 * H + 1} ${2 * H + 1}`}
        onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      >
        <rect x={-H} y={-H} width={2 * H} height={2 * H} className="floor" />
        <line x1={-4} y1={-H + 0.2} x2={4} y2={-H + 0.2} className={`screen ${sharer ? 'live' : ''}`} />
        <text x={0} y={-H + 1.2} className="label" textAnchor="middle">スクリーン{sharer ? '（配信中）' : ''}</text>
        {Object.values(notes).map((n) => (
          <g
            key={n.id} transform={`translate(${n.x} ${n.z}) rotate(${(-n.ry * 180) / Math.PI})`}
            className="mapnote"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              drag.current = { id: n.id, last: 0 };
            }}
          >
            <rect x={-0.6} y={-0.15} width={1.2} height={0.3} fill={n.color} stroke={n.editingBy ? '#f43f5e' : '#555'} strokeWidth={0.06} />
            <text y={0.9} className="label" textAnchor="middle">{n.text.slice(0, 8) || '付箋'}</text>
          </g>
        ))}
        {Object.entries(avatars).map(([id, a]) => {
          const name = participants.find((p) => p.id === id)?.name;
          if (!name || id === selfId) return null;
          return (
            <g key={id} transform={`translate(${a.x} ${a.z})`}>
              {speaking[id] && <circle r={0.9} className="speakring" />}
              <circle r={0.5} fill={colorOf(id)} />
              <line x1={0} y1={0} x2={-Math.sin(a.ry) * 1} y2={-Math.cos(a.ry) * 1} stroke={colorOf(id)} strokeWidth={0.15} />
              <text y={-0.8} className="label" textAnchor="middle">{name}</text>
            </g>
          );
        })}
      </svg>
      <div className="twod">2Dで参加中: {in2d.map((p) => p.name).join('、') || 'なし'}</div>
    </section>
  );
}

export function SessionView() {
  const participants = useStore((s) => s.participants);
  const sharer = useStore((s) => s.sharer);
  const items = useStore((s) => s.items);
  const focus = useStore((s) => s.focus);
  const stageRef = useRef<HTMLDivElement>(null);
  const tiles: StageTile[] = [
    ...(sharer ? [{ key: 'stream', kind: 'stream' as const }] : []),
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
