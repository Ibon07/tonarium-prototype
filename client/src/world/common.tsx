import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessage, User } from '../../../shared/protocol.ts';
import { ITEM_INFO, type Item } from '../../../shared/items.ts';
import { NEAR_RANGE, VOICE_RANGE } from '../../../shared/places.ts';
import { useStore, set, colorOf, heldHammer } from '../store.ts';
import { iconUrl } from '../icon.ts';
import { useNearby, useNearbyItems } from '../spatial.ts';

/** アイコンがあれば画像、無ければ頭文字 */
export function Face({ id, name, size = 32, ring }: { id: string; name: string; size?: number; ring?: string }) {
  const icon = useStore((s) => s.users.find((u) => u.id === id)?.icon);
  const style: React.CSSProperties = { width: size, height: size, background: colorOf(id), fontSize: size * 0.44, boxShadow: ring };
  if (icon) return <img className="face" style={style} src={iconUrl(name, icon)} alt="" />;
  return <span className="face" style={style}>{name.slice(0, 1)}</span>;
}

export function ItemMark({ item, size = 32, by }: { item: Item; size?: number; by?: { id: string; name: string } }) {
  const info = ITEM_INFO[item.kind];
  return (
    <span
      className="itemmark"
      style={{ width: size, height: size, background: info.tint, color: info.ink, fontSize: info.mark.length > 2 ? size * 0.3 : size * 0.44, borderRadius: size * 0.3 }}
    >
      {info.mark}
      {by && <span className="byface" style={{ background: colorOf(by.id) }}>{by.name.slice(0, 1)}</span>}
    </span>
  );
}

export const Badge3D = () => <span className="b3d" title="3D モードで参加中">3D</span>;

export function Viewers({ keyName, dark = false }: { keyName: string; dark?: boolean }) {
  const viewers = useStore((s) => s.participants).filter((u) => u.viewing.includes(keyName));
  if (!viewers.length) return null;
  const shown = viewers.slice(0, 3);
  return (
    <span className={`viewers ${dark ? 'dark' : ''}`} title={`閲覧中：${viewers.map((v) => v.name).join('、')}`} aria-label={`閲覧中 ${viewers.length}人`}>
      <span className="vlabel">閲覧中</span>
      {shown.map((v) => <Face key={v.id} id={v.id} name={v.name} size={22} />)}
      {viewers.length > 3 && <span className="vmore">+{viewers.length - 3}</span>}
    </span>
  );
}

export type Band = 'near' | 'mid' | 'far';
export const bandOf = (d: number): Band => (d <= NEAR_RANGE ? 'near' : d <= VOICE_RANGE ? 'mid' : 'far');
export const BANDS: { band: Band; label: string; range: string; dot: string }[] = [
  { band: 'near', label: 'すぐそば', range: `〜${NEAR_RANGE}m`, dot: '#2E9A64' },
  { band: 'mid', label: '声が届く', range: `〜${VOICE_RANGE}m`, dot: '#D9A02B' },
  { band: 'far', label: 'とおく', range: `${VOICE_RANGE}m〜`, dot: '#9A98A2' },
];

/** trend は -1（近づいている）〜 1（離れていく） */
export interface PlayerEntry { user: User; d: number; band: Band; child: boolean; trend: number }

// 距離の変化の速さ（m/秒）をならしたもの。止まると 0 に戻っていく
const motion = new Map<string, { d: number; t: number; v: number }>();
function trendOf(id: string, d: number) {
  const now = performance.now();
  const m = motion.get(id);
  if (!m || !Number.isFinite(d) || !Number.isFinite(m.d)) { motion.set(id, { d, t: now, v: 0 }); return 0; }
  const dt = (now - m.t) / 1000;
  if (dt > 0.05) {
    const v = Math.max(-4, Math.min(4, (d - m.d) / dt));
    m.v = m.v * 0.6 + v * 0.4;
    m.d = d;
    m.t = now;
  }
  return Math.abs(m.v) < 0.15 ? 0 : Math.max(-1, Math.min(1, m.v / 1.5));
}

/** 自分以外を近い順に。ついていっている人は相手の直後にぶら下げる */
export function usePlayers(): PlayerEntry[] {
  const list = useNearby();
  const selfId = useStore((s) => s.selfId);
  const others = list.filter((x) => x.user.id !== selfId);
  const ids = new Set(others.map((x) => x.user.id));
  const out: PlayerEntry[] = [];
  const entry = (x: (typeof others)[number], band: Band, child: boolean) => ({ ...x, band, child, trend: trendOf(x.user.id, x.d) });
  for (const x of others) {
    if (x.user.follow && ids.has(x.user.follow)) continue;
    out.push(entry(x, bandOf(x.d), false));
    for (const f of others.filter((y) => y.user.follow === x.user.id)) out.push(entry(f, bandOf(x.d), true));
  }
  return out;
}

/** 近づいている人はオレンジ、離れていく人は水色にぼんやり光らせる */
export const glowStyle = (trend: number) => ({
  '--glow': trend < 0 ? 'rgba(255, 150, 60, .6)' : 'rgba(80, 185, 240, .55)',
  '--glowa': Math.abs(trend),
}) as React.CSSProperties;

export function useItemsNear() {
  return useNearbyItems().map((x) => ({ ...x, band: bandOf(x.d) }));
}

/** そのアイテムを開くウィンドウ。無ければ null */
export function windowKeyOf(item: Item, camFeeds: Record<string, number>) {
  if (item.kind === 'hammer') return null;
  if (item.kind === 'camera') return item.live && camFeeds[item.id] ? `cam:${item.id}` : null;
  return `item:${item.id}`;
}

export const itemLabel = (item: Item) =>
  item.kind === 'note' ? (item.text.split('\n')[0].slice(0, 16) || '付箋（空）')
    : item.kind === 'youtube' && item.title ? item.title.slice(0, 24)
    : ITEM_INFO[item.kind].name;

/** 直近 30 秒の発言。上部の顔と 3D の頭の上の吹き出しに出す */
const BUBBLE_MS = 30_000;
const NO_CHAT: ChatMessage[] = [];

export function useLastSaid(id: string) {
  const chat = useStore((s) => (s.session ? s.chats[s.session] ?? NO_CHAT : NO_CHAT));
  const [, tick] = useState(0);
  const last = [...chat].reverse().find((m) => m.from === id && m.text);
  const fresh = last && Date.now() - last.at < BUBBLE_MS;
  useEffect(() => {
    if (!fresh || !last) return;
    const t = setTimeout(() => tick((n) => n + 1), BUBBLE_MS - (Date.now() - last.at) + 50);
    return () => clearTimeout(t);
  }, [fresh, last]);
  return fresh ? last.text : null;
}

export function ChatImage({ src }: { src?: string }) {
  if (!src) return null;
  return <img className="chatimg" src={src} alt="" onClick={() => set({ lightbox: src })} />;
}

export function Lightbox() {
  const src = useStore((s) => s.lightbox);
  if (!src) return null;
  return (
    <div className="lightbox" onClick={() => set({ lightbox: null })}>
      <img src={src} alt="" />
      <a className="dl" href={src} download="tonarium.jpg" onClick={(e) => e.stopPropagation()}>保存</a>
    </div>
  );
}

export function HammerCursor() {
  const on = useStore((s) => s.mode === '2d' && !!s.session && !!heldHammer(s));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return;
    const move = (e: MouseEvent) => {
      if (ref.current) ref.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    const down = () => {
      const el = ref.current?.firstElementChild as HTMLElement | null;
      if (!el) return;
      el.classList.remove('swing');
      void el.offsetWidth; // reflow してアニメーションをやり直す
      el.classList.add('swing');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mousedown', down);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mousedown', down); };
  }, [on]);
  if (!on) return null;
  return <div ref={ref} className="hammercursor"><div>🔨</div></div>;
}

/** ボタンの位置に合わせて出すポップオーバー。外側クリックで閉じる */
export function Popover({ anchor, onClose, children, side = 'right', className = '' }: {
  anchor: DOMRect; onClose: () => void; children: React.ReactNode; side?: 'right' | 'up' | 'down'; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // 開閉ボタン（data-popanchor）は自分で切り替えるので、ここでは閉じない
    const down = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.('[data-popanchor]')) close.current();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    // 開いたクリック自体で閉じないよう、次のイベントから見る
    const t = setTimeout(() => { window.addEventListener('mousedown', down); window.addEventListener('keydown', key); });
    return () => { clearTimeout(t); window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, []);
  // 実際の大きさが分かってから画面内に収める
  const [shift, setShift] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setShift({
      x: Math.min(0, window.innerWidth - 12 - r.right) + Math.max(0, 12 - r.left),
      y: Math.min(0, window.innerHeight - 12 - r.bottom) + Math.max(0, 12 - r.top),
    });
  }, [anchor]);
  const style: React.CSSProperties = side === 'right'
    ? { left: anchor.right + 10 + shift.x, top: anchor.top - 8 + shift.y }
    : side === 'up'
      ? { left: anchor.left + anchor.width / 2 + shift.x, bottom: window.innerHeight - anchor.top + 10 - shift.y, transform: 'translateX(-50%)' }
      : { left: anchor.left + shift.x, top: anchor.bottom + 8 + shift.y };
  // パネルの backdrop-filter が fixed の基準になって切れてしまうので body に出す
  return createPortal(<div ref={ref} className={`popover ${className}`} style={style}>{children}</div>, document.body);
}
