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
}

export interface ChatMessage {
  id: string;
  /** null はシステムメッセージ（参加・退出・モード切替など） */
  from: string | null;
  fromName: string;
  text: string;
  at: number;
}

export interface Note {
  id: string;
  text: string;
  color: string;
  /** 3D空間の床上の位置 (x, z) と向き (ry)。2Dマップにも同じ座標で描く */
  x: number;
  z: number;
  ry: number;
  createdBy: string;
  updatedBy: string;
  updatedAt: number;
  /** 編集中の参加者ID（簡易ロック） */
  editingBy: string | null;
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
  notes: Record<string, Note[]>;
  avatars: Record<string, Record<string, AvatarState>>;
  items: Record<string, Item[]>;
}

export type ClientMsg =
  | { t: 'hello'; id: string; name: string }
  | { t: 'join'; sid: string }
  | { t: 'leave' }
  | { t: 'mode'; mode: Mode }
  | { t: 'status'; micOn: boolean; sharing: boolean }
  | { t: 'chat'; ch: string; text: string }
  | { t: 'avatar'; s: AvatarState }
  | { t: 'noteCreate'; note: Pick<Note, 'text' | 'color' | 'x' | 'z' | 'ry'> }
  | { t: 'noteUpdate'; id: string; patch: Partial<Pick<Note, 'text' | 'color' | 'x' | 'z' | 'ry'>> }
  | { t: 'noteLock'; id: string; lock: boolean }
  | { t: 'noteDelete'; id: string }
  | { t: 'itemCreate'; kind: ItemKind; x: number; z: number; ry: number }
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
  | { t: 'note'; sid: string; note: Note }
  | { t: 'noteDelete'; sid: string; id: string }
  | { t: 'item'; sid: string; item: Item }
  | { t: 'itemRemove'; sid: string; id: string }
  | { t: 'hit'; sid: string; from: string; to: string };

/** 3D部屋の寸法（床は -ROOM_HALF..ROOM_HALF の正方形）。スクリーンは北壁 (z = -ROOM_HALF) */
export const ROOM_HALF = 10;
export const NOTE_COLORS = ['#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#d8b4fe'];
