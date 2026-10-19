import { useEffect, useRef, useState } from 'react';
import { clockTime, type Item } from '../../shared/items.ts';
import { useStore, get, serverNow } from './store.ts';
import { itemAction } from './items/actions.ts';
import { volumeAt } from './spatial.ts';
import { Icon } from './world/Icon.tsx';

type VideoItem = Item & { kind: 'video' };
type ClockItem = Item & { kind: 'video' | 'youtube' };

/** 動画アイテムごとに <video> は 1 つ。ウィンドウと 3D の板（VideoTexture）で使い回す */
export const videoEls = new Map<string, HTMLVideoElement>();
const holder = document.createElement('div');
Object.assign(holder.style, { position: 'fixed', left: '0', bottom: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
document.body.appendChild(holder);

/** 他の人とずれていたら合わせる許容量（秒） */
const DRIFT = 0.8;

const windowOpen = (id: string) => get().windows.some((w) => w.key === `item:${id}`);

/** ウィンドウで見ているなら等倍、3D では距離で小さく、2D でウィンドウを閉じていれば無音 */
export function mediaVolume(item: Item) {
  if (windowOpen(item.id)) return 1;
  return get().mode === '3d' ? volumeAt(item.x, item.z) : 0;
}

function syncVideo(el: HTMLVideoElement, item: VideoItem) {
  const target = clockTime(item.clock, serverNow());
  const end = Number.isFinite(el.duration) ? el.duration : Infinity;
  const want = Math.min(target, end);
  if (Math.abs(el.currentTime - want) > DRIFT) el.currentTime = want;
  if (item.clock.playing && target < end && el.paused) {
    // 音付きの自動再生が止められたら、消音で再生だけは合わせる
    void el.play().catch(() => { el.muted = true; void el.play().catch(() => {}); });
  }
  if (!item.clock.playing && !el.paused) el.pause();
  const v = mediaVolume(item);
  el.volume = Math.min(1, v);
}

/** ワールド内の動画アイテムの <video> を用意し、再生位置をそろえ続ける */
export function MediaSync() {
  const items = useStore((s) => s.items);
  useEffect(() => {
    const ids = new Set<string>();
    for (const it of Object.values(items)) {
      if (it.kind !== 'video') continue;
      ids.add(it.id);
      if (videoEls.has(it.id)) continue;
      const el = document.createElement('video');
      el.src = it.url;
      el.playsInline = true;
      el.preload = 'auto';
      el.loop = false;
      holder.appendChild(el);
      videoEls.set(it.id, el);
    }
    for (const [id, el] of videoEls) {
      if (ids.has(id)) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      videoEls.delete(id);
    }
  }, [items]);
  useEffect(() => {
    const t = setInterval(() => {
      for (const [id, el] of videoEls) {
        const it = get().items[id];
        if (it?.kind === 'video') syncVideo(el, it);
      }
    }, 300);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => {
    for (const el of videoEls.values()) { el.pause(); el.remove(); }
    videoEls.clear();
  }, []);
  return null;
}

/** 共有の <video> をこの場所に移して見せる。外れたら隠し場所に戻す（再生は止まらない） */
export function VideoHost({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = videoEls.get(id);
    if (!el || !ref.current) return;
    ref.current.appendChild(el);
    return () => { holder.appendChild(el); };
  }, [id]);
  return <div ref={ref} className="videohost" />;
}

const fmt = (t: number) => {
  if (!Number.isFinite(t)) return '--:--';
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** みんなで共有する再生ボタンとシークバー。押すと全員の再生がそろって変わる */
export function MediaControls({ item, duration }: { item: ClockItem; duration: () => number }) {
  const [, tick] = useState(0);
  const [seeking, setSeeking] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const dur = duration();
  const now = Math.min(clockTime(item.clock, serverNow()), Number.isFinite(dur) ? dur : Infinity);
  const shown = seeking ?? now;
  // 最後まで再生し終わったら「止まっている」扱いにして、押すと最初から
  const ended = now >= dur - 0.2;
  const playing = item.clock.playing && !ended;
  const toggle = () => itemAction(item.id, { a: playing ? 'mediaPause' : 'mediaPlay', pos: ended ? 0 : now });
  const commit = () => {
    if (seeking !== null) itemAction(item.id, { a: 'mediaSeek', pos: seeking });
    setSeeking(null);
  };
  return (
    <div className="mediactl" onPointerDown={(e) => e.stopPropagation()}>
      <button className="ib mbtn" onClick={toggle} aria-label={playing ? '一時停止（みんな）' : '再生（みんな）'}>
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <input
        type="range" min={0} max={Number.isFinite(dur) && dur > 0 ? dur : 1} step={0.1} value={Math.min(shown, Number.isFinite(dur) ? dur : shown)}
        aria-label="再生位置" onChange={(e) => setSeeking(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit}
      />
      <span className="mtime">{fmt(shown)} / {fmt(dur)}</span>
    </div>
  );
}
