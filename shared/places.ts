import { entranceSlot, type AvatarState, type User } from './protocol.ts';

export interface Place { x: number; z: number; ry: number; small: boolean }

/** 距離帯：すぐそば・声が届く（＝声の範囲チャットの宛先）の境目 */
export const NEAR_RANGE = 3;
export const VOICE_RANGE = 15;

/** 3D 表示・リスト・音・声の範囲チャットで共通の、各参加者の位置 */
export function computePlaces(participants: User[], avatarOf: (id: string) => AvatarState | undefined): Map<string, Place> {
  const out = new Map<string, Place>();
  for (const u of participants) {
    if (u.mode !== '3d') continue;
    const a = avatarOf(u.id);
    if (a) out.set(u.id, { ...a, small: false });
  }
  const followers = new Map<string, User[]>();
  let queue = 0;
  for (const u of participants) {
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

/** target の手前（from 側）gap の位置で、target の方を向く */
export function approach(from: { x: number; z: number } | undefined, target: { x: number; z: number }, gap: number): AvatarState {
  let dx = (from?.x ?? target.x) - target.x;
  let dz = (from?.z ?? target.z + 1) - target.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) { dx = 0; dz = 1; } else { dx /= d; dz /= d; }
  const x = target.x + dx * gap;
  const z = target.z + dz * gap;
  return { x, z, ry: Math.atan2(-(target.x - x), -(target.z - z)) };
}
