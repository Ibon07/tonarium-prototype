import type { Item } from '../../shared/items.ts';
import { EMPTY_PRESENCE, type AvatarState, type Participant, type Presence, type User } from '../../shared/protocol.ts';

const EMPTY_ITEMS: Record<string, Item> = {};

export interface SessionSources {
  users: User[];
  presence: Record<string, Presence>;
  avatarsBy: Record<string, Record<string, AvatarState>>;
  itemsBy: Record<string, Record<string, Item>>;
  session: string | null;
  selfId: string;
}

export interface SessionSlice {
  participants: Participant[];
  avatars: Record<string, AvatarState>;
  items: Record<string, Item>;
  avatarIds: string[];
}

export function projectParticipants(users: User[], presence: Record<string, Presence>, sid: string | null): Participant[] {
  if (!sid) return [];
  return users.filter((u) => u.session === sid).map((u) => ({ ...EMPTY_PRESENCE, ...presence[u.id], ...u }));
}

/** 自分の位置は selfAvatar、2D の人は participants 側なので、ここには他の 3D の人だけ */
export function projectAvatars(
  participants: Pick<Participant, 'id' | 'mode'>[],
  avatarsBy: Record<string, Record<string, AvatarState>>,
  sid: string | null,
  selfId: string,
): Record<string, AvatarState> {
  const avatars: Record<string, AvatarState> = {};
  if (!sid) return avatars;
  for (const u of participants) {
    const a = u.mode === '3d' && u.id !== selfId ? avatarsBy[sid]?.[u.id] : undefined;
    if (a) avatars[u.id] = a;
  }
  return avatars;
}

/** 位置の受信では呼ばない。フィールドが増えても比較から漏れないようにする */
export function participantSame(a: Participant, b: Participant) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 変わっていない人は同じオブジェクトのままにする（find している画面が位置のたびに描き直されない） */
export function reuseParticipants(prev: Participant[], next: Participant[]): Participant[] {
  let sameOrder = prev.length === next.length;
  const reused = next.map((p, i) => {
    const old = prev[i]?.id === p.id ? prev[i] : prev.find((x) => x.id === p.id);
    if (old && participantSame(old, p)) return old;
    sameOrder = false;
    return p;
  });
  if (sameOrder && reused.every((p, i) => p === prev[i])) return prev;
  return reused;
}

export function reuseIds(prev: string[], next: string[]) {
  return prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next;
}

export function sameAvatarMap(a: Record<string, AvatarState>, b: Record<string, AvatarState>) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((id, i) => id === bk[i] && a[id] === b[id]);
}

export function deriveSession(
  prev: { participants: Participant[]; avatars: Record<string, AvatarState>; avatarIds: string[] },
  src: SessionSources,
): SessionSlice {
  const participants = reuseParticipants(prev.participants, projectParticipants(src.users, src.presence, src.session));
  const projected = projectAvatars(participants, src.avatarsBy, src.session, src.selfId);
  const avatars = sameAvatarMap(prev.avatars, projected) ? prev.avatars : projected;
  const items = (src.session && src.itemsBy[src.session]) || EMPTY_ITEMS;
  const avatarIds = reuseIds(prev.avatarIds, Object.keys(avatars));
  return { participants, avatars, items, avatarIds };
}

/** 位置パケットは1回の更新。他セッションや自分・2D では表示用の参照を保つ */
export function applyAvatars(
  prev: {
    avatarsBy: Record<string, Record<string, AvatarState>>;
    avatars: Record<string, AvatarState>;
    avatarIds: string[];
    participants: Pick<Participant, 'id' | 'mode'>[];
    session: string | null;
    selfId: string;
  },
  sid: string,
  id: string,
  pose: AvatarState | null,
) {
  const room = { ...prev.avatarsBy[sid] };
  if (pose) room[id] = pose;
  else delete room[id];
  const avatarsBy = { ...prev.avatarsBy, [sid]: room };
  const projected = projectAvatars(prev.participants, avatarsBy, prev.session, prev.selfId);
  const avatars = sameAvatarMap(prev.avatars, projected) ? prev.avatars : projected;
  const avatarIds = reuseIds(prev.avatarIds, Object.keys(avatars));
  return { avatarsBy, avatars, avatarIds };
}
