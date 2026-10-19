import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ITEM_INFO, NOTE_COLORS, type Item } from '../../../shared/items.ts';
import { useStore, get, nameOf, type Win } from '../store.ts';
import { PANELS } from '../items/panels.ts';
import { PanelCanvas } from '../items/PanelCanvas.tsx';
import { editNote, removeItem } from '../items/actions.ts';
import { camHolder, camVideos } from '../net/livekit.ts';
import { ShareVideoHost } from '../ShareVideo.tsx';
import { follow, selectNote } from '../actions.ts';
import { distanceTo, formatDistance, placesOf } from '../spatial.ts';
import { Icon } from './Icon.tsx';
import { ItemMark, Viewers, itemLabel } from './common.tsx';
import { closeWindow, moveWindow, raiseWindow, toggleMax } from './windows.ts';

const BAR = 40;
type Kind = 'video' | 'panel' | 'note';
interface Resolved { kind: Kind; dark: boolean; title: string; sub: string; item?: Item; body: React.ReactNode; aspect?: number; width: number }

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

function NoteBody({ note }: { note: Item & { kind: 'note' } }) {
  const selfId = useStore((s) => s.selfId);
  useStore((s) => s.participants);
  const lockedByOther = note.editingBy && note.editingBy !== selfId;
  return (
    <div className="notebody" style={{ background: note.color }}>
      <textarea
        value={note.text} placeholder="付箋に書く" aria-label="付箋の内容"
        onFocus={() => selectNote(note.id)} onBlur={() => selectNote(null)}
        onChange={(e) => editNote(note.id, { text: e.target.value })}
      />
      <div className="notefoot">
        {NOTE_COLORS.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} aria-label="色を変える" onClick={() => editNote(note.id, { color: c })} />
        ))}
        <span className="spacer" />
        <span className="sub">{lockedByOther ? `${nameOf(note.editingBy)} が編集中` : `更新: ${nameOf(note.updatedBy)}`}</span>
      </div>
    </div>
  );
}

/** 開けなくなったもの（アイテムが片付けられた、配信が終わった等）は null */
function useResolved(key: string, compact: boolean): Resolved | null {
  const s = useStore();
  const at = (id: string) => formatDistance(distanceTo(id, s));
  if (key === 'share') {
    if (!s.sharer) return null;
    return { kind: 'video', dark: true, title: `${nameOf(s.sharer)} の画面共有`, sub: at(s.sharer), body: <ShareVideoHost className="videohost" />, width: 780, aspect: 16 / 9 };
  }
  if (key.startsWith('view:')) {
    const uid = key.slice(5);
    if (!s.camFeeds[key]) return null;
    return {
      kind: 'video', dark: true, title: `${nameOf(uid)} の視点`, sub: 'ついていく中', width: 480, aspect: 16 / 9,
      body: (
        <>
          <CamVideoHost id={key} />
          <button className="onvideo" onClick={() => { follow(null); closeWindow(key); }}>ついていくのをやめる</button>
        </>
      ),
    };
  }
  const id = key.slice(key.indexOf(':') + 1);
  const item = s.items[id];
  if (!item) return null;
  const sub = `${item.createdBy === s.selfId ? 'あなた' : nameOf(item.createdBy)} が出した · ${formatDistance(itemDistance(item, s))}`;
  if (key.startsWith('cam:')) {
    if (item.kind !== 'camera' || !item.live || !s.camFeeds[id]) return null;
    return {
      kind: 'video', dark: true, item, title: `${ITEM_INFO.camera.name} — ${nameOf(item.operator)} のライブ`, sub, width: 480, aspect: 16 / 9,
      body: <><CamVideoHost id={id} /><span className="onlive"><i />LIVE</span></>,
    };
  }
  if (item.kind === 'note') return { kind: 'note', dark: false, item, title: itemLabel(item), sub, width: 320, body: <NoteBody note={item} /> };
  const panel = PANELS[item.kind];
  if (!panel) return null;
  return { kind: 'panel', dark: false, item, title: ITEM_INFO[item.kind].name, sub, width: item.kind === 'g2048' ? 320 : 460, aspect: panel.w / panel.h, body: <PanelCanvas item={item} interactive={!compact} /> };
}

function itemDistance(item: Item, s = get()) {
  const holder = 'holder' in item ? item.holder : null;
  if (holder) return distanceTo(holder, s);
  const me = placesOf(s).get(s.selfId);
  return me ? Math.hypot(item.x - me.x, item.z - me.z) : Infinity;
}

/** compact はカンタンモードで下に並ぶ小さいウィンドウ。押すと大きい方と入れ替わる */
function WindowFrame({ win, region, simple, z, compact = false }: {
  win: Win; region: { w: number; h: number }; simple: boolean; z: number; compact?: boolean;
}) {
  const r = useResolved(win.key, compact);
  const maxWin = useStore((s) => s.maxWin);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const gone = !r;
  useEffect(() => { if (gone) closeWindow(win.key); }, [gone, win.key]);
  if (!r) return null;
  const max = maxWin === win.key;
  const createdBy = r.item ? { id: r.item.createdBy, name: nameOf(r.item.createdBy) } : undefined;

  // カンタンモードは使える範囲いっぱいに、フリーモードは既定の幅で置く
  let width = r.width;
  let height: number | undefined;
  if (compact) { width = 180; height = 112; }
  else if (max) { width = window.innerWidth; height = window.innerHeight; }
  else if (simple) {
    if (r.aspect) {
      width = Math.min(region.w, (region.h - BAR) * r.aspect);
      height = width / r.aspect + BAR;
    } else width = Math.min(region.w, 420);
  } else if (r.aspect && r.kind === 'video') height = width / r.aspect + BAR;

  const style: React.CSSProperties = max && !compact
    ? { position: 'fixed', left: 0, top: 0, width, height, zIndex: 44 }
    : simple ? { width, height } : { position: 'absolute', left: win.x, top: win.y, width, height, zIndex: z };

  const onDown = (e: React.PointerEvent) => {
    raiseWindow(win.key);
    if (simple || max || (e.target as Element).closest('button')) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: win.x, oy: win.y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成イベントなど */ }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    moveWindow(win.key, Math.max(-200, Math.min(window.innerWidth - 120, d.ox + e.clientX - d.sx)), Math.max(0, Math.min(window.innerHeight - BAR, d.oy + e.clientY - d.sy)));
  };
  const onUp = () => { drag.current = null; };

  // 最大化したウィンドウは前面のパネルより上に出す（ウィンドウ層の中だと重なり順で負ける）
  const frame = (
    <section
      className={`win ${r.dark ? 'dark' : ''} k-${r.kind} ${compact ? 'compact' : ''}`} style={style} aria-label={r.title}
      title={compact ? 'クリックで大きく表示' : undefined} onPointerDown={() => raiseWindow(win.key)}
    >
      <div
        className={`winbar ${simple || max ? '' : 'draggable'}`} title={simple || max ? undefined : 'ドラッグで移動'}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      >
        {r.item ? <ItemMark item={r.item} size={compact ? 18 : 26} by={compact ? undefined : createdBy} /> : <span className="livedot" />}
        <span className="wtitle"><b>{r.title}</b><span>{r.sub}</span></span>
        <span className="spacer" />
        {compact
          ? <button className="ib wbtn" onClick={(e) => { e.stopPropagation(); closeWindow(win.key); }} aria-label="消す"><Icon name="close" size={12} /></button>
          : <WinButtons win={win} r={r} max={max} />}
      </div>
      <div className="winbody">{r.body}</div>
    </section>
  );
  return max && !compact ? createPortal(frame, document.body) : frame;
}

function WinButtons({ win, r, max }: { win: Win; r: Resolved; max: boolean }) {
  return (
    <>
        <Viewers keyName={win.key} dark={r.dark} />
        {r.item && r.kind !== 'video' && (
          <button className="ib wbtn" aria-label="しまう" title="アイテムをしまう" onClick={() => removeItem(r.item!.id)}><Icon name="trash" size={14} /></button>
        )}
        <button className="ib wbtn" onClick={() => toggleMax(win.key)} aria-label={max ? '元のサイズに戻す' : '拡大（画面全体に表示）'}><Icon name="maximize" size={14} /></button>
        <button className="ib wbtn" onClick={() => closeWindow(win.key)} aria-label="消す"><Icon name="close" size={14} /></button>
    </>
  );
}

/** 背面のウィンドウ。2D では画面共有が始まったら自動で開く */
export function WindowLayer() {
  const windows = useStore((s) => s.windows);
  const winMode = useStore((s) => s.winMode);
  const mode = useStore((s) => s.mode);
  const ref = useRef<HTMLDivElement>(null);
  const [region, setRegion] = useState({ w: 800, h: 500 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRegion({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [winMode]);

  const front = windows[windows.length - 1];
  const frontItem = front?.key.startsWith('item:') ? get().items[front.key.slice(5)] : undefined;
  useEffect(() => {
    const panel = frontItem ? PANELS[frontItem.kind] : undefined;
    if (!frontItem || !panel?.key) return;
    const id = frontItem.id;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const item = get().items[id];
      if (item && panel.key?.(e.key, item)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frontItem?.id, frontItem?.kind]);

  const simple = winMode === 'simple';
  return (
    <>
      <div className={`winregion ${simple ? 'simple' : ''} ${mode}`}>
        {simple && (
          <>
            <div ref={ref} className="winstage">
              {front && <WindowFrame key={front.key} win={front} region={region} simple z={1} />}
            </div>
            {windows.length > 1 && (
              <div className="winstrip">
                {windows.slice(0, -1).map((w) => <WindowFrame key={w.key} win={w} region={region} simple z={1} compact />)}
              </div>
            )}
          </>
        )}
      </div>
      {!simple && (
        <div className="winfree">
          {windows.map((w, i) => <WindowFrame key={w.key} win={w} region={region} simple={false} z={i + 1} />)}
        </div>
      )}
    </>
  );
}
