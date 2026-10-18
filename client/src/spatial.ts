import { entranceSlot, type AvatarState, type User } from '../../shared/protocol.ts';
import type { Item } from '../../shared/items.ts';
import { useStore, get } from './store.ts';

export interface Place { x: number; z: number; ry: number; small: boolean }

/** 3D 表示・マップ・音で共通の、各参加者の位置 */
export function placesOf(s = get()): Map<string, Place> {
  const out = new Map<string, Place>();
  const avatarOf = (id: string): AvatarState | undefined =>
    id === s.selfId ? (s.mode === '3d' ? s.selfAvatar : undefined) : s.avatars[id];
  for (const u of s.participants) {
    if (u.mode !== '3d') continue;
    const a = avatarOf(u.id);
    if (a) out.set(u.id, { ...a, small: false });
  }
  const followers = new Map<string, User[]>();
  let queue = 0;
  for (const u of s.participants) {
    if (u.mode !== '2d') continue;
    const target = u.follow ? out.get(u.follow) : undefined;
    if (target && u.follow) {
      const list = followers.get(u.follow) ?? [];
      list.push(u);
      followers.set(u.follow, list);
      const i = list.length - 1;
      const side = (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 0.45;
      const back = 0.9 + Math.floor(i / 3) * 0.35;
      // 後ろ = 前向き (-sin, -cos) の逆。横 = (cos, -sin)
      out.set(u.id, {
        x: target.x + Math.sin(target.ry) * back + Math.cos(target.ry) * side,
        z: target.z + Math.cos(target.ry) * back - Math.sin(target.ry) * side,
        ry: target.ry,
        small: true,
      });
    } else if (u.pos) {
      out.set(u.id, { ...u.pos, small: false });
    } else {
      const p = entranceSlot(queue++);
      out.set(u.id, { x: p.x, z: p.z, ry: 0, small: false });
    }
  }
  return out;
}

export function useNearby(): { user: User; d: number }[] {
  useStore((s) => s.participants);
  useStore((s) => s.avatars);
  useStore((s) => s.selfAvatar);
  useStore((s) => s.mode);
  const s = get();
  const places = placesOf(s);
  const me = places.get(s.selfId);
  return s.participants
    .map((user) => {
      const p = places.get(user.id);
      const d = user.id === s.selfId ? 0 : me && p ? Math.hypot(p.x - me.x, p.z - me.z) : Infinity;
      return { user, d };
    })
    .sort((a, b) => a.d - b.d);
}

export function useNearbyItems(): { item: Item; d: number; heldBy: string | null }[] {
  useStore((s) => s.items);
  useStore((s) => s.participants);
  useStore((s) => s.avatars);
  useStore((s) => s.selfAvatar);
  useStore((s) => s.mode);
  const s = get();
  const places = placesOf(s);
  const me = places.get(s.selfId);
  return Object.values(s.items)
    .map((item) => {
      const heldBy = 'holder' in item ? item.holder : null;
      const p = heldBy ? places.get(heldBy) : item;
      const d = me && p ? Math.hypot(p.x - me.x, p.z - me.z) : Infinity;
      return { item, d, heldBy };
    })
    .sort((a, b) => a.d - b.d);
}

export const formatDistance = (d: number) => (d === 0 ? '自分' : !Number.isFinite(d) ? '—' : d < 10 ? `${d.toFixed(1)}m` : `${Math.round(d)}m`);

const FULL = 2;
export const SILENT = 12;

let ctx: AudioContext | null = null;
const voices = new Map<string, { gain: GainNode; pan: StereoPannerNode; source: MediaStreamAudioSourceNode }>();

/** AudioContext はユーザー操作の中で再開しないと鳴らない */
export function resumeAudio() {
  ctx ??= new AudioContext();
  void ctx.resume();
}

export function addVoice(identity: string, track: MediaStreamTrack) {
  removeVoice(identity);
  ctx ??= new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner();
  gain.gain.value = 0;
  source.connect(gain).connect(pan).connect(ctx.destination);
  voices.set(identity, { gain, pan, source });
  update();
}

export function removeVoice(identity: string) {
  const v = voices.get(identity);
  if (!v) return;
  v.source.disconnect();
  v.gain.disconnect();
  v.pan.disconnect();
  voices.delete(identity);
}

export function removeAllVoices() {
  for (const id of [...voices.keys()]) removeVoice(id);
}

function update() {
  if (!ctx || !voices.size) return;
  const s = get();
  const places = placesOf(s);
  const me = places.get(s.selfId);
  const directional = s.mode === '3d' || !!(s.participants.find((p) => p.id === s.selfId)?.follow);
  for (const [id, v] of voices) {
    const p = places.get(id);
    let g = 0;
    let pan = 0;
    if (me && p) {
      const dx = p.x - me.x;
      const dz = p.z - me.z;
      const d = Math.hypot(dx, dz);
      const t = Math.min(1, Math.max(0, (d - FULL) / (SILENT - FULL)));
      g = (1 - t) ** 2;
      if (directional && d > 0.3) pan = ((dx * Math.cos(me.ry) - dz * Math.sin(me.ry)) / d) * 0.8;
    }
    v.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.08);
    v.pan.pan.setTargetAtTime(pan, ctx.currentTime, 0.08);
  }
}

setInterval(update, 100);

// 開発時のデバッグ用
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__spatial = { placesOf, voices };
