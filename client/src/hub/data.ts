import type { User } from '../../../shared/protocol.ts';
import { ITEM_INFO, ONLY_3D, type ItemKind } from '../../../shared/items.ts';
import { WORLDS, WORLD_KINDS, type WorldKind } from '../../../shared/worlds.ts';
import { useStore, set, save, showToast, type HubPage } from '../store.ts';

/** まだ無い機能のボタン */
export const soon = () => showToast('準備中です');

export function openHubPage(page: HubPage) {
  save('tonarium.hubPage', page);
  set({ hubPage: page, hubDetail: null });
}

export interface HubSession {
  id: string;
  name: string;
  topic: string;
  world: WorldKind;
  users: User[];
  friends: User[];
  sharing: boolean;
  has2d: boolean;
  has3d: boolean;
  here: boolean;
}

/** 実在のセッション（sessions.json）に、いまいる人とフレンドを添える。アクセス種別などはまだ無い */
export function useHubSessions(): HubSession[] {
  const guild = useStore((s) => s.guild);
  const users = useStore((s) => s.users);
  const worldBy = useStore((s) => s.worldBy);
  const friends = useStore((s) => s.friends);
  const blocked = useStore((s) => s.blocked);
  const session = useStore((s) => s.session);
  return guild.sessions.map((w) => {
    const here = users.filter((u) => u.session === w.id && !blocked.includes(u.name));
    return {
      id: w.id, name: w.name, topic: w.topic ?? '', world: worldBy[w.id] ?? 'room', users: here,
      friends: here.filter((u) => friends.includes(u.name)),
      sharing: here.some((u) => u.sharing), has2d: here.some((u) => u.mode === '2d'), has3d: here.some((u) => u.mode === '3d'),
      here: session === w.id,
    };
  });
}

export type FriendState = { name: string; user: User | null; session: HubSession | null };

/** フレンドを、同じセッション・ほかのセッション・オンライン（セッション外）・オフラインに分ける */
export function useFriendGroups() {
  const friends = useStore((s) => s.friends);
  const users = useStore((s) => s.users);
  const selfId = useStore((s) => s.selfId);
  const session = useStore((s) => s.session);
  const sessions = useHubSessions();
  const list: FriendState[] = friends.map((name) => {
    const user = users.find((u) => u.name === name && u.id !== selfId) ?? null;
    return { name, user, session: user?.session ? sessions.find((x) => x.id === user.session) ?? null : null };
  });
  return {
    sameSession: list.filter((f) => f.user && session && f.user.session === session),
    otherSession: list.filter((f) => f.user && f.user.session && f.user.session !== session),
    online: list.filter((f) => f.user && !f.user.session),
    offline: list.filter((f) => !f.user),
    onlineCount: list.filter((f) => f.user).length,
  };
}

export interface WorldCard { kind: WorldKind; name: string; desc: string; in2d: boolean; in3d: boolean }
/** 2D の人はどのワールドにも入れるが、ゲームの板わたりは 3D でしか遊べない */
export const WORLD_CARDS: WorldCard[] = WORLD_KINDS.map((k) => ({ kind: k, name: WORLDS[k].name, desc: WORLDS[k].desc, in2d: k !== 'game', in3d: true }));

export const OWNED_ITEMS = (Object.keys(ITEM_INFO) as ItemKind[]).filter((k) => !ITEM_INFO[k].media);
export const itemTags = (k: ItemKind) => {
  const i = ITEM_INFO[k];
  return [...(ONLY_3D[k] ? ['3D のみ'] : [i.in2d && '2D', i.in3d ? '3D' : '3D 互換']), i.genre].filter(Boolean) as string[];
};

export interface DummyEvent { time: string; name: string; group: string; friends: string[]; live: boolean; registered?: boolean }
export const DUMMY_EVENTS: DummyEvent[] = [
  { time: '21:00〜', name: '[イベント名]', group: '[グループ名]', friends: [], live: true, registered: true },
  { time: '20:00〜', name: '[イベント名]', group: '[グループ名]', friends: [], live: true },
  { time: '20:30〜', name: '[イベント名]', group: '[グループ名]', friends: [], live: true },
];
export const DUMMY_UPCOMING = [
  { when: '今日 21:00', name: '[イベント名]', group: '[グループ名]' },
  { when: '木 20:00', name: '[イベント名]', group: '[グループ名]' },
  { when: '金 22:00', name: '[イベント名]', group: '[グループ名]' },
];
export const DUMMY_GROUPS = [
  { color: '#3E7FB0', name: '[グループ名]' },
  { color: '#C2622F', name: '[グループ名]' },
  { color: '#2E8A6A', name: '[グループ名]' },
];
export const DUMMY_GROUP_SESSIONS = [
  { name: '[セッション名]', group: '[グループ名]', count: 5, access: 'グループ' },
  { name: '[セッション名]', group: '[グループ名]', count: 9, access: 'グループパブリック' },
];
