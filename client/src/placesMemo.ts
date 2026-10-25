import { computePlaces, type Place } from '../../shared/places.ts';
import type { AvatarState, Mode, Participant } from '../../shared/protocol.ts';
import type { Walk } from './walk.ts';

export type { Place };

/** placesOf の入力。位置の更新ではどれも参照ごと差し替わり、その場で書き換わることはない */
export interface PlacesInputs {
  participants: Participant[];
  avatars: Record<string, AvatarState>;
  selfId: string;
  selfAvatar: AvatarState;
  mode: Mode;
  walk: Walk | null;
}

let cache: { inputs: PlacesInputs; out: Map<string, Place> } | null = null;

/**
 * 全員の位置。入力の参照が全部前回と同じなら前回の結果をそのまま返す。
 * 以前は呼び出しごとに全再計算していて、3D の Standee が人数分 useFrame で呼ぶため O(N²) になっていた。
 * 結果の Map は共有物なので、呼び出し側は読み取りだけにすること。
 */
export function placesFromInputs(inputs: PlacesInputs): Map<string, Place> {
  const c = cache;
  if (
    c && c.inputs.participants === inputs.participants && c.inputs.avatars === inputs.avatars
    && c.inputs.selfId === inputs.selfId && c.inputs.selfAvatar === inputs.selfAvatar
    && c.inputs.mode === inputs.mode && c.inputs.walk === inputs.walk
  ) return c.out;
  const out = computePlaces(inputs.participants, (id) => (id === inputs.selfId ? (inputs.mode === '3d' ? inputs.selfAvatar : undefined) : inputs.avatars[id]));
  if (inputs.walk && inputs.mode === '2d' && out.has(inputs.selfId)) out.set(inputs.selfId, { ...inputs.walk.at, small: false });
  cache = { inputs, out };
  return out;
}
