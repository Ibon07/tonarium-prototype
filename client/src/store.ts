import { create } from 'zustand';
import type { AvatarState, ChatMessage, GuildConfig, Mode, User } from '../../shared/protocol.ts';
import type { Item } from '../../shared/items.ts';

export type VoiceStatus = 'off' | 'connecting' | 'connected' | 'unavailable';
/** メイン領域に開いているもの: テキストチャンネル / 参加中セッションの通話画面 / その付箋ボード */
export type View = 'text' | 'session' | 'board';

interface State {
  selfId: string;
  selfName: string;
  joined: boolean;
  wsConnected: boolean;

  guild: GuildConfig;
  /** オンラインの全ユーザー（どのセッションにいるかを含む） */
  users: User[];
  chats: Record<string, ChatMessage[]>;
  avatarsBy: Record<string, Record<string, AvatarState>>;
  itemsBy: Record<string, Record<string, Item>>;

  /** 自分が入っているセッション（null = 未接続） */
  session: string | null;
  mode: Mode;
  view: View;
  textChannel: string;

  // ---- 参加中セッションから導出（recompute で更新） ----
  participants: User[];
  /** 自分以外のアバター */
  avatars: Record<string, AvatarState>;
  items: Record<string, Item>;

  // ---- アイテムの手元だけの状態 ----
  /** チェスの選択中マスなど、各アイテムの見た目用の状態（同期しない） */
  itemUi: Record<string, { sel?: number }>;
  /** 2D の通話画面で拡大表示しているタイル（'stream' かアイテムID） */
  focus: string | null;
  /** ハンマーで叩かれた時刻・振った時刻（ユーザーID → performance.now()） */
  hits: Record<string, number>;
  swings: Record<string, number>;
  /** 2D の叩く演出の待ち行列 */
  hitFx: { key: number; from: string; to: string }[];
  /** 3D でマウスをロックしているか、照準の先の説明 */
  locked: boolean;
  aimHint: string | null;

  /** 自分の3D位置（2Dに戻って再度3Dに入ったとき復元） */
  selfAvatar: AvatarState;

  // ---- LiveKit 由来 ----
  voice: VoiceStatus;
  voiceError: string | null;
  /** マイクの希望設定。未接続中も切り替えられ、セッション参加時に適用する */
  micEnabled: boolean;
  speaking: Record<string, boolean>;
  micOn: Record<string, boolean>;
  /** 参加中セッションで配信中の参加者ID（同時1本） */
  sharer: string | null;
  shareHasAudio: boolean;

  /** 編集中の付箋（アイテムID） */
  selectedNote: string | null;
}

/** 3D に入ると入口のすぐ内側から、スクリーンの方を向いて始まる */
export const DEFAULT_AVATAR: AvatarState = { x: 0, z: 8, ry: 0 };

export const useStore = create<State>(() => ({
  selfId: '',
  selfName: '',
  joined: false,
  wsConnected: false,
  guild: { name: 'Tonarium', categories: [] },
  users: [],
  chats: {},
  avatarsBy: {},
  itemsBy: {},
  session: null,
  mode: '2d',
  view: 'text',
  textChannel: '',
  participants: [],
  avatars: {},
  items: {},
  itemUi: {},
  focus: null,
  hits: {},
  swings: {},
  hitFx: [],
  locked: false,
  aimHint: null,
  selfAvatar: DEFAULT_AVATAR,
  voice: 'off',
  voiceError: null,
  micEnabled: true,
  speaking: {},
  micOn: {},
  sharer: null,
  shareHasAudio: false,
  selectedNote: null,
}));

export const set = useStore.setState;
export const get = useStore.getState;

const EMPTY: Record<string, never> = {};
/** 全体の状態から「参加中セッション」の分を切り出す。2D/3D の各ビューはこちらだけを見る */
export function recompute() {
  const s = get();
  const sid = s.session;
  const avatars = { ...(sid ? s.avatarsBy[sid] : EMPTY) };
  delete avatars[s.selfId];
  set({
    participants: sid ? s.users.filter((u) => u.session === sid) : [],
    items: (sid && s.itemsBy[sid]) || EMPTY,
    avatars,
  });
}

export function nameOf(id: string | null) {
  if (!id) return '';
  return get().users.find((p) => p.id === id)?.name ?? '（退出済み）';
}

export function channelOf(id: string | null) {
  if (!id) return undefined;
  for (const c of get().guild.categories) {
    const ch = c.channels.find((x) => x.id === id);
    if (ch) return ch;
  }
  return undefined;
}

/** 参加者IDから決まるアバター色 */
export function colorOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 65%, 55%)`;
}

/** 自分が持っているハンマー */
export function heldHammer(s: { items: Record<string, Item>; selfId: string }) {
  return Object.values(s.items).find((i) => i.kind === 'hammer' && i.holder === s.selfId);
}
