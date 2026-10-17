// WebSocket で交換するメッセージ型。サーバーとクライアントで共有する。

export type Mode = '2d' | '3d';

export interface Participant {
  id: string;
  name: string;
  mode: Mode;
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

export interface RoomSnapshot {
  participants: Participant[];
  chat: ChatMessage[];
  notes: Note[];
  avatars: Record<string, AvatarState>;
}

export type ClientMsg =
  | { t: 'hello'; id: string; name: string; mode: Mode }
  | { t: 'mode'; mode: Mode }
  | { t: 'chat'; text: string }
  | { t: 'avatar'; s: AvatarState }
  | { t: 'noteCreate'; note: Pick<Note, 'text' | 'color' | 'x' | 'z' | 'ry'> }
  | { t: 'noteUpdate'; id: string; patch: Partial<Pick<Note, 'text' | 'color' | 'x' | 'z' | 'ry'>> }
  | { t: 'noteLock'; id: string; lock: boolean }
  | { t: 'noteDelete'; id: string };

export type ServerMsg =
  | { t: 'snapshot'; s: RoomSnapshot }
  | { t: 'participants'; list: Participant[] }
  | { t: 'chat'; m: ChatMessage }
  | { t: 'avatar'; id: string; s: AvatarState }
  | { t: 'avatarRemove'; id: string }
  | { t: 'note'; note: Note }
  | { t: 'noteDelete'; id: string };

/** 3D部屋の寸法（床は -ROOM_HALF..ROOM_HALF の正方形）。スクリーンは北壁 (z = -ROOM_HALF) */
export const ROOM_HALF = 10;
export const NOTE_COLORS = ['#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#d8b4fe'];
