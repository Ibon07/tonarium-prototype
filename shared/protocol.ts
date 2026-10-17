// WebSocket で交換するメッセージ型。サーバーとクライアントで共有する。
import type { Item, ItemAction, ItemKind } from './items.ts';

export type Mode = '2d' | '3d';

// ---- チャンネル構成（channels.json で定義） ----
export interface ChannelDef {
  id: string;
  name: string;
  /** text: テキストチャンネル / session: 通話・配信・3D空間を持つセッション */
  type: 'text' | 'session';
  /** 一覧に出す説明（任意） */
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

/** オンラインのユーザー。session が null なら通話に入っていない */
export interface User {
  id: string;
  name: string;
  session: string | null;
  mode: Mode;
  micOn: boolean;
  sharing: boolean;
  /** 2D の人がフォローしている 3D の人（その人の少し後ろにいる扱いになり、視点の配信が見える） */
  follow: string | null;
  /** 2D の人が 3D 空間のどこかに置かれていればその位置（null なら入口の列） */
  pos: AvatarState | null;
}

export interface ChatMessage {
  id: string;
  /** null はシステムメッセージ（参加・退出・モード切替など） */
  from: string | null;
  fromName: string;
  text: string;
  /** 画像（撮影・キャンバス保存）。data URL */
  image?: string;
  at: number;
}

export interface AvatarState {
  x: number;
  z: number;
  ry: number;
}

/** チャットの宛先キー: テキストチャンネルはそのID、セッション内チャットは `s:<セッションID>` */
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
  /** 自分をフォローしている人を全員解除する（3D の人が使う） */
  | { t: 'dropFollowers' }
  /** 2D の人の位置を決める（3D の人が運ぶ、2D の本人がマップで動く・叩いて移る）。pos が null なら入口に戻る */
  | { t: 'place2d'; target: string; pos: AvatarState | null }
  | { t: 'chat'; ch: string; text: string; image?: string }
  | { t: 'avatar'; s: AvatarState }
  | { t: 'itemCreate'; kind: ItemKind; x: number; z: number; ry: number; text?: string }
  | { t: 'itemRemove'; id: string }
  | { t: 'itemMove'; id: string; x: number; z: number; ry: number }
  | { t: 'itemAction'; id: string; action: ItemAction }
  /** ハンマーで叩く（持っている人だけ有効） */
  | { t: 'hit'; to: string };

export type ServerMsg =
  | { t: 'snapshot'; s: Snapshot }
  | { t: 'users'; list: User[] }
  | { t: 'chat'; ch: string; m: ChatMessage }
  | { t: 'avatar'; sid: string; id: string; s: AvatarState }
  | { t: 'avatarRemove'; sid: string; id: string }
  | { t: 'item'; sid: string; item: Item }
  | { t: 'itemRemove'; sid: string; id: string }
  /** 操作だけを配る（isDeltaAction のもの） */
  | { t: 'itemAction'; sid: string; id: string; action: ItemAction; by: string }
  | { t: 'hit'; sid: string; from: string; to: string };

/** 3D部屋の寸法（床は -ROOM_HALF..ROOM_HALF の正方形）。スクリーンは北壁 (z = -ROOM_HALF) */
export const ROOM_HALF = 10;
/** 入口は南壁 (z = +ROOM_HALF) の中央。幅は 2 * DOOR_HALF */
export const DOOR_HALF = 1.5;
/** 2D参加者が並ぶ位置（入口の外に 3 人ずつ並ぶ）。3D の立ち姿と 2D のマップで共通 */
export function entranceSlot(i: number) {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return { x: (c - 1) * 0.95, z: ROOM_HALF + 0.9 + r * 0.9 };
}
