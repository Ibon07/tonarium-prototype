// 3D の操作は FPS 風: マウスをロックし、画面中央の照準が指すものに対して操作する。
// 操作できる物体は Object3D.userData に下の Interactable を持たせる（親をたどって探す）。
import * as THREE from 'three';
import { ROOM_HALF } from '../../../shared/protocol.ts';

export interface Interactable {
  /** クリックしたとき */
  use?: (hit: THREE.Intersection) => void;
  /** 照準を合わせたときの説明 */
  hint?: string;
  /** G キーで持ち運べるアイテムのID */
  carry?: string;
  /** X キーで片付ける */
  remove?: () => void;
  /** ハンマーで叩ける相手（ユーザーID）。2D参加者ボードのように当たった位置で決まる場合は関数 */
  hitTarget?: string | ((hit: THREE.Intersection) => string | null);
  /** 照準の判定から外す（手に持ったハンマーなど） */
  noRay?: boolean;
}

export const EYE = 1.6;
const LIMIT = ROOM_HALF - 0.5;
export const clampRoom = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v));

/** 持ち運び中の物（位置は手元で即時に動かし、間引いてサーバーへ送る） */
export const carrying = {
  current: null as null | { id: string; x: number; z: number; ry: number; last: number },
};

export function findInteractable(obj: THREE.Object3D | null): { data: Interactable; obj: THREE.Object3D } | null {
  for (let o = obj; o; o = o.parent) {
    const d = o.userData as Interactable;
    if (d.noRay) return null;
    if (d.use || d.carry || d.remove || d.hitTarget) return { data: d, obj: o };
  }
  return null;
}

const raycaster = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);

/** 照準（画面中央）の先にある、最も近い物 */
export function aimAt(scene: THREE.Scene, camera: THREE.Camera) {
  raycaster.setFromCamera(CENTER, camera);
  raycaster.far = 30;
  for (const hit of raycaster.intersectObjects(scene.children, true)) {
    if (!(hit.object as THREE.Mesh).isMesh) continue;
    let skip = false;
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if ((o.userData as Interactable).noRay) { skip = true; break; }
    if (skip) continue;
    // 最初に当たった物が操作対象でなければ（壁など）、照準の先には何もない
    const found = findInteractable(hit.object);
    return found ? { ...found, hit } : null;
  }
  return null;
}
