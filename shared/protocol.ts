import type { Item, ItemAction, ItemKind } from './items.ts';

export type Mode = '2d' | '3d';

/** ワールド＝ 1 つのセッション（通話・配信・3D 空間・アイテムを持つ） */
export interface WorldDef {
  id: string;
  name: string;
  topic?: string;
}
export interface GuildConfig {
  name: string;
  worlds: WorldDef[];
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
  /** アイコンの版（更新時刻）。null ならアイコンなし */
  icon: string | null;
  /** 3D アバター画像・調整値の版。null ならサンプル */
  avatar: string | null;
  bio: string;
  /** 開いているウィンドウのキー（閲覧中の表示に使う） */
  viewing: string[];
  /** ついてきている人に向けて自分の視点をライブ配信している（3D のみ） */
  viewLive: boolean;
}

/** near は声の範囲（送信時点で近くにいた人だけに届く）、announce は上部に固定するお知らせ */
export type ChatScope = 'near' | 'all' | 'announce';

export interface ChatMessage {
  id: string;
  /** null はシステムメッセージ（ログのイベント） */
  from: string | null;
  fromName: string;
  text: string;
  /** data URL */
  image?: string;
  at: number;
  scope: ChatScope;
  /** near の宛先 */
  to?: string[];
  /** イベントで強調する相手（つんつんされた人など） */
  about?: string;
}

export interface AvatarState {
  x: number;
  z: number;
  ry: number;
}

export interface Snapshot {
  guild: GuildConfig;
  users: User[];
  chats: Record<string, ChatMessage[]>;
  avatars: Record<string, Record<string, AvatarState>>;
  items: Record<string, Item[]>;
  friends: string[];
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
  /** /icon・/avatar・/profile へ保存した後に、同じ名前のオンラインの人へ反映させる */
  | { t: 'profileUpdated' }
  | { t: 'chat'; text: string; image?: string; scope: ChatScope }
  | { t: 'avatar'; s: AvatarState }
  | { t: 'viewing'; keys: string[] }
  | { t: 'poke'; to: string }
  | { t: 'friendRequest'; to: string }
  | { t: 'friendAccept'; to: string }
  | { t: 'sound'; id: string }
  /** ついていっている相手に視点のライブを頼む */
  | { t: 'liveRequest'; to: string }
  | { t: 'viewLive'; on: boolean }
  | { t: 'itemCreate'; kind: ItemKind; x: number; z: number; ry: number; text?: string }
  | { t: 'itemRemove'; id: string }
  | { t: 'itemMove'; id: string; x: number; z: number; ry: number }
  | { t: 'itemAction'; id: string; action: ItemAction }
  | { t: 'hit'; to: string };

export type ServerMsg =
  | { t: 'snapshot'; s: Snapshot }
  | { t: 'users'; list: User[] }
  | { t: 'chat'; sid: string; m: ChatMessage }
  | { t: 'avatar'; sid: string; id: string; s: AvatarState }
  | { t: 'avatarRemove'; sid: string; id: string }
  | { t: 'item'; sid: string; item: Item }
  | { t: 'itemRemove'; sid: string; id: string }
  | { t: 'itemAction'; sid: string; id: string; action: ItemAction; by: string }
  | { t: 'hit'; sid: string; from: string; to: string }
  | { t: 'poke'; sid: string; from: string; to: string }
  | { t: 'sound'; sid: string; from: string; id: string }
  | { t: 'liveRequest'; sid: string; from: string }
  | { t: 'friendRequest'; from: string; fromName: string }
  | { t: 'friends'; names: string[] };

/** 床は -ROOM_HALF..ROOM_HALF。スクリーンは北壁 (z = -ROOM_HALF)、入口は南壁 */
export const ROOM_HALF = 10;
export const DOOR_HALF = 1.5;
export function entranceSlot(i: number) {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return { x: (c - 1) * 0.95, z: ROOM_HALF + 0.9 + r * 0.9 };
}
