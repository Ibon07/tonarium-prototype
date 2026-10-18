import type { Item, ItemAction, ItemKind } from './items.ts';

export type Mode = '2d' | '3d';

export interface ChannelDef {
  id: string;
  name: string;
  type: 'text' | 'session';
  topic?: string;
}
export interface CategoryDef {
  name: string;
  channels: ChannelDef[];
}
export interface GuildConfig {
  name: string;
  categories: CategoryDef[];
}

export interface User {
  id: string;
  name: string;
  session: string | null;
  mode: Mode;
  micOn: boolean;
  sharing: boolean;
  follow: string | null;
  /** 2D のみ。null なら入口の列 */
  pos: AvatarState | null;
}

export interface ChatMessage {
  id: string;
  /** null はシステムメッセージ */
  from: string | null;
  fromName: string;
  text: string;
  /** data URL */
  image?: string;
  at: number;
}

export interface AvatarState {
  x: number;
  z: number;
  ry: number;
}

/** テキストチャンネルはそのID、セッション内チャットは `s:<sid>` */
export const sessionChatKey = (sid: string) => `s:${sid}`;

export interface Snapshot {
  guild: GuildConfig;
  users: User[];
  chats: Record<string, ChatMessage[]>;
  avatars: Record<string, Record<string, AvatarState>>;
  items: Record<string, Item[]>;
}

export type ClientMsg =
  | { t: 'hello'; id: string; name: string }
  | { t: 'join'; sid: string }
  | { t: 'leave' }
  | { t: 'mode'; mode: Mode }
  | { t: 'status'; micOn: boolean; sharing: boolean }
  | { t: 'follow'; target: string | null }
  | { t: 'dropFollowers' }
  /** pos が null なら入口の列に戻る */
  | { t: 'place2d'; target: string; pos: AvatarState | null }
  | { t: 'chat'; ch: string; text: string; image?: string }
  | { t: 'avatar'; s: AvatarState }
  | { t: 'itemCreate'; kind: ItemKind; x: number; z: number; ry: number; text?: string }
  | { t: 'itemRemove'; id: string }
  | { t: 'itemMove'; id: string; x: number; z: number; ry: number }
  | { t: 'itemAction'; id: string; action: ItemAction }
  | { t: 'hit'; to: string };

export type ServerMsg =
  | { t: 'snapshot'; s: Snapshot }
  | { t: 'users'; list: User[] }
  | { t: 'chat'; ch: string; m: ChatMessage }
  | { t: 'avatar'; sid: string; id: string; s: AvatarState }
  | { t: 'avatarRemove'; sid: string; id: string }
  | { t: 'item'; sid: string; item: Item }
  | { t: 'itemRemove'; sid: string; id: string }
  | { t: 'itemAction'; sid: string; id: string; action: ItemAction; by: string }
  | { t: 'hit'; sid: string; from: string; to: string };

/** 床は -ROOM_HALF..ROOM_HALF。スクリーンは北壁 (z = -ROOM_HALF)、入口は南壁 */
export const ROOM_HALF = 10;
export const DOOR_HALF = 1.5;
export function entranceSlot(i: number) {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return { x: (c - 1) * 0.95, z: ROOM_HALF + 0.9 + r * 0.9 };
}
