import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GRAVITY, JUMP_V, type AvatarState } from '../../../shared/protocol.ts';
import { ARENA, FALL_Y, LAYER_Y, TILE_COUNT, TILE, inArena, startTile, tileBelow, tileCenter, tileGone } from '../../../shared/game.ts';
import { SURVIVOR_MOVE_SPEED, SURVIVOR_STYLES } from '../../../shared/survivor.ts';
import { get, set, useStore, heldHammer, heldCamera, nameOf, solidsOf, worldKindOf, gameOfSession, elevatorOfSession, serverNow, spawnPoint } from '../store.ts';
import { CAR, CITY_SURFACES, SHAFT_RECT, clampCity, elevatorY, type Surface } from '../../../shared/city.ts';
import { STEP_UP, carPose, cityGround, citySolids, keepInCar, toCarLocal } from './cityPhysics.ts';
import { pushOut } from '../../../shared/worlds.ts';
import { send } from '../net/ws.ts';
import { selectNote } from '../actions.ts';
import { dropCamera, dropHammer, hit, moveItem, place2d, toggleLive } from '../items/actions.ts';
import { bump } from '../items/effects.ts';
import { aimAt, aimOn, carrying, clampRoom, type Interactable } from './interact.ts';
import { useEyeHeight } from './eyeHeight.ts';
import { DEFAULT_EYE_HEIGHT } from '../../../shared/avatar.ts';
import { HammerModel } from './items3d.tsx';
import { takePhoto, world } from './cameraRender.ts';
import { CameraModel, cameraHelp } from './camera3d.tsx';
import { blocked, blockedByTrain, moveFlight, recoverPosition, type MovementMode } from './movement.ts';

const SPEED = 4;
const BODY_R = 0.3;

type Store = ReturnType<typeof get>;
const survivorPlaying = (s: Store) => {
  if (worldKindOf(s) !== 'survivors') return false;
  const phase = s.survivors[s.session ?? '']?.phase;
  return s.movementMode === 'walk' && (phase === 'running' || phase === 'boss');
};

/** (x, z) で足元 y から落ちたときに着く高さ。塔の上で下に板が無ければ null（落ち続ける）。car は街の電車の床 */
function groundAt(s: Store, x: number, z: number, y: number): { y: number; tile: number | null; car?: number | null } | null {
  if (worldKindOf(s) === 'city') return { ...cityGround(x, z, y, serverNow(), elevatorOfSession(s)), tile: null };
  if (worldKindOf(s) !== 'game' || !inArena(x, z)) return y >= -0.05 ? { y: 0, tile: null } : null;
  const t = tileBelow(gameOfSession(s), x, z, y, serverNow());
  return t ? { y: t.y, tile: t.i } : null;
}

/** 塔の上にいる間は塔の端から出られない（ロビーへはガラスで戻れない）。街は広い */
const clampTo = (onTower: boolean, city: boolean) => (onTower
  ? (v: number, c: number) => Math.max(c - ARENA.half + 0.25, Math.min(c + ARENA.half - 0.25, v))
  : city ? (v: number) => clampCity(v) : (v: number) => clampRoom(v));
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
  const eyeHeight = useEyeHeight();
  const { camera, gl, scene } = useThree();
  const survivorActive = useStore((s) => survivorPlaying(s));
  const heldCam = useStore((s) => heldCamera(s));
  const keys = useRef<Record<string, boolean>>({});
  const look = useRef({ yaw: get().selfAvatar.ry, pitch: -0.05 });
  // NaN だと比較が常に false になり一度も送られないので Infinity
  const sent = useRef({ t: 0, x: Infinity, z: Infinity, ry: Infinity, pitch: Infinity, jump: 0, y: 0 });
  // 足元の高さ・上下の速さ・跳んだ回数。stepped は最後に踏んだと伝えた板、round は塔の上に移ったゲームの回
  // car は街の電車に乗っている号車。乗っている間は毎フレーム電車が動いた分だけ一緒に動かす
  const body = useRef({ y: get().selfAvatar.y ?? 0, vy: 0, grounded: true, n: get().selfAvatar.jump ?? 0, stepped: -1, round: -1, survivorRun: -1, car: null as number | null });
  const aim = useRef<ReturnType<typeof aimAt>>(null);
  const previousMode = useRef<MovementMode>('walk');
  const syncAirHeight = useRef(false);
  const hammerRef = useRef<THREE.Group>(null);
  const cameraRef = useRef<THREE.Group>(null);
  const dragging = useRef<{ data: Interactable; obj: THREE.Object3D; hit: THREE.Intersection | null } | null>(null);

  useEffect(() => {
    if (survivorActive && document.pointerLockElement === gl.domElement) document.exitPointerLock();
  }, [survivorActive, gl]);

  useEffect(() => {
    const a = get().selfAvatar;
    camera.position.set(a.x, eyeHeight.current.current + (a.y ?? 0), a.z);
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
      if (survivorPlaying(get())) return;
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
      if (survivorPlaying(get())) return;
      look.current.yaw -= e.movementX * SENS;
      look.current.pitch = Math.max(-1.4, Math.min(1.4, look.current.pitch - e.movementY * SENS));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      keys.current[e.code] = true;
      if (e.code === 'Escape') selectNote(null);
      if (e.code === 'Space' && !survivorPlaying(get())) {
        e.preventDefault();
        const b = body.current;
        if (get().movementMode === 'walk' && b.grounded) { b.vy = JUMP_V; b.grounded = false; b.n++; }
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
      if (world.camera === camera) { world.camera = null; world.scene = null; }
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
      pos: (x: number, z: number, y?: number) => { camera.position.x = x; camera.position.z = z; if (y !== undefined) { body.current.y = y; body.current.vy = 0; } },
      key: (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code })),
      state: get,
    };
  });

  useFrame((_, dt) => {
    const eye = eyeHeight.current;
    eye.current += (eye.target - eye.current) * (1 - Math.exp(-dt / 0.2));
    const s = get();
    const b = body.current;
    const toLobby = () => {
      const p = spawnPoint();
      set({ teleport: p });
    };
    const g = gameOfSession(s);
    const survivorRun = s.survivors[s.session ?? ''];
    const survivorMe = survivorRun?.players[s.selfId];
    const survivorPaused = survivorRun?.pausedAt != null;
    if (worldKindOf(s) !== 'survivors') b.survivorRun = -1;
    if (survivorPlaying(s) && survivorMe && b.survivorRun !== survivorRun?.run) {
      b.survivorRun = survivorRun!.run;
      b.stepped = -1;
      set({ teleport: { x: survivorMe.x, z: survivorMe.z, ry: 0 } });
    }
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
      // 電車に乗ったまま飛ぶと、次のフレームで車内に引き戻されてしまう
      b.car = null;
      set({ teleport: null });
    }
    const city = worldKindOf(s) === 'city';
    const now0 = serverNow();
    const mode = s.movementMode;
    const solids = city ? citySolids(now0, elevatorOfSession(s)) : solidsOf(s);
    const surfaces: Surface[] = city ? [...CITY_SURFACES, { ...SHAFT_RECT, ya: elevatorY(elevatorOfSession(s), now0), yb: elevatorY(elevatorOfSession(s), now0) }] : [];
    if (worldKindOf(s) === 'game') {
      for (let i = 0; i < TILE_COUNT; i++) if (!tileGone(g, i, now0)) {
        const t = tileCenter(i);
        surfaces.push({ x0: t.x - TILE / 2, x1: t.x + TILE / 2, z0: t.z - TILE / 2, z1: t.z + TILE / 2, ya: t.y, yb: t.y });
      }
    }
    const valid = (p: { x: number; y: number; z: number }) => {
      const bounds = clampTo(worldKindOf(s) === 'game' && inArena(p.x, p.z), city);
      const height = Math.max(1.7, eye.current + 0.1);
      return bounds(p.x, ARENA.x) === p.x && bounds(p.z, ARENA.z) === p.z && !blocked(p, solids, surfaces, height) && !(city && blockedByTrain(p, now0, height));
    };
    if (mode !== previousMode.current || (tp && mode !== 'noclip') || (mode === 'fly' && !valid({ x: camera.position.x, y: b.y, z: camera.position.z }))) {
      syncAirHeight.current = mode === 'walk';
      b.vy = 0;
      b.grounded = false;
      b.car = null;
      if (mode !== 'noclip') {
        const spawn = spawnPoint();
        const safe = recoverPosition({ x: camera.position.x, y: b.y, z: camera.position.z }, { ...spawn, y: 0 }, solids, valid);
        if (safe) { camera.position.x = safe.x; camera.position.z = safe.z; b.y = safe.y; }
        else { set({ movementMode: 'noclip' }); previousMode.current = 'noclip'; return; }
      }
      previousMode.current = mode;
    }
    if (mode === 'walk' && city && b.car !== null) {
      // 電車に乗っていれば、前のフレームからの電車の動きと向きの変化をそのまま足す
      const prev = carPose(now0 - Math.min(dt, 0.1) * 1000, b.car);
      const cur = carPose(now0, b.car);
      const l = toCarLocal(prev, camera.position.x, camera.position.z);
      camera.position.x = cur.x + cur.ax * l.along + cur.nx * l.side;
      camera.position.z = cur.z + cur.az * l.along + cur.nz * l.side;
      look.current.yaw += Math.atan2(Math.sin(cur.ry - prev.ry), Math.cos(cur.ry - prev.ry));
    }
    const survivors = survivorPlaying(s);
    const { yaw: viewYaw, pitch } = look.current;
    const yaw = survivors ? 0 : viewYaw;
    const shake = bump(s.hits[s.selfId]);
    camera.rotation.set(pitch - shake * 0.15, yaw + Math.sin(performance.now() / 30) * shake * 0.03, 0);

    const k = keys.current;
    const f = survivorPaused ? 0 : (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const r = survivorPaused ? 0 : (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const onTower = worldKindOf(s) === 'game' && inArena(camera.position.x, camera.position.z);
    const cl = clampTo(onTower, city);
    if (mode !== 'walk') {
      b.vy = 0; b.grounded = false; b.car = null;
      const up = survivorPaused ? 0 : (k.Space ? 1 : 0) - (k.ShiftLeft || k.ShiftRight ? 1 : 0);
      const step = SPEED * Math.min(dt, 0.1) / (Math.hypot(f, r, up) || 1);
      const p = moveFlight({ x: camera.position.x, y: b.y, z: camera.position.z }, { x: (-Math.sin(yaw) * f + Math.cos(yaw) * r) * step, y: up * step, z: (-Math.cos(yaw) * f - Math.sin(yaw) * r) * step }, (p) => mode === 'fly' && !valid(p));
      camera.position.x = p.x; camera.position.z = p.z; b.y = p.y;
    } else if (f || r) {
      const survivorStyle = survivorMe ? SURVIVOR_STYLES[survivorMe.style] : undefined;
      const moveSpeed = survivors
        ? (survivorStyle?.speed ?? SURVIVOR_MOVE_SPEED) * (1 + (survivorMe?.gear.nightcloak ?? 0) * 0.025)
        : SPEED;
      const step = (moveSpeed * Math.min(dt, 0.1)) / Math.hypot(f, r);
      const nx = camera.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * r) * step;
      const nz = camera.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * r) * step;
      camera.position.x = cl(nx, ARENA.x);
      camera.position.z = cl(nz, ARENA.z);
    }
    // ワールドの切り替えやテレポートで家具の中に入ったときも、ここで外へ出る
    if (mode === 'walk' && solids.length && !onTower) {
      const p = pushOut(camera.position.x, camera.position.z, BODY_R, solids, b.y);
      camera.position.x = cl(p.x, 0);
      camera.position.z = cl(p.z, 0);
    }
    if (mode === 'walk' && city && b.car !== null) {
      const p = keepInCar(carPose(now0, b.car), camera.position.x, camera.position.z, now0);
      camera.position.x = p.x;
      camera.position.z = p.z;
    }

    // 先に横へ動かしてから、その場所の足元で上下を決める（板が消えた・端から出たときも落ちる）
    const fdt = Math.min(dt, 0.05);
    const ground = groundAt(s, camera.position.x, camera.position.z, b.y);
    // 坂・階段・上がっていくエレベーターでは足元に合わせて上がる
    if (mode === 'walk' && b.grounded && ground && ground.y > b.y && ground.y - b.y <= STEP_UP) b.y = ground.y;
    if (mode === 'walk' && b.grounded && (!ground || ground.y < b.y - 0.001)) b.grounded = false;
    if (mode === 'walk' && !b.grounded) {
      b.vy -= GRAVITY * fdt;
      b.y += b.vy * fdt;
      if (ground && b.vy <= 0 && b.y <= ground.y) { b.y = ground.y; b.vy = 0; b.grounded = true; }
    }
    if (b.grounded) syncAirHeight.current = false;
    b.car = city && b.grounded && ground?.car != null ? ground.car : city && b.car !== null && !b.grounded ? b.car : null;
    if (b.grounded && ground?.tile != null && ground.tile !== b.stepped && g.phase === 'running') {
      b.stepped = ground.tile;
      if (g.players.some((p) => p.id === s.selfId && p.out === null)) send({ t: 'gameStep', tile: ground.tile });
    }
    if (survivors) {
      camera.up.set(0, 0, -1);
      camera.position.set(camera.position.x, eye.current + (16 - DEFAULT_EYE_HEIGHT), camera.position.z);
      camera.lookAt(camera.position.x, 0, camera.position.z);
    } else {
      camera.up.set(0, 1, 0);
      camera.position.y = eye.current + b.y - shake * 0.12;
    }

    const now = performance.now();
    const x = camera.position.x;
    const z = camera.position.z;
    const st = sent.current;
    const jumped = b.n !== st.jump;
    // 塔の上・落ちている間・高い足場（街の上の階や駅）にいる間は高さも送る。
    // 床でのジャンプは回数だけ送り、相手の画面で放物線を描く（途中の高さを送るとカクつく）
    const sendY = mode !== 'walk' || syncAirHeight.current || onTower || b.y < -0.01 || (ground?.y ?? 0) > 0.01;
    const yNow = sendY ? b.y : undefined;
    const changed = Math.abs(x - st.x) > 0.01 || Math.abs(z - st.z) > 0.01 || Math.abs(yaw - st.ry) > 0.01
      || Math.abs(pitch - st.pitch) > 0.03 || (yNow ?? 0) !== st.y;
    const interval = 33;
    // 跳んだことは待たずに送る（相手の放物線が遅れて始まらないように）
    if (jumped || (now - st.t > interval && changed)) {
      Object.assign(st, { t: now, x, z, ry: yaw, pitch, jump: b.n, y: yNow ?? 0 });
      const cp = b.car !== null ? carPose(now0, b.car) : null;
      const l = cp ? toCarLocal(cp, x, z) : null;
      const ride = cp && l && b.car !== null ? { car: b.car, along: l.along, side: Math.max(-CAR.w, Math.min(CAR.w, l.side)), ry: yaw - cp.ry } : undefined;
      const a: AvatarState = { x, z, ry: yaw, pitch, jump: b.n, ...(yNow !== undefined ? { y: yNow } : {}), ...(ride ? { ride } : {}) };
      set({ selfAvatar: a });
      send({ t: 'avatar', s: a });
    }

    const c = carrying.current;
    if (c) {
      c.x = (city ? clampCity : clampRoom)(x - Math.sin(yaw) * 2);
      c.z = (city ? clampCity : clampRoom)(z - Math.cos(yaw) * 2);
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
    const heldCameraModel = cameraRef.current;
    if (heldCameraModel) {
      heldCameraModel.position.copy(camera.position);
      heldCameraModel.quaternion.copy(camera.quaternion);
      heldCameraModel.translateX(.26);
      heldCameraModel.translateY(-.3);
      heldCameraModel.translateZ(-.6);
    }
  });

  return (
    <>
      <group ref={hammerRef} userData={{ noRay: true, firstPerson: true }}>
        <HammerModel scale={0.38} />
      </group>
      {heldCam && <group ref={cameraRef} userData={{ noRay: true, firstPerson: true }}>
        <CameraModel live={heldCam.live} />
      </group>}
    </>
  );
}
