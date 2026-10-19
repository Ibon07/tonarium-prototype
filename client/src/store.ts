import { create } from 'zustand';
import type { AvatarState, ChatMessage, GuildConfig, Mode, User } from '../../shared/protocol.ts';
import type { Item } from '../../shared/items.ts';

export type VoiceStatus = 'off' | 'connecting' | 'connected' | 'unavailable';
export type WinMode = 'simple' | 'free';
/** ウィンドウのキー: share（画面共有）/ cam:<アイテムID> / view:<ユーザーID> / item:<アイテムID> */
export interface Win { key: string; x: number; y: number }
export interface Notice { id: number; kind: 'poke' | 'hit' | 'friend' | 'live'; from: string; fromName: string; at: number; unread: boolean }

interface State {
  selfId: string;
  selfName: string;
  joined: boolean;
  wsConnected: boolean;

  guild: GuildConfig;
  users: User[];
  chats: Record<string, ChatMessage[]>;
  avatarsBy: Record<string, Record<string, AvatarState>>;
  itemsBy: Record<string, Record<string, Item>>;

  session: string | null;
  mode: Mode;

  // 以下は参加中セッションの分だけを recompute() で切り出したもの
  participants: User[];
  avatars: Record<string, AvatarState>;
  items: Record<string, Item>;

  /** 同期しない手元だけの状態 */
  itemUi: Record<string, ItemUi>;
  /** 後ろほど前面 */
  windows: Win[];
  maxWin: string | null;
  winMode: WinMode;
  /** たたんでいる前面パネル */
  folded: { left: boolean; right: boolean; faces: boolean };
  confirmClose: string | null;
  /** 2D/3D 切り替え中の疑似ローディング */
  switching: { to: Mode; dur: number } | null;
  /** 疑似ローディングの長さの倍率（手元に保存） */
  loadScale: number;
  /** 視点のライブを頼んだ相手。始まったらウィンドウを開く */
  liveRequested: string | null;
  /** 開く前に確認している外部 URL */
  openUrl: string | null;
  /** プロフィールを開いている相手 */
  profileOf: string | null;
  notices: Notice[];
  friends: string[];
  /** 名前単位。手元だけに保存する */
  blocked: string[];
  /** 3D で「そばにいく」したとき Player が拾う */
  teleport: AvatarState | null;
  hits: Record<string, number>;
  /** つんつんされた時刻（顔のタイルの演出用） */
  pokes: Record<string, number>;
  swings: Record<string, number>;
  hitFx: { key: number; from: string; to: string }[];
  locked: boolean;
  aimHint: string | null;

  selfAvatar: AvatarState;

  voice: VoiceStatus;
  voiceError: string | null;
  /** 希望設定。未接続中も切り替えられ、参加時に適用する */
  micEnabled: boolean;
  speaking: Record<string, boolean>;
  micOn: Record<string, boolean>;
  sharer: string | null;
  shareHasAudio: boolean;

  selectedNote: string | null;
  lightbox: string | null;
  /** 映像要素は livekit.ts の camVideos */
  camFeeds: Record<string, number>;
  flashAt: number;
}

function load<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback; } catch { return fallback; }
}
export function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 保存できない環境では今回だけ */ }
}

export function spawnPoint(): AvatarState {
  return { x: (Math.random() - 0.5) * 5, z: 7 + Math.random() * 1.5, ry: 0 };
}

export const useStore = create<State>(() => ({
  selfId: '',
  selfName: '',
  joined: false,
  wsConnected: false,
  guild: { name: 'Tonarium', worlds: [] },
  users: [],
  chats: {},
  avatarsBy: {},
  itemsBy: {},
  session: null,
  mode: '2d',
  participants: [],
  avatars: {},
  items: {},
  itemUi: {},
  windows: [],
  maxWin: null,
  winMode: load('tonarium.winMode', 'simple'),
  folded: load('tonarium.folded', { left: false, right: false, faces: false }),
  confirmClose: null,
  profileOf: null,
  openUrl: null,
  liveRequested: null,
  switching: null,
  loadScale: load('tonarium.loadScale', 1),
  notices: [],
  friends: [],
  blocked: load('tonarium.blocked', []),
  teleport: null,
  hits: {},
  pokes: {},
  swings: {},
  hitFx: [],
  locked: false,
  aimHint: null,
  selfAvatar: spawnPoint(),
  voice: 'off',
  voiceError: null,
  micEnabled: true,
  speaking: {},
  micOn: {},
  sharer: null,
  shareHasAudio: false,
  selectedNote: null,
  lightbox: null,
  camFeeds: {},
  flashAt: 0,
}));

export interface ItemUi { sel?: number; color?: string; size?: number; erase?: boolean }

export const set = useStore.setState;
export const get = useStore.getState;

const EMPTY: Record<string, never> = {};
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

export function worldOf(id: string | null) {
  return id ? get().guild.worlds.find((w) => w.id === id) : undefined;
}

export function colorOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 65%, 55%)`;
}

export function heldHammer(s: { items: Record<string, Item>; selfId: string }) {
  return Object.values(s.items).find((i) => i.kind === 'hammer' && i.holder === s.selfId);
}

export function heldCamera(s: { items: Record<string, Item>; selfId: string }) {
  return Object.values(s.items).find((i): i is Item & { kind: 'camera' } => i.kind === 'camera' && i.holder === s.selfId);
}
