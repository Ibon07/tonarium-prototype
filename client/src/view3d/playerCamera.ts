import * as THREE from 'three';

export const CAMERA_DISTANCE = { initial: 3, min: 0.5, max: 6, wheelStep: 0.25, margin: 0.15 } as const;

export class PlayerCamera {
  thirdPerson = false;
  desiredDistance: number = CAMERA_DISTANCE.initial;
  actualDistance = 0;
  readonly avatarPosition = new THREE.Vector3();
  yaw = 0;
  private readonly direction = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();

  keyDown(e: Pick<KeyboardEvent, 'code' | 'repeat' | 'preventDefault'>) {
    if (e.code !== 'F5') return false;
    e.preventDefault();
    if (!e.repeat) this.thirdPerson = !this.thirdPerson;
    return true;
  }

  zoom(delta: number) {
    if (!this.thirdPerson || !delta) return;
    this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance + Math.sign(delta) * CAMERA_DISTANCE.wheelStep, CAMERA_DISTANCE.min, CAMERA_DISTANCE.max);
  }

  place(camera: THREE.Camera, scene: THREE.Scene, anchor: THREE.Vector3) {
    camera.position.copy(anchor);
    this.actualDistance = 0;
    if (!this.thirdPerson) { camera.updateMatrixWorld(); return; }
    this.direction.set(0, 0, 1).applyQuaternion(camera.quaternion);
    this.ray.set(anchor, this.direction);
    this.ray.near = 0;
    this.ray.far = this.desiredDistance;
    scene.updateMatrixWorld(true);
    this.actualDistance = this.desiredDistance;
    for (const hit of this.ray.intersectObjects(scene.children, true)) {
      if (!(hit.object as THREE.Mesh).isMesh) continue;
      let skip = false;
      // noRay は電車の壁にも使うため、カメラ用の除外条件にはしない。
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (!o.visible || o.userData.selfBody || o.userData.firstPerson) { skip = true; break; }
      }
      const materials = (hit.object as THREE.Mesh).material;
      if ((Array.isArray(materials) ? materials : [materials]).every(m => !m.visible || (m.transparent && m.opacity === 0))) skip = true;
      if (skip) continue;
      // 近い壁では希望距離の下限よりも、壁の手前に収まることを優先する。
      this.actualDistance = Math.max(0, hit.distance - CAMERA_DISTANCE.margin);
      break;
    }
    camera.position.addScaledVector(this.direction, this.actualDistance);
    camera.updateMatrixWorld();
  }
}
