import { Room, RoomEvent, dispose } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { ROOM_PACKET_MAX, SERVER_IDENTITY, type RoomClientMsg, type RoomServerMsg, type SessionSnapshot } from '../shared/protocol.ts';

/**
 * セッションごとの LiveKit の部屋に、サーバー自身が参加者「server」として入る。
 * 中の人からの操作はここで受け取り、中の人への配信もここから出す（部屋の外の人には届かない）
 */

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
// ブラウザ向けの URL とは別に、サーバーから直接届く URL を指定できる（コンテナ内から livekit:7880 など）
const SERVER_URL = process.env.LIVEKIT_SERVER_URL || process.env.LIVEKIT_URL;

export const livekitConfigured = () => !!(SERVER_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
export const livekitRoom = (sid: string) => `${process.env.LIVEKIT_ROOM_PREFIX || 'tonarium'}-${sid}`;

export interface RoomHandlers {
  onMessage: (sid: string, from: string, msg: RoomClientMsg) => void;
  /** 人が部屋に入った（サーバーが後から入ったときは、すでにいる人の分も呼ぶ） */
  onJoin: (sid: string, id: string) => void;
}

const connecting = new Map<string, Promise<Room>>();
const connected = new Map<string, Room>();
const enc = new TextEncoder();
const dec = new TextDecoder();

export function ensureRoom(sid: string, h: RoomHandlers): Promise<Room> {
  const cur = connected.get(sid);
  if (cur) return Promise.resolve(cur);
  let p = connecting.get(sid);
  if (p) return p;
  p = connect(sid, h).finally(() => connecting.delete(sid));
  connecting.set(sid, p);
  return p;
}

async function connect(sid: string, h: RoomHandlers) {
  if (!livekitConfigured()) throw new Error('LiveKit が未設定です (.env)');
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: SERVER_IDENTITY, name: 'server', ttl: '30d' });
  at.addGrant({ roomJoin: true, room: livekitRoom(sid), canPublish: false, canSubscribe: false, canPublishData: true });
  const room = new Room();
  const parse = (text: string): RoomClientMsg | null => { try { return JSON.parse(text) as RoomClientMsg; } catch { return null; } };
  room
    .on(RoomEvent.DataReceived, (payload, p) => {
      if (!p || p.identity === SERVER_IDENTITY) return;
      const msg = parse(dec.decode(payload));
      if (msg) h.onMessage(sid, p.identity, msg);
    })
    .on(RoomEvent.ParticipantConnected, (p) => h.onJoin(sid, p.identity))
    .on(RoomEvent.Disconnected, (reason) => {
      console.warn(`room ${sid} disconnected: ${reason}`);
      if (connected.get(sid) === room) connected.delete(sid);
    });
  // 画像付きのチャットなど、パケットに収まらないものはストリームで届く
  room.registerTextStreamHandler('msg', async (reader, info) => {
    if (info.identity === SERVER_IDENTITY) return;
    let text: string;
    try { text = await reader.readAll(); } catch { return; }
    const msg = parse(text);
    if (msg) h.onMessage(sid, info.identity, msg);
  });
  await room.connect(SERVER_URL!, await at.toJwt(), { autoSubscribe: false, dynacast: false });
  connected.set(sid, room);
  for (const p of room.remoteParticipants.values()) h.onJoin(sid, p.identity);
  return room;
}

export const roomOf = (sid: string) => connected.get(sid);
export const inRoom = (sid: string, id: string) => !!connected.get(sid)?.remoteParticipants.has(id);

/** 部屋の人へ送る。to を省くと部屋の全員（空配列は「全員」になってしまうので送らない） */
export function roomSend(sid: string, msg: RoomServerMsg, to?: string[]) {
  const lp = connected.get(sid)?.localParticipant;
  if (!lp || (to && !to.length)) return;
  const text = JSON.stringify(msg);
  const task = text.length > ROOM_PACKET_MAX
    ? lp.sendText(text, { topic: 'msg', destinationIdentities: to })
    : lp.publishData(enc.encode(text), { reliable: true, destination_identities: to });
  task.catch((e) => console.error(`room ${sid} send ${msg.t}`, e));
}

export function roomSendSnapshot(sid: string, id: string, snap: SessionSnapshot) {
  const lp = connected.get(sid)?.localParticipant;
  if (!lp) return;
  lp.sendText(JSON.stringify(snap), { topic: 'snapshot', destinationIdentities: [id] })
    .catch((e) => console.error(`room ${sid} snapshot`, e));
}

/** 最後の人が出たら部屋からも出る（LiveKit 側の部屋を閉じさせる） */
export async function leaveRoom(sid: string) {
  const room = connected.get(sid);
  if (!room) return;
  connected.delete(sid);
  await room.disconnect();
}

export async function shutdownRooms() {
  await Promise.all([...connected.keys()].map(leaveRoom));
  await dispose();
}
