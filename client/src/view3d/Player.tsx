import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GRAVITY, JUMP_V, type AvatarState } from '../../../shared/protocol.ts';
import { ARENA, FALL_Y, LAYER_Y, inArena, startTile, tileBelow, tileCenter } from '../../../shared/game.ts';
import { get, set, heldHammer, heldCamera, nameOf, solidsOf, worldKindOf, gameOfSession, serverNow, spawnPoint } from '../store.ts';
import { pushOut } from '../../../shared/worlds.ts';
import { send } from '../net/ws.ts';
import { selectNote } from '../actions.ts';
import { dropCamera, dropHammer, hit, moveItem, place2d, toggleLive } from '../items/actions.ts';
import { bump } from '../items/effects.ts';
import { aimAt, aimOn, carrying, clampRoom, EYE, type Interactable } from './interact.ts';
import { HammerModel } from './items3d.tsx';
import { takePhoto, world } from './cameraRender.ts';
import { cameraHelp } from './camera3d.tsx';

const SPEED = 4;
const BODY_R = 0.3;

type Store = ReturnType<typeof get>;

/** (x, z) で足元 y から落ちたときに着く高さ。塔の上で下に板が無ければ null（落ち続ける） */
function groundAt(s: Store, x: number, z: number, y: number): { y: number; tile: number | null } | null {
  if (worldKindOf(s) !== 'game' || !inArena(x, z)) return y >= -0.05 ? { y: 0, tile: null } : null;
  const t = tileBelow(gameOfSession(s), x, z, y, serverNow());
  return t ? { y: t.y, tile: t.i } : null;
}

/** 塔の上にいる間は塔の端から出られない（ロビーへはガラスで戻れない） */
const clampTo = (onTower: boolean) => (onTower
  ? (v: number, c: number) => Math.max(c - ARENA.half + 0.25, Math.min(c + ARENA.half - 0.25, v))
  : (v: number) => clampRoom(v));
const SENS = 0.0025;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

function hintFor(aim: { data: Interactable; hit: THREE.Intersection } | null): string | null {
  if (carrying.current) return '右クリック: ここに置く';
  const s = get();
  const cam = heldCamera(s);
  if (cam) return cameraHelp(cam);
  if (!aim) return null;
  if (heldHammer(s) && aim.data.hitTarget) {
    const t = typeof aim.data.hitTarget === 'function' ? aim.data.hitTarget(aim.hit) : aim.data.hitTarget;
    if (t && t !== s.selfId) return `クリック: ${nameOf(t)} を叩く`;
  }
  const parts = [aim.data.hint, aim.data.carry && '右クリック: 運ぶ', aim.data.remove && 'X: 片付ける'].filter(Boolean);
  return parts.length ? parts.join(' ・ ') : null;
}

/** `user:<ID>` は 2D の人の立ち姿、`display:<ID>` はその人の配信ディスプレイ */
function sendCarry(c: { id: string; x: number; z: number; ry: number }) {
  // 立ち姿の前は -Z なので、運ぶ人の方を向けるには +180°
  if (c.id.startsWith('user:')) place2d(c.id.slice(5), { x: c.x, z: c.z, ry: c.ry + Math.PI });
  else if (c.id.startsWith('display:')) send({ t: 'displayMove', target: c.id.slice(8), x: c.x, z: c.z, ry: c.ry });
  else moveItem(c.id, c.x, c.z, c.ry);
}

function finishCarry() {
  const c = carrying.current;
  if (!c) return;
  sendCarry(c);
  carrying.current = null;
}

export function Player() {
  const { camera, gl, scene } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const look = useRef({ yaw: get().selfAvatar.ry, pitch: -0.05 });
  // NaN だと比較が常に false になり一度も送られないので Infinity
  const sent = useRef({ t: 0, x: Infinity, z: Infinity, ry: Infinity, pitch: Infinity, jump: 0, y: 0 });
  // 足元の高さ・上下の速さ・跳んだ回数。stepped は最後に踏んだと伝えた板、round は塔の上に移ったゲームの回
  const body = useRef({ y: get().selfAvatar.y ?? 0, vy: 0, grounded: true, n: get().selfAvatar.jump ?? 0, stepped: -1, round: -1 });
  const aim = useRef<ReturnType<typeof aimAt>>(null);
  const hammerRef = useRef<THREE.Group>(null);
  const dragging = useRef<{ data: Interactable; obj: THREE.Object3D; hit: THREE.Intersection | null } | null>(null);

  useEffect(() => {
    const a = get().selfAvatar;
    camera.position.set(a.x, EYE, a.z);
    camera.rotation.order = 'YXZ';
    world.scene = scene;
    world.camera = camera as THREE.PerspectiveCamera;
    const canvas = gl.domElement;

    const onLock = () => {
      const locked = document.pointerLockElement === canvas;
      set({ locked });
      if (!locked) keys.current = {};
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        if (document.pointerLockElement !== canvas) return;
        if (carrying.current) finishCarry();
        else if (aim.current?.data.carry) carrying.current = { id: aim.current.data.carry, x: 0, z: 0, ry: 0, last: 0 };
        return;
      }
      if (e.button !== 0) return;
      if (document.pointerLockElement !== canvas) {
        // ロック前のクリックは操作開始だけ
        if (e.target === canvas) { selectNote(null); void canvas.requestPointerLock(); }
        return;
      }
      use();
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0 || !dragging.current) return;
      dragging.current.data.drag!('end', dragging.current.hit);
      dragging.current = null;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      look.current.yaw -= e.movementX * SENS;
      look.current.pitch = Math.max(-1.4, Math.min(1.4, look.current.pitch - e.movementY * SENS));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      keys.current[e.code] = true;
      if (e.code === 'Escape') selectNote(null);
      if (e.code === 'Space') {
        e.preventDefault();
        const b = body.current;
        if (b.grounded) { b.vy = JUMP_V; b.grounded = false; b.n++; }
      }
      if (e.code === 'KeyQ') { dropHammer(); dropCamera(look.current.pitch); }
      const aimedCam = () => {
        const id = aim.current?.data.carry;
        const it = id ? get().items[id] : undefined;
        return it?.kind === 'camera' ? it : undefined;
      };
      if (e.code === 'KeyL') { const c = heldCamera(get()) ?? aimedCam(); if (c) toggleLive(c.id); }
      if (e.code === 'KeyC') { const c = aimedCam(); if (c) takePhoto(c); }
      if (e.code === 'KeyX' && !carrying.current) aim.current?.data.remove?.();
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    const onBlur = () => { keys.current = {}; };

    document.addEventListener('pointerlockchange', onLock);
    // 右クリックは運ぶ操作に使うので、ロック中はメニューを出さない
    const onContextMenu = (e: MouseEvent) => { if (document.pointerLockElement === canvas) e.preventDefault(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerlockchange', onLock);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      finishCarry();
      set({ locked: false, aimHint: null });
    };
  }, [camera, gl]);

  function use() {
    if (carrying.current) { finishCarry(); return; }
    const s = get();
    const target = aim.current;
    const cam = heldCamera(s);
    if (cam) { takePhoto(cam); return; }
    if (heldHammer(s)) {
      set((st) => ({ swings: { ...st.swings, [s.selfId]: performance.now() } }));
      const ht = target?.data.hitTarget;
      const to = typeof ht === 'function' ? ht(target!.hit) : ht;
      if (to && to !== s.selfId && target!.hit.distance < 5) { hit(to); return; }
      if (!target?.data.use && !target?.data.drag) return;
    }
    if (target?.data.drag) {
      dragging.current = { data: target.data, obj: target.obj, hit: target.hit };
      target.data.drag('start', target.hit);
      return;
    }
    target?.data.use?.(target.hit);
  }

  // 開発時のテスト用（マウスロックできない環境から操作する）
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__t3d = {
      use,
      look: (yaw: number, pitch: number) => { look.current = { yaw, pitch }; },
      pos: (x: number, z: number) => { camera.position.x = x; camera.position.z = z; },
      key: (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code })),
      state: get,
    };
  });

  useFrame((_, dt) => {
    const s = get();
    const b = body.current;
    const toLobby = () => {
      const p = spawnPoint();
      set({ teleport: p });
    };
    const g = gameOfSession(s);
    if (worldKindOf(s) === 'game') {
      const meIdx = g.players.findIndex((p) => p.id === s.selfId && p.out === null);
      // ゲームが始まったら参加者は最上段の自分の板へ
      if (g.phase === 'running' && meIdx >= 0 && b.round !== g.round) {
        b.round = g.round;
        b.stepped = -1;
        const c = tileCenter(startTile(meIdx));
        set({ teleport: { x: c.x, z: c.z, ry: Math.atan2(c.x - ARENA.x, c.z - ARENA.z), y: LAYER_Y[0] } });
      }
      // 次のゲームを待つ間に塔に残っていたら（勝った人）ロビーへ
      if (g.phase === 'idle' && inArena(camera.position.x, camera.position.z) && !s.teleport) toLobby();
      if (b.y < FALL_Y) {
        if (meIdx >= 0) send({ t: 'gameFell' });
        toLobby();
      }
    }
    const tp = get().teleport;
    if (tp) {
      camera.position.x = tp.x;
      camera.position.z = tp.z;
      look.current.yaw = tp.ry;
      b.y = tp.y ?? 0;
      b.vy = 0;
      b.grounded = false;
      set({ teleport: null });
    }
    const { yaw, pitch } = look.current;
    const shake = bump(s.hits[s.selfId]);
    camera.rotation.set(pitch - shake * 0.15, yaw + Math.sin(performance.now() / 30) * shake * 0.03, 0);

    const k = keys.current;
    const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const r = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const onTower = worldKindOf(s) === 'game' && inArena(camera.position.x, camera.position.z);
    const cl = clampTo(onTower);
    if (f || r) {
      const step = (SPEED * Math.min(dt, 0.1)) / Math.hypot(f, r);
      camera.position.x = cl(camera.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * r) * step, ARENA.x);
      camera.position.z = cl(camera.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * r) * step, ARENA.z);
    }
    // ワールドの切り替えやテレポートで家具の中に入ったときも、ここで外へ出る
    const solids = solidsOf(s);
    if (solids.length && !onTower) {
      const p = pushOut(camera.position.x, camera.position.z, BODY_R, solids);
      camera.position.x = clampRoom(p.x);
      camera.position.z = clampRoom(p.z);
    }

    // 先に横へ動かしてから、その場所の足元で上下を決める（板が消えた・端から出たときも落ちる）
    const fdt = Math.min(dt, 0.05);
    const ground = groundAt(s, camera.position.x, camera.position.z, b.y);
    if (b.grounded && (!ground || ground.y < b.y - 0.001)) b.grounded = false;
    if (!b.grounded) {
      b.vy -= GRAVITY * fdt;
      b.y += b.vy * fdt;
      if (ground && b.vy <= 0 && b.y <= ground.y) { b.y = ground.y; b.vy = 0; b.grounded = true; }
    }
    if (b.grounded && ground?.tile != null && ground.tile !== b.stepped && g.phase === 'running') {
      b.stepped = ground.tile;
      if (g.players.some((p) => p.id === s.selfId && p.out === null)) send({ t: 'gameStep', tile: ground.tile });
    }
    camera.position.y = EYE + b.y - shake * 0.12;

    const now = performance.now();
    const x = camera.position.x;
    const z = camera.position.z;
    const st = sent.current;
    const jumped = b.n !== st.jump;
    // 塔の上や落ちている間は高さも送る。床でのジャンプは回数だけ送り、相手の画面で放物線を描く
    const sendY = onTower || b.y < -0.01;
    const yNow = sendY ? b.y : undefined;
    const changed = Math.abs(x - st.x) > 0.01 || Math.abs(z - st.z) > 0.01 || Math.abs(yaw - st.ry) > 0.01
      || Math.abs(pitch - st.pitch) > 0.03 || (yNow ?? 0) !== st.y;
    const interval = sendY && !b.grounded ? 50 : 100;
    // 跳んだことは待たずに送る（相手の放物線が遅れて始まらないように）
    if (jumped || (now - st.t > interval && changed)) {
      Object.assign(st, { t: now, x, z, ry: yaw, pitch, jump: b.n, y: yNow ?? 0 });
      const a: AvatarState = { x, z, ry: yaw, pitch, jump: b.n, ...(yNow !== undefined ? { y: yNow } : {}) };
      set({ selfAvatar: a });
      send({ t: 'avatar', s: a });
    }

    const c = carrying.current;
    if (c) {
      c.x = clampRoom(x - Math.sin(yaw) * 2);
      c.z = clampRoom(z - Math.cos(yaw) * 2);
      c.ry = yaw;
      if (now - c.last > 80) {
        c.last = now;
        sendCarry(c);
      }
    }

    const d = dragging.current;
    if (d) {
      const h = aimOn(d.obj, camera);
      if (h) { d.hit = h; d.data.drag!('move', h); }
    }

    aim.current = aimAt(scene, camera);
    const hint = hintFor(aim.current);
    if (hint !== s.aimHint) set({ aimHint: hint });

    const h = hammerRef.current;
    if (h) {
      h.visible = !!heldHammer(s);
      const sw = bump(s.swings[s.selfId], now, 350);
      h.position.copy(camera.position);
      h.quaternion.copy(camera.quaternion);
      h.translateX(0.26);
      h.translateY(-0.3);
      h.translateZ(-0.6);
      h.rotateX(-0.3 - sw * 1.5);
      h.rotateZ(0.15);
    }
  });

  return (
    <group ref={hammerRef} userData={{ noRay: true, firstPerson: true }}>
      <HammerModel scale={0.38} />
    </group>
  );
}
