// カメラアイテムの「視点」を描く。撮影と配信のどちらも、メインとは別の WebGLRenderer で同じシーンを描く。
import * as THREE from 'three';
import type { Item } from '../../../shared/items.ts';
import { get, set } from '../store.ts';
import { postImage } from '../items/actions.ts';
import { playShutter } from '../items/effects.ts';

/** Player が持っているシーンとメインカメラ */
export const world = { scene: null as THREE.Scene | null, camera: null as THREE.PerspectiveCamera | null, pitch: 0 };
/** カメラの見た目（自分自身が写り込まないよう、そのカメラから描くときは隠す） */
export const cameraModels = new Map<string, THREE.Object3D>();
/** 自分が配信中のカメラの映像（3D のモニターに使う） */
export const localFeeds = new Map<string, HTMLCanvasElement>();

export const CAM_Y = 1.5;

/** カメラアイテムの視点。自分が持っているなら自分の目線、置いてあるなら三脚の向き */
export function cameraPose(item: Item & { kind: 'camera' }) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  if (item.holder === get().selfId && world.camera) {
    pos.copy(world.camera.position);
    quat.copy(world.camera.quaternion);
  } else {
    pos.set(item.x, CAM_Y, item.z);
    quat.setFromEuler(new THREE.Euler(item.pitch, item.ry, 0, 'YXZ'));
  }
  return { pos, quat };
}

const viewCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);

/** 指定のレンダラーにカメラアイテムの視点を描く */
export function renderCamera(renderer: THREE.WebGLRenderer, item: Item & { kind: 'camera' }) {
  const { scene } = world;
  if (!scene) return;
  const { pos, quat } = cameraPose(item);
  viewCam.position.copy(pos);
  viewCam.quaternion.copy(quat);
  viewCam.aspect = renderer.domElement.width / renderer.domElement.height;
  viewCam.updateProjectionMatrix();
  // 写す側のカメラ自身と、手に持ったハンマーなど一人称の物は隠す
  const hidden: THREE.Object3D[] = [];
  const model = cameraModels.get(item.id);
  if (model?.visible) { model.visible = false; hidden.push(model); }
  scene.traverse((o) => { if (o.userData.firstPerson && o.visible) { o.visible = false; hidden.push(o); } });
  renderer.render(scene, viewCam);
  for (const o of hidden) o.visible = true;
}

export function makeRenderer(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

let photoRenderer: THREE.WebGLRenderer | null = null;

/** 撮影してセッションのチャットに投稿する */
export function takePhoto(item: Item & { kind: 'camera' }) {
  photoRenderer ??= makeRenderer(1280, 720);
  renderCamera(photoRenderer, item);
  postImage('📷 撮影しました', photoRenderer.domElement.toDataURL('image/jpeg', 0.85));
  playShutter();
  set({ flashAt: performance.now() });
}
