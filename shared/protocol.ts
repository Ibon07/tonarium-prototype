import type { Item, ItemAction, ItemKind, MediaInit } from './items.ts';
import type { WorldKind } from './worlds.ts';
import type { DiceRoll } from './dice.ts';
import type { GameState } from './game.ts';

export type Mode = '2d' | '3d';

/** セッションを見られる人。省略時は public */
export type Visibility = 'public' | 'friends' | 'group' | 'invite';
export const VISIBILITY_INFO: Record<Visibility, { name: string; desc: string }> = {
  public: { name: 'パブリック', desc: 'だれでも' },
  friends: { name: 'フレンド+', desc: '作った人と中にいる人のフレンド' },
  group: { name: 'グループ', desc: 'グループのメンバー' },
  invite: { name: 'インバイト', desc: '誘われた人だけ' },
};

/** セッション（通話・配信・アイテムを持ち、ワールド＝ 3D 空間を 1 つ読み込む） */
export interface SessionDef {
  id: string;
  name: string;
  topic?: string;
  /** 最初に読み込むワールド。省略時は room */
  world?: WorldKind;
  visibility?: Visibility;
  /** 作った人の名前。sessions.json のものは無い */
  owner?: string;
  /** visibility が group のときのグループ ID */
  group?: string;
  /** 誘われた人の名前 */
  invited?: string[];
}
export interface GuildConfig {
  name: string;
  sessions: SessionDef[];
}

export interface Group {
  id: string;
  name: string;
  color: string;
  owner: string;
  /** メンバーの名前 */
  members: string[];
}

export interface EventDef {
  id: string;
  title: string;
  /** 開始時刻（ms） */
  at: number;
  group: string | null;
  /** 会場のセッション */
  session: string | null;
  owner: string;
  /** 参加表明した人の名前 */
  attendees: string[];
}

export interface User {
  id: string;
  name: string;
  session: string | null;
  mode: Mode;
  micOn: boolean;
  sharing: boolean;
  follow: string | null;
  /** 2D のみ。null ならスポーンエリア */
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
  /** 3D で画面共有中に床に立てた配信ディスプレイ。2D のとき（頭の上に出す）や共有していないときは null */
  display: AvatarState | null;
}

/** near は声の範囲（送信時点で近くにいた人だけに届く）、announce は上部に固定するお知らせ */
export type ChatScope = 'near' | 'all' | 'announce';

export interface ChatMessage {
  id: string;
  /** null はシステムメッセージ（ログのイベント） */
  from: string | null;
  fromName: string;
  text: string;
  /** data URL（写真・キャンバスの保存など） */
  image?: string;
  /** アップロードした画像・動画 */
  media?: ChatMedia;
  at: number;
  scope: ChatScope;
  /** near の宛先 */
  to?: string[];
  /** イベントで強調する相手（つんつんされた人など） */
  about?: string;
  /** サイコロの結果。シークレットのとき本人以外には results が null */
  dice?: DiceRoll;
}

export interface ChatMedia { kind: 'image' | 'video'; url: string; w: number; h: number }

export interface AvatarState {
  x: number;
  z: number;
  ry: number;
  /** 3D の人の顔の上下の向き（上向きが正） */
  pitch?: number;
  /**
   * 跳んだ回数。高さは送らず、増えたのを見た側が受け取った瞬間から jumpHeight で放物線を描く
   * （途中の高さを送ると、届く間隔のむらでカクつく）
   */
  jump?: number;
  /** 床（高さ 0）以外にいるときの足元の高さ。ゲームの塔の上など。あればジャンプの放物線より優先する */
  y?: number;
}

/** 初速 4.2m/s・重力 12m/s² で 0.7m ほど跳ぶ */
export const JUMP_V = 4.2;
export const GRAVITY = 12;
/** 跳んでから ms 経ったときの足元の高さ（m） */
export function jumpHeight(ms: number) {
  const t = ms / 1000;
  if (!(t > 0 && t < (2 * JUMP_V) / GRAVITY)) return 0;
  return JUMP_V * t - (GRAVITY * t * t) / 2;
}

export interface Snapshot {
  guild: GuildConfig;
  users: User[];
  chats: Record<string, ChatMessage[]>;
  avatars: Record<string, Record<string, AvatarState>>;
  items: Record<string, Item[]>;
  friends: string[];
  groups: Group[];
  events: EventDef[];
  /** ワールドごとのブロードキャストモード（距離に関係なく音が聞こえる） */
  broadcast: Record<string, boolean>;
  /** セッションごとの今のワールド */
  world: Record<string, WorldKind>;
  /** セッションごとのゲームワールドのゲーム */
  games: Record<string, GameState>;
  /** 再生位置をそろえるためのサーバー時刻 */
  now: number;
}

export type ClientMsg =
  | { t: 'hello'; id: string; name: string }
  | { t: 'join'; sid: string }
  | { t: 'leave' }
  | { t: 'mode'; mode: Mode }
  | { t: 'status'; micOn: boolean; sharing: boolean }
  | { t: 'follow'; target: string | null }
  | { t: 'dropFollowers' }
  /** pos が null ならスポーンエリアに戻る */
  | { t: 'place2d'; target: string; pos: AvatarState | null }
  /** 3D で配信ディスプレイを持ち運ぶ */
  | { t: 'displayMove'; target: string; x: number; z: number; ry: number }
  /** /icon・/avatar・/profile へ保存した後に、同じ名前のオンラインの人へ反映させる */
  | { t: 'profileUpdated' }
  | { t: 'chat'; text: string; image?: string; media?: ChatMedia; scope: ChatScope }
  | { t: 'avatar'; s: AvatarState }
  | { t: 'viewing'; keys: string[] }
  | { t: 'poke'; to: string }
  | { t: 'friendRequest'; to: string }
  | { t: 'friendAccept'; to: string }
  | { t: 'sessionCreate'; name: string; topic: string; world: WorldKind; visibility: Visibility; group?: string }
  | { t: 'sessionDelete'; id: string }
  | { t: 'groupCreate'; name: string; color: string }
  | { t: 'groupJoin'; id: string }
  | { t: 'groupLeave'; id: string }
  | { t: 'groupDelete'; id: string }
  | { t: 'eventCreate'; title: string; at: number; group: string | null; session: string | null }
  | { t: 'eventAttend'; id: string; on: boolean }
  | { t: 'eventDelete'; id: string }
  /** to はユーザー ID。セッションなら invited にも加える */
  | { t: 'invite'; kind: 'session' | 'group'; id: string; to: string }
  | { t: 'sound'; id: string }
  /** ついていっている相手に視点のライブを頼む */
  | { t: 'liveRequest'; to: string }
  | { t: 'viewLive'; on: boolean }
  | { t: 'itemCreate'; kind: ItemKind; x: number; z: number; ry: number; text?: string; media?: MediaInit }
  /** key はウィンドウのキー（item:<id> / cam:<id>） */
  | { t: 'attention'; key: string }
  | { t: 'broadcast'; on: boolean }
  /** clearItems ならアイテムをすべて片付けてから切り替える */
  | { t: 'world'; world: WorldKind; clearItems?: boolean }
  | { t: 'gameStart' }
  /** 自分が乗った板（サーバーが消える時刻を決める） */
  | { t: 'gameStep'; tile: number }
  | { t: 'gameFell' }
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
  | { t: 'attention'; sid: string; from: string; key: string }
  | { t: 'broadcast'; sid: string; on: boolean }
  /** at（サーバー時刻）に切り替わる予告 */
  | { t: 'worldPending'; sid: string; world: WorldKind; at: number; by: string; clearItems: boolean }
  | { t: 'world'; sid: string; world: WorldKind }
  | { t: 'game'; sid: string; game: GameState }
  | { t: 'gameTile'; sid: string; tile: number; at: number }
  | { t: 'friendRequest'; from: string; fromName: string }
  | { t: 'friends'; names: string[] }
  | { t: 'sessions'; list: SessionDef[] }
  | { t: 'groups'; list: Group[] }
  | { t: 'events'; list: EventDef[] }
  | { t: 'invite'; kind: 'session' | 'group'; id: string; from: string; fromName: string };

/** 床は -ROOM_HALF..ROOM_HALF。スクリーンは北壁 (z = -ROOM_HALF) */
export const ROOM_HALF = 10;
/** 入ってきた人が現れる丸いエリア。家具を置かない */
export const SPAWN = { x: 0, z: 6.5, r: 1.6 };
/** スポーンエリアの i 番目の立ち位置。ひまわりの種の並びで、人が増えても重ならない */
export function spawnSlot(i: number) {
  const r = 0.45 * Math.sqrt(i);
  const a = i * 2.39996;
  return { x: SPAWN.x + Math.sin(a) * r, z: SPAWN.z + Math.cos(a) * r };
}
