import type { User } from '../../shared/protocol.ts';
import type { Item } from '../../shared/items.ts';
import { VOICE_RANGE, computePlaces, type Place } from '../../shared/places.ts';
import { useStore, get, isBroadcast } from './store.ts';

export type { Place };

/** 自分の 3D 位置だけはサーバー経由より手元の値が新しい */
export function placesOf(s = get()): Map<string, Place> {
  return computePlaces(s.participants, (id) => (id === s.selfId ? (s.mode === '3d' ? s.selfAvatar : undefined) : s.avatars[id]));
}

/** 3D の人の顔の上下。自分は手元の値が新しい */
export function pitchOf(id: string, s = get()) {
  return (id === s.selfId ? (s.mode === '3d' ? s.selfAvatar.pitch : 0) : s.avatars[id]?.pitch) ?? 0;
}

export function distanceTo(id: string, s = get()) {
  const places = placesOf(s);
  const me = places.get(s.selfId);
  const p = places.get(id);
  return id === s.selfId ? 0 : me && p ? Math.hypot(p.x - me.x, p.z - me.z) : Infinity;
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
export const SILENT = VOICE_RANGE;

const falloff = (d: number) => (1 - Math.min(1, Math.max(0, (d - FULL) / (SILENT - FULL)))) ** 2;

/** 効果音などをその人の位置から鳴らすときの音量。ブロードキャストモードでは距離に関係なく等倍 */
export const volumeFrom = (id: string) => (id === get().selfId || isBroadcast() ? 1 : falloff(distanceTo(id)));

/** 空間に置かれた物（動画など）の音量 */
export function volumeAt(x: number, z: number) {
  const s = get();
  if (isBroadcast(s)) return 1;
  const me = placesOf(s).get(s.selfId);
  return me ? falloff(Math.hypot(x - me.x, z - me.z)) : 0;
}

const blockedIds = (s = get()) => new Set(s.users.filter((u) => s.blocked.includes(u.name)).map((u) => u.id));

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
  const blocked = blockedIds(s);
  const bc = isBroadcast(s);
  for (const [id, v] of voices) {
    const p = places.get(id);
    let g = 0;
    let pan = 0;
    if (me && p && !blocked.has(id)) {
      const dx = p.x - me.x;
      const dz = p.z - me.z;
      const d = Math.hypot(dx, dz);
      g = bc ? 1 : falloff(d);
      if (directional && d > 0.3) pan = ((dx * Math.cos(me.ry) - dz * Math.sin(me.ry)) / d) * 0.8;
    }
    v.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.08);
    v.pan.pan.setTargetAtTime(pan, ctx.currentTime, 0.08);
  }
}

setInterval(update, 100);

// 開発時のデバッグ用
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__spatial = { placesOf, voices };
