import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { AvatarState } from '../../../shared/protocol.ts';
import { get, set, heldHammer, nameOf } from '../store.ts';
import { send } from '../net/ws.ts';
import { selectNote, updateNote } from '../actions.ts';
import { dropHammer, hit, moveItem } from '../items/actions.ts';
import { bump } from '../items/effects.ts';
import { aimAt, carrying, clampRoom, EYE, type Interactable } from './interact.ts';
import { HammerModel } from './items3d.tsx';

const SPEED = 4;
const SENS = 0.0025;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/** 照準の先の物から、画面に出す説明を作る */
function hintFor(aim: { data: Interactable; hit: THREE.Intersection } | null): string | null {
  if (carrying.current) return 'クリック / G: ここに置く';
  if (!aim) return null;
  const s = get();
  if (heldHammer(s) && aim.data.hitTarget) {
    const t = typeof aim.data.hitTarget === 'function' ? aim.data.hitTarget(aim.hit) : aim.data.hitTarget;
    if (t && t !== s.selfId) return `クリック: ${nameOf(t)} を叩く`;
  }
  const parts = [aim.data.hint, aim.data.carry && 'G: 移動', aim.data.remove && 'X: 片付ける'].filter(Boolean);
  return parts.length ? parts.join(' ・ ') : null;
}

function finishCarry() {
  const c = carrying.current;
  if (!c) return;
  if (c.type === 'note') updateNote(c.id, { x: c.x, z: c.z, ry: c.ry });
  else moveItem(c.id, c.x, c.z, c.ry);
  carrying.current = null;
}

/** 一人称カメラ・移動・照準での操作 */
export function Player() {
  const { camera, gl, scene } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const look = useRef({ yaw: get().selfAvatar.ry, pitch: -0.05 });
  const sent = useRef({ t: 0, x: NaN, z: NaN, ry: NaN });
  const aim = useRef<ReturnType<typeof aimAt>>(null);
  const hammerRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const a = get().selfAvatar;
    camera.position.set(a.x, EYE, a.z);
    camera.rotation.order = 'YXZ';
    const canvas = gl.domElement;

    const onLock = () => {
      const locked = document.pointerLockElement === canvas;
      set({ locked });
      if (!locked) keys.current = {};
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement !== canvas) {
        // ロックしていないときのキャンバスのクリックは「操作開始」だけ
        if (e.target === canvas) { selectNote(null); void canvas.requestPointerLock(); }
        return;
      }
      use();
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
      if (e.code === 'KeyG') {
        if (carrying.current) finishCarry();
        else if (aim.current?.data.carry) {
          const { type, id } = aim.current.data.carry;
          carrying.current = { type, id, x: 0, z: 0, ry: 0, last: 0 };
        }
      }
      if (e.code === 'KeyQ') dropHammer();
      if (e.code === 'KeyX' && !carrying.current) aim.current?.data.remove?.();
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    const onBlur = () => { keys.current = {}; };

    document.addEventListener('pointerlockchange', onLock);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerlockchange', onLock);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      finishCarry();
      set({ locked: false, aimHint: null });
    };
  }, [camera, gl]);

  /** クリック: 持ち運び中なら置く。ハンマーを持っていれば叩く。それ以外は照準の先を操作 */
  function use() {
    if (carrying.current) { finishCarry(); return; }
    const s = get();
    const target = aim.current;
    if (heldHammer(s)) {
      set((st) => ({ swings: { ...st.swings, [s.selfId]: performance.now() } }));
      const ht = target?.data.hitTarget;
      const to = typeof ht === 'function' ? ht(target!.hit) : ht;
      if (to && to !== s.selfId && target!.hit.distance < 5) { hit(to); return; }
      if (!target?.data.use) return;
    }
    target?.data.use?.(target.hit);
  }

  // 開発時だけ: マウスロックできない環境（自動テストなど）から照準操作を試すための口
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
    const { yaw, pitch } = look.current;
    // 叩かれたら少し揺れる
    const shake = bump(s.hits[s.selfId]);
    camera.rotation.set(pitch - shake * 0.15, yaw + Math.sin(performance.now() / 30) * shake * 0.03, 0);
    camera.position.y = EYE - shake * 0.12;

    const k = keys.current;
    const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const r = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    if (f || r) {
      const step = (SPEED * Math.min(dt, 0.1)) / Math.hypot(f, r);
      camera.position.x = clampRoom(camera.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * r) * step);
      camera.position.z = clampRoom(camera.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * r) * step);
    }

    const now = performance.now();
    const x = camera.position.x;
    const z = camera.position.z;
    const st = sent.current;
    if (now - st.t > 100 && (Math.abs(x - st.x) > 0.01 || Math.abs(z - st.z) > 0.01 || Math.abs(yaw - st.ry) > 0.01)) {
      Object.assign(st, { t: now, x, z, ry: yaw });
      const a: AvatarState = { x, z, ry: yaw };
      set({ selfAvatar: a });
      send({ t: 'avatar', s: a });
    }

    // 持ち運び中の物は目の前 2m に置き、こちらを向ける
    const c = carrying.current;
    if (c) {
      c.x = clampRoom(x - Math.sin(yaw) * 2);
      c.z = clampRoom(z - Math.cos(yaw) * 2);
      c.ry = yaw;
      if (now - c.last > 80) {
        c.last = now;
        if (c.type === 'note') updateNote(c.id, { x: c.x, z: c.z, ry: c.ry });
        else moveItem(c.id, c.x, c.z, c.ry);
      }
    }

    aim.current = aimAt(scene, camera);
    const hint = hintFor(aim.current);
    if (hint !== s.aimHint) set({ aimHint: hint });

    // 手に持ったハンマー（画面右下）
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
    <group ref={hammerRef} userData={{ noRay: true }}>
      <HammerModel scale={0.38} />
    </group>
  );
}
