import { create } from 'zustand';
import type { AvatarState, ChatMessage, Mode, Note, Participant } from '../../shared/protocol.ts';

export type VoiceStatus = 'off' | 'connecting' | 'connected' | 'unavailable';

interface State {
  selfId: string;
  selfName: string;
  joined: boolean;
  mode: Mode;
  wsConnected: boolean;

  participants: Participant[];
  chat: ChatMessage[];
  notes: Record<string, Note>;
  avatars: Record<string, AvatarState>;
  /** 自分の3D位置（2Dに戻って再度3Dに入ったとき復元） */
  selfAvatar: AvatarState;

  // LiveKit 由来
  voice: VoiceStatus;
  voiceError: string | null;
  micEnabled: boolean;
  speaking: Record<string, boolean>;
  micOn: Record<string, boolean>;
  /** 配信中の参加者ID（同時1本） */
  sharer: string | null;
  shareHasAudio: boolean;

  selectedNote: string | null;
}

export const useStore = create<State>(() => ({
  selfId: '',
  selfName: '',
  joined: false,
  mode: '2d',
  wsConnected: false,
  participants: [],
  chat: [],
  notes: {},
  avatars: {},
  selfAvatar: { x: 0, z: 4, ry: 0 },
  voice: 'off',
  voiceError: null,
  micEnabled: false,
  speaking: {},
  micOn: {},
  sharer: null,
  shareHasAudio: false,
  selectedNote: null,
}));

export const set = useStore.setState;
export const get = useStore.getState;

export function nameOf(id: string | null) {
  if (!id) return '';
  return get().participants.find((p) => p.id === id)?.name ?? '（退出済み）';
}

/** 参加者IDから決まるアバター色 */
export function colorOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 65% 55%)`;
}
