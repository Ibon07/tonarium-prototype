import { scheduleChessAiReply } from './chess-ai.ts';
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { AccessToken } from 'livekit-server-sdk';
import type {
  AvatarState, ChatMedia, ChatMessage, ChatScope, ClientMsg, GuildConfig, Mode, ServerMsg, User,
} from '../shared/protocol.ts';
import { ROOM_HALF } from '../shared/protocol.ts';
import { WORLDS, isWorldKind, pushOut, type WorldKind } from '../shared/worlds.ts';
import { ITEM_INFO, MEDIA_URL_RE, ONLY_3D, applyItemAction, createItem, isDeltaAction, isHandheld, type Item } from '../shared/items.ts';
import { sanitizeParams } from '../shared/avatar.ts';
import { VOICE_RANGE, computePlaces } from '../shared/places.ts';
import { SOUNDS } from '../shared/sounds.ts';
import { DICE_MAX, ROLL_MS, isDieSides, type DiceRoll } from '../shared/dice.ts';
import { getOgp } from './ogp.ts';
import { MEDIA_DIR, mediaExists, saveMedia, serveMedia } from './media.ts';
import { PERSON as PERSON_R, freeSpot, itemRadius, pushApart2D } from './spacing.ts';

const PORT = Number(process.env.SERVER_PORT ?? 3001);
const DEV = process.argv.includes('--dev');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'client/dist');
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
const ICON_DIR = path.join(DATA_DIR, 'icons');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
const PROFILE_DIR = path.join(DATA_DIR, 'profiles');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.log');
for (const d of [ICON_DIR, AVATAR_DIR, PROFILE_DIR, MEDIA_DIR]) fs.mkdirSync(d, { recursive: true });

const normalizeName = (name: string) => name.trim().slice(0, 24) || 'ゲスト';
const nameHash = (name: string) => createHash('sha1').update(normalizeName(name)).digest('hex');
const iconFile = (name: string) => path.join(ICON_DIR, `${nameHash(name)}.jpg`);
const avatarImageFile = (name: string) => path.join(AVATAR_DIR, `${nameHash(name)}.img`);
const avatarParamsFile = (name: string) => path.join(AVATAR_DIR, `${nameHash(name)}.json`);
const profileFile = (name: string) => path.join(PROFILE_DIR, `${nameHash(name)}.json`);
function bioOf(name: string) {
  try { return String((JSON.parse(fs.readFileSync(profileFile(name), 'utf-8')) as { bio?: unknown }).bio ?? ''); } catch { return ''; }
}
const mtime = (file: string) => { try { return Math.floor(fs.statSync(file).mtimeMs); } catch { return 0; } };
const iconVersion = (name: string) => (mtime(iconFile(name)) ? String(mtime(iconFile(name))) : null);
function avatarVersion(name: string) {
  const v = Math.max(mtime(avatarImageFile(name)), mtime(avatarParamsFile(name)));
  return v ? String(v) : null;
}
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8;
const isPng = (b: Buffer) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function readBody(req: http.IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

const SESSIONS_FILE = process.env.SESSIONS_FILE ?? path.join(ROOT, 'sessions.json');
const guild = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8')) as GuildConfig;
const sessionIds = new Set(guild.sessions.map((w) => w.id));
const livekitRoom = (sid: string) => `tonarium-${sid}`;

// フレンドは名前の組で保存する（アイコンなどと同じく名前が本人の識別）
const pairKey = (a: string, b: string) => [a, b].sort().join('\u0000');
const friendPairs = new Set<string>();
try { for (const [a, b] of JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf-8')) as [string, string][]) friendPairs.add(pairKey(a, b)); } catch { /* まだ無い */ }
const saveFriends = () => fs.writeFileSync(FRIENDS_FILE, JSON.stringify([...friendPairs].map((k) => k.split('\u0000'))));
function friendsOf(name: string) {
  const out: string[] = [];
  for (const k of friendPairs) {
    const [a, b] = k.split('\u0000');
    if (a === name) out.push(b); else if (b === name) out.push(a);
  }
  return out;
}
/** 申請先の名前 → 申請した人の名前 */
const pendingFriends = new Map<string, Set<string>>();

const users = new Map<string, User>();
const sockets = new Map<string, Set<WebSocket>>(); // 同じIDで複数タブを開ける
const chats = new Map<string, ChatMessage[]>();
const avatars = new Map<string, Map<string, AvatarState>>();
const items = new Map<string, Map<string, Item>>();
const broadcastMode = new Map<string, boolean>();
const lastAttention = new Map<string, number>();
const worldOf = new Map<string, WorldKind>();
for (const w of guild.sessions) worldOf.set(w.id, isWorldKind(w.world) ? w.world : 'room');
for (const sid of sessionIds) {
  chats.set(sid, []);
  avatars.set(sid, new Map());
  items.set(sid, new Map());
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: ServerMsg, except?: WebSocket) {
  const data = JSON.stringify(msg);
  for (const set of sockets.values())
    for (const ws of set) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
}
function sendTo(ids: Iterable<string>, msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const id of ids)
    for (const ws of sockets.get(id) ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}
const idsByName = (name: string) => [...users.values()].filter((u) => u.name === name).map((u) => u.id);
/** 途中参加のスナップショットが重くならないよう、古い画像は捨てる */
const MAX_IMAGES = 40;

function chatMedia(m: ChatMedia | undefined): ChatMedia | undefined {
  if (!m || typeof m.url !== 'string' || !MEDIA_URL_RE.test(m.url) || !mediaExists(m.url)) return undefined;
  const kind = /\.(mp4|webm)$/.test(m.url) ? 'video' : 'image';
  const size = (n: number) => Math.max(1, Math.min(10000, Math.round(Number(n) || 1)));
  return { kind, url: m.url, w: size(m.w), h: size(m.h) };
}

function pushChat(sid: string, from: User | null, text: string, opt: { scope?: ChatScope; image?: string; media?: ChatMedia; to?: string[]; about?: string; dice?: DiceRoll } = {}) {
  const list = chats.get(sid);
  if (!list) return;
  const m: ChatMessage = {
    id: randomUUID(), from: from?.id ?? null, fromName: from?.name ?? '', text, at: Date.now(), scope: opt.scope ?? 'all',
    ...(opt.image ? { image: opt.image } : {}), ...(opt.media ? { media: opt.media } : {}), ...(opt.to ? { to: opt.to } : {}), ...(opt.about ? { about: opt.about } : {}), ...(opt.dice ? { dice: opt.dice } : {}),
  };
  list.push(m);
  if (list.length > 500) list.shift();
  if (opt.image) {
    const withImage = list.filter((x) => x.image);
    for (const old of withImage.slice(0, -MAX_IMAGES)) { delete old.image; old.text += '（画像は古いため省略）'; }
  }
  if (m.to) sendTo(m.to, { t: 'chat', sid, m });
  else broadcast({ t: 'chat', sid, m });
}

const event = (sid: string, text: string, about?: string) => pushChat(sid, null, text, { about });

const lastRoll = new Map<string, number>();
/** 結果はここで決める。チャットへは転がり終わってから出し、演出より先にばれないようにする */
function rollDice(sid: string, me: User, it: Item & { kind: 'dice' }, sides: unknown, count: unknown, secret: boolean) {
  const n = Math.floor(Number(count));
  if (!isDieSides(sides) || !(n >= 1 && n <= DICE_MAX)) return;
  if (Date.now() - (lastRoll.get(me.id) ?? 0) < 600) return;
  lastRoll.set(me.id, Date.now());
  const results = Array.from({ length: n }, () => randomInt(1, sides + 1));
  const roll: DiceRoll = { id: randomUUID(), by: me.id, sides, count: n, results, secret, at: Date.now() };
  it.roll = secret ? { ...roll, results: null } : roll;
  it.updatedBy = me.id;
  broadcast({ t: 'item', sid, item: it });
  setTimeout(() => {
    if (me.session !== sid) return;
    if (!secret) { pushChat(sid, me, '', { dice: roll }); return; }
    pushChat(sid, me, '', { dice: roll, to: [me.id] });
    const others = [...users.values()].filter((u) => u.session === sid && u.id !== me.id).map((u) => u.id);
    if (others.length) pushChat(sid, me, '', { dice: { ...roll, results: null }, to: others });
  }, ROLL_MS);
}

/** 声の範囲チャットの宛先：送信時点で VOICE_RANGE 以内にいる同じワールドの人 */
function nearIds(sid: string, me: User) {
  if (broadcastMode.get(sid)) return [...users.values()].filter((u) => u.session === sid).map((u) => u.id);
  const places = computePlaces([...users.values()].filter((u) => u.session === sid), (id) => avatars.get(sid)!.get(id));
  const p = places.get(me.id);
  if (!p) return [me.id];
  return [...places].filter(([, q]) => Math.hypot(q.x - p.x, q.z - p.z) <= VOICE_RANGE).map(([id]) => id);
}

function dropFollowersOf(u: User) {
  let changed = false;
  for (const f of users.values())
    if (f.follow === u.id) { f.follow = null; changed = true; }
  return changed;
}

function releaseCameras(sid: string, u: User, at?: AvatarState) {
  for (const it of items.get(sid)!.values()) {
    if (it.kind !== 'camera') continue;
    let changed = false;
    if (it.holder === u.id) {
      it.holder = null;
      if (at) { it.x = at.x; it.z = at.z; it.ry = at.ry; }
      changed = true;
    }
    if (it.live && it.operator === u.id) { it.live = false; it.operator = null; changed = true; }
    if (changed) broadcast({ t: 'item', sid, item: it });
  }
}
function broadcastUsers() {
  // 視点のライブは、ついてくる人がいなくなったら止める
  for (const u of users.values())
    if (u.viewLive && (u.mode !== '3d' || ![...users.values()].some((f) => f.follow === u.id))) u.viewLive = false;
  broadcast({ t: 'users', list: [...users.values()] });
}
const modeLabel = (m: Mode) => (m === '3d' ? '3D' : '2D');
const clamp = (v: number) => Math.max(-ROOM_HALF + 0.5, Math.min(ROOM_HALF - 0.5, v));
const solidsOf = (sid: string) => WORLDS[worldOf.get(sid) ?? 'room'].solids;
/** 部屋の中に収め、家具にめり込んでいたら外へ出す */
function placeIn(sid: string, x: number, z: number, r: number) {
  const p = pushOut(clamp(x), clamp(z), r, solidsOf(sid));
  return { x: clamp(p.x), z: clamp(p.z) };
}
const clamp2d = (sid: string, p: AvatarState): AvatarState => ({ ...placeIn(sid, p.x, p.z, PERSON_R), ry: p.ry });

function leaveSession(u: User) {
  const sid = u.session;
  if (!sid) return;
  const av = avatars.get(sid)!.get(u.id);
  if (avatars.get(sid)!.delete(u.id)) broadcast({ t: 'avatarRemove', sid, id: u.id });
  for (const it of items.get(sid)!.values()) {
    if (it.kind === 'note' && it.editingBy === u.id) { it.editingBy = null; broadcast({ t: 'item', sid, item: it }); }
    if (it.kind === 'hammer' && it.holder === u.id) {
      it.holder = null;
      if (av) { it.x = av.x; it.z = av.z; }
      broadcast({ t: 'item', sid, item: it });
    }
  }
  releaseCameras(sid, u, av);
  dropFollowersOf(u);
  u.follow = null;
  u.pos = null;
  u.session = null;
  u.mode = '2d';
  u.micOn = false;
  u.sharing = false;
  u.viewing = [];
  event(sid, `${u.name} が退出しました`);
}

function handle(ws: WebSocket, state: { id: string | null }, msg: ClientMsg) {
  if (msg.t === 'hello') {
    state.id = msg.id;
    if (!users.has(msg.id))
      users.set(msg.id, {
        id: msg.id, name: normalizeName(msg.name), session: null, mode: '2d',
        micOn: false, sharing: false, follow: null, pos: null,
        icon: iconVersion(msg.name), avatar: avatarVersion(msg.name), bio: bioOf(msg.name), viewing: [], viewLive: false,
      });
    if (!sockets.has(msg.id)) sockets.set(msg.id, new Set());
    sockets.get(msg.id)!.add(ws);
    send(ws, {
      t: 'snapshot',
      s: {
        guild,
        users: [...users.values()],
        chats: Object.fromEntries([...chats].map(([sid, list]) => [sid, list.filter((m) => !m.to || m.to.includes(msg.id))])),
        avatars: Object.fromEntries([...avatars].map(([sid, m]) => [sid, Object.fromEntries(m)])),
        items: Object.fromEntries([...items].map(([sid, m]) => [sid, [...m.values()]])),
        friends: friendsOf(normalizeName(msg.name)),
        broadcast: Object.fromEntries(broadcastMode),
        world: Object.fromEntries(worldOf),
        now: Date.now(),
      },
    });
    broadcastUsers();
    return;
  }
  const me = state.id ? users.get(state.id) : undefined;
  if (!me) return;
  if (msg.t === 'profileUpdated') {
    const icon = iconVersion(me.name);
    const avatar = avatarVersion(me.name);
    const bio = bioOf(me.name);
    for (const u of users.values()) if (u.name === me.name) { u.icon = icon; u.avatar = avatar; u.bio = bio; }
    broadcastUsers();
    return;
  }
  if (msg.t === 'friendRequest' || msg.t === 'friendAccept') {
    const other = users.get(msg.to);
    if (!other || other.name === me.name || friendPairs.has(pairKey(me.name, other.name))) return;
    if (msg.t === 'friendRequest') {
      const set = pendingFriends.get(other.name) ?? new Set();
      set.add(me.name);
      pendingFriends.set(other.name, set);
      sendTo(idsByName(other.name), { t: 'friendRequest', from: me.id, fromName: me.name });
      return;
    }
    if (!pendingFriends.get(me.name)?.delete(other.name)) return;
    friendPairs.add(pairKey(me.name, other.name));
    saveFriends();
    for (const n of [me.name, other.name]) sendTo(idsByName(n), { t: 'friends', names: friendsOf(n) });
    return;
  }
  const sid = me.session;

  switch (msg.t) {
    case 'join': {
      if (!sessionIds.has(msg.sid) || sid === msg.sid) return;
      leaveSession(me);
      me.session = msg.sid;
      me.mode = '2d';
      broadcastUsers();
      event(msg.sid, `${me.name} が入室しました`);
      return;
    }
    case 'leave': {
      leaveSession(me);
      broadcastUsers();
      return;
    }
  }

  if (!sid) return;
  const sessItems = items.get(sid)!;
  switch (msg.t) {
    case 'chat': {
      const text = String(msg.text ?? '').trim().slice(0, 1000);
      const image = typeof msg.image === 'string' && /^data:image\/(jpeg|png);base64,/.test(msg.image) && msg.image.length < 2_000_000
        ? msg.image : undefined;
      const media = chatMedia(msg.media);
      const scope: ChatScope = msg.scope === 'near' || msg.scope === 'announce' ? msg.scope : 'all';
      if (text || image || media) pushChat(sid, me, text, { scope, image, media, to: scope === 'near' ? nearIds(sid, me) : undefined });
      return;
    }
    case 'viewing': {
      const keys = Array.isArray(msg.keys) ? msg.keys.filter((k) => typeof k === 'string').slice(0, 20).map((k) => k.slice(0, 80)) : [];
      if (keys.join('\n') === me.viewing.join('\n')) return;
      me.viewing = keys;
      broadcastUsers();
      return;
    }
    case 'poke': {
      const target = users.get(msg.to);
      if (!target || target.session !== sid || target.id === me.id) return;
      broadcast({ t: 'poke', sid, from: me.id, to: target.id });
      event(sid, `${me.name} が ${target.name} をつんつんしました`, target.id);
      return;
    }
    case 'attention': {
      const key = String(msg.key ?? '');
      const it = sessItems.get(key.slice(key.indexOf(':') + 1));
      if (!it || !/^(item|cam):/.test(key)) return;
      // 連打で通知が埋まらないように
      if (Date.now() - (lastAttention.get(me.id) ?? 0) < 3000) return;
      lastAttention.set(me.id, Date.now());
      broadcast({ t: 'attention', sid, from: me.id, key });
      const name = it.kind === 'youtube' && it.title ? it.title : ITEM_INFO[it.kind].name;
      event(sid, `${me.name} が「${name}」に注目を集めています`);
      return;
    }
    case 'broadcast': {
      const on = !!msg.on;
      if ((broadcastMode.get(sid) ?? false) === on) return;
      broadcastMode.set(sid, on);
      broadcast({ t: 'broadcast', sid, on });
      event(sid, on ? `${me.name} がブロードキャストモードをオンにしました（距離に関係なく声が届きます）` : `${me.name} がブロードキャストモードをオフにしました`);
      return;
    }
    case 'world': {
      if (!isWorldKind(msg.world) || worldOf.get(sid) === msg.world) return;
      worldOf.set(sid, msg.world);
      broadcast({ t: 'world', sid, world: msg.world });
      // 新しい家具にめり込んだ 2D の人とアイテムを外へ出す（3D の人は各自の手元で出る）
      for (const u of users.values()) if (u.session === sid && u.pos) u.pos = clamp2d(sid, u.pos);
      for (const it of sessItems.values()) {
        if ('holder' in it && it.holder) continue;
        const p = placeIn(sid, it.x, it.z, itemRadius(it) * 0.6);
        if (Math.abs(p.x - it.x) + Math.abs(p.z - it.z) < 1e-3) continue;
        Object.assign(it, p);
        broadcast({ t: 'item', sid, item: it });
      }
      broadcastUsers();
      event(sid, `${me.name} がワールドを「${WORLDS[msg.world].name}」に切り替えました`);
      return;
    }
    case 'liveRequest': {
      const target = users.get(msg.to);
      if (!target || me.follow !== target.id || target.session !== sid) return;
      sendTo([target.id], { t: 'liveRequest', sid, from: me.id });
      return;
    }
    case 'viewLive': {
      const on = !!msg.on && me.mode === '3d' && [...users.values()].some((f) => f.follow === me.id);
      if (me.viewLive === on) return;
      me.viewLive = on;
      broadcastUsers();
      event(sid, on ? `${me.name} が視点のライブを始めました（ついてきている人向け）` : `${me.name} が視点のライブを止めました`);
      return;
    }
    case 'sound': {
      if (!SOUNDS.some((s) => s.id === msg.id)) return;
      broadcast({ t: 'sound', sid, from: me.id, id: msg.id });
      return;
    }
    case 'itemCreate': {
      if (!(msg.kind in ITEM_INFO)) return;
      if (ONLY_3D[msg.kind] && me.mode !== '3d') return;
      if (msg.media && 'url' in msg.media && !mediaExists(msg.media.url)) return;
      let at = placeIn(sid, msg.x, msg.z, 0.4);
      // 2D は細かい位置を選べないので、出す瞬間だけ空いている場所へずらす
      if (me.mode === '2d') {
        const probe = createItem(msg.kind, { id: '', x: 0, z: 0, ry: 0, createdBy: me.id }, Math.random, msg.media);
        if (probe) {
          at = freeSpot(at.x, at.z, itemRadius(probe), [...users.values()].filter((u) => u.session === sid), avatars.get(sid)!,
            sessItems.values(), (x, z) => placeIn(sid, x, z, itemRadius(probe) * 0.6));
        }
      }
      const it = createItem(msg.kind, {
        id: randomUUID(), x: at.x, z: at.z, ry: msg.ry, createdBy: me.id,
      }, Math.random, msg.media);
      if (!it) return;
      if (it.kind === 'note' && msg.text) it.text = msg.text.slice(0, 300);
      sessItems.set(it.id, it);
      broadcast({ t: 'item', sid, item: it });
      event(sid, `${me.name} が ${ITEM_INFO[msg.kind].name} を出しました`);
      return;
    }
    case 'itemRemove': {
      const it = sessItems.get(msg.id);
      if (!it || !sessItems.delete(msg.id)) return;
      broadcast({ t: 'itemRemove', sid, id: msg.id });
      event(sid, `${me.name} が ${ITEM_INFO[it.kind].name} をしまいました`);
      return;
    }
    case 'itemMove': {
      const it = sessItems.get(msg.id);
      if (!it || (it.kind === 'hammer' && it.holder)) return;
      Object.assign(it, placeIn(sid, msg.x, msg.z, itemRadius(it) * 0.6), { ry: msg.ry });
      broadcast({ t: 'item', sid, item: it });
      return;
    }
    case 'itemAction': {
      const it = sessItems.get(msg.id);
      if (!it) return;
      if (msg.action.a === 'pick' && [...sessItems.values()].some((h) => isHandheld(h) && 'holder' in h && h.holder === me.id)) return;
      if (it.kind === 'camera' && (msg.action.a === 'pick' || (msg.action.a === 'camLive' && msg.action.on)) && me.mode !== '3d') return;
      if (it.kind === 'camera' && msg.action.a === 'camLive' && msg.action.on)
        for (const other of sessItems.values())
          if (other !== it && other.kind === 'camera' && other.live && other.operator === me.id) {
            other.live = false; other.operator = null;
            broadcast({ t: 'item', sid, item: other });
          }
      if (it.kind === 'dice' && msg.action.a === 'diceRoll') {
        rollDice(sid, me, it, msg.action.sides, msg.action.count, !!msg.action.secret);
        return;
      }
      if (msg.action.a === 'drop') Object.assign(msg.action, placeIn(sid, msg.action.x, msg.action.z, 0.3));
      if (!applyItemAction(it, msg.action, me.id, Math.random)) return;
      // 送り主は手元で適用済み
      if (isDeltaAction(msg.action)) broadcast({ t: 'itemAction', sid, id: it.id, action: msg.action, by: me.id }, ws);
      else broadcast({ t: 'item', sid, item: it });
      if (it.kind === 'chessAi') scheduleChessAiReply(it, () => sessItems.get(it.id), () => broadcast({ t: 'item', sid, item: it }));
      return;
    }
    case 'hit': {
      const holding = [...sessItems.values()].some((h) => h.kind === 'hammer' && h.holder === me.id);
      const target = users.get(msg.to);
      if (!holding || !target || target.session !== sid || target.id === me.id) return;
      broadcast({ t: 'hit', sid, from: me.id, to: target.id });
      event(sid, `${me.name} がピコピコハンマーで ${target.name} を叩きました`, target.id);
      return;
    }
    case 'mode': {
      if (me.mode === msg.mode) return;
      me.mode = msg.mode;
      if (msg.mode === '3d') { me.follow = null; me.pos = null; }
      if (msg.mode === '2d') {
        // スポーンエリアには戻さず、3D でいた場所にとどまる
        const av = avatars.get(sid)!.get(me.id);
        me.pos = av ? { ...av } : null;
        dropFollowersOf(me);
        releaseCameras(sid, me, av);
        if (avatars.get(sid)!.delete(me.id)) broadcast({ t: 'avatarRemove', sid, id: me.id });
      }
      broadcastUsers();
      event(sid, `${me.name} が ${modeLabel(msg.mode)} に切り替えました`);
      return;
    }
    case 'follow': {
      const target = msg.target ? users.get(msg.target) : null;
      if (msg.target && (!target || target.session !== sid || target.mode !== '3d' || target.id === me.id || me.mode !== '2d')) return;
      if (me.follow === (target?.id ?? null)) return;
      me.follow = target?.id ?? null;
      broadcastUsers();
      if (target) event(sid, `${me.name} が ${target.name} についていきました`);
      return;
    }
    case 'place2d': {
      const target = users.get(msg.target);
      if (!target || target.session !== sid || target.mode !== '2d') return;
      if (me.mode !== '3d' && target.id !== me.id) return;
      target.pos = msg.pos ? clamp2d(sid, msg.pos) : null;
      target.follow = null;
      broadcastUsers();
      return;
    }
    case 'dropFollowers': {
      if (dropFollowersOf(me)) {
        broadcastUsers();
        event(sid, `${me.name} がついてくる人を解除しました`);
      }
      return;
    }
    case 'status': {
      if (me.micOn === msg.micOn && me.sharing === msg.sharing) return;
      if (msg.sharing && !me.sharing) event(sid, `${me.name} が画面共有を開始しました`);
      me.micOn = msg.micOn;
      me.sharing = msg.sharing;
      broadcastUsers();
      return;
    }
    case 'avatar': {
      if (me.mode !== '3d') return;
      const s: AvatarState = {
        x: clamp(msg.s.x), z: clamp(msg.s.z), ry: msg.s.ry,
        pitch: Math.max(-1.5, Math.min(1.5, Number(msg.s.pitch) || 0)),
        jump: Math.max(0, Math.floor(Number(msg.s.jump) || 0)),
      };
      avatars.get(sid)!.set(me.id, s);
      broadcast({ t: 'avatar', sid, id: me.id, s }, ws);
      return;
    }
  }
}

function onClose(ws: WebSocket, id: string | null) {
  if (!id) return;
  const set = sockets.get(id);
  set?.delete(ws);
  if (set && set.size > 0) return;
  sockets.delete(id);
  const u = users.get(id);
  if (u) leaveSession(u);
  users.delete(id);
  broadcastUsers();
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/icon') {
    const name = url.searchParams.get('name') ?? '';
    if (req.method === 'POST') {
      const body = await readBody(req, 300_000);
      if (!body || !isJpeg(body)) { res.statusCode = 400; res.end(); return; }
      fs.writeFileSync(iconFile(name), body);
      res.end(JSON.stringify({ icon: iconVersion(name) }));
      return;
    }
    const file = iconFile(name);
    if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', 'image/jpeg');
    // URL に版を付けて取得するので長期キャッシュしてよい
    res.setHeader('Cache-Control', url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache');
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (url.pathname === '/avatar' || url.pathname === '/avatar/params') {
    const name = url.searchParams.get('name') ?? '';
    const isParams = url.pathname === '/avatar/params';
    const file = isParams ? avatarParamsFile(name) : avatarImageFile(name);
    if (req.method === 'POST') {
      const body = await readBody(req, isParams ? 20_000 : 6_000_000);
      if (!body) { res.statusCode = 413; res.end(); return; }
      if (isParams) {
        let params;
        try { params = sanitizeParams(JSON.parse(body.toString('utf-8'))); } catch { res.statusCode = 400; res.end(); return; }
        fs.writeFileSync(file, JSON.stringify(params));
      } else {
        if (!isPng(body) && !isJpeg(body)) { res.statusCode = 400; res.end(); return; }
        fs.writeFileSync(file, body);
      }
      res.end(JSON.stringify({ avatar: avatarVersion(name) }));
      return;
    }
    if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
    const head = fs.readFileSync(file).subarray(0, 4);
    res.setHeader('Content-Type', isParams ? 'application/json' : isPng(head) ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache');
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (url.pathname === '/profile') {
    const name = url.searchParams.get('name') ?? '';
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      const body = await readBody(req, 10_000);
      let bio = '';
      try { bio = String((JSON.parse(body?.toString('utf-8') ?? '') as { bio?: unknown }).bio ?? '').slice(0, 300); } catch { res.statusCode = 400; res.end(); return; }
      fs.writeFileSync(profileFile(name), JSON.stringify({ bio }));
      res.end(JSON.stringify({ bio }));
      return;
    }
    res.end(JSON.stringify({ bio: bioOf(name) }));
    return;
  }
  if (url.pathname === '/media' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    const r = await saveMedia(req);
    if ('error' in r) res.statusCode = r.status;
    res.end(JSON.stringify(r));
    return;
  }
  if (url.pathname.startsWith('/media/')) {
    serveMedia(req, res, url.pathname);
    return;
  }
  if (url.pathname === '/ogp') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(JSON.stringify(await getOgp((url.searchParams.get('url') ?? '').slice(0, 2000))));
    return;
  }
  if (url.pathname === '/report' && req.method === 'POST') {
    const body = await readBody(req, 10_000);
    try {
      const r = JSON.parse(body?.toString('utf-8') ?? '') as { from?: unknown; target?: unknown; reason?: unknown };
      fs.appendFileSync(REPORTS_FILE, `${JSON.stringify({ at: new Date().toISOString(), from: String(r.from).slice(0, 24), target: String(r.target).slice(0, 24), reason: String(r.reason ?? '').slice(0, 500) })}\n`);
      console.log(`report: ${String(r.from)} -> ${String(r.target)}`);
    } catch { res.statusCode = 400; }
    res.end();
    return;
  }
  if (url.pathname === '/healthz') {
    res.setHeader('Content-Type', 'text/plain');
    res.end('ok');
    return;
  }
  if (url.pathname === '/token') {
    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    const id = url.searchParams.get('id');
    const name = url.searchParams.get('name') ?? '';
    const sid = url.searchParams.get('session') ?? '';
    res.setHeader('Content-Type', 'application/json');
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      res.end(JSON.stringify({ error: 'LiveKit が未設定です (.env)' }));
      return;
    }
    if (!id || !sessionIds.has(sid)) {
      res.end(JSON.stringify({ error: '不正なリクエストです' }));
      return;
    }
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: id, name, ttl: '12h' });
    at.addGrant({ roomJoin: true, room: livekitRoom(sid), canPublish: true, canSubscribe: true, canPublishData: true });
    res.end(JSON.stringify({ url: LIVEKIT_URL, token: await at.toJwt() }));
    return;
  }
  // dev 中は古い client/dist を出さない。手元のブラウザは Vite へ、トンネル越しには 5173 を案内する
  if (DEV) {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      res.writeHead(302, { Location: `http://localhost:5173${url.pathname}${url.search}` });
      res.end();
    } else {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('npm run dev 中です。トンネルは http://localhost:5173 に向けるか、npm start で起動して 3001 をトンネルしてください。');
    }
    return;
  }
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    res.end('client not built. run `npm run dev` and open http://localhost:5173');
    return;
  }
  if (file.endsWith('index.html')) {
    // OGP 用に、アクセスされたドメインの絶対 URL を埋める（Coolify の前段が付ける X-Forwarded-* を優先）
    const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0].trim();
    const origin = /^[\w.:[\]-]+$/.test(host) ? `${proto === 'https' ? 'https' : 'http'}://${host}` : '';
    res.setHeader('Content-Type', MIME['.html']);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(fs.readFileSync(file, 'utf-8').replaceAll('__ORIGIN__', origin));
    return;
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
  // assets/ はハッシュ付き。index.html は毎回取り直させる
  res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const state = { id: null as string | null };
  ws.on('message', (raw) => {
    try { handle(ws, state, JSON.parse(String(raw)) as ClientMsg); }
    catch (e) { console.error('bad message', e); }
  });
  ws.on('close', () => onClose(ws, state.id));
});

// 2D の人が他の人やアイテムと重なっていたら押し出す
setInterval(() => {
  let moved = false;
  for (const sid of sessionIds) {
    const here = [...users.values()].filter((u) => u.session === sid);
    if (here.some((u) => u.mode === '2d' && u.pos && !u.follow)) moved = pushApart2D(here, avatars.get(sid)!, items.get(sid)!.values(), (p) => clamp2d(sid, p)) || moved;
  }
  if (moved) broadcastUsers();
}, 200);

server.listen(PORT, () => {
  console.log(`server on http://localhost:${PORT}`);
  console.log(`sessions: ${guild.sessions.map((w) => w.name).join(' ')}`);
  if (!process.env.LIVEKIT_URL) console.warn('LIVEKIT_* が未設定: 音声・画面共有は無効になります');
});
