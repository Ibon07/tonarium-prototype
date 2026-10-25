import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAMERA_DISTANCE, PlayerCamera } from './playerCamera.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function setup() {
  const rig = new PlayerCamera();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
  camera.rotation.order = 'YXZ';
  const scene = new THREE.Scene();
  const anchor = new THREE.Vector3(0, 1.5, 0);
  return { rig, camera, scene, anchor };
}
function wall(scene: THREE.Scene, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.1), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 1.5, z);
  scene.add(mesh);
  return mesh;
}

test('starts in first person; F5 prevents reload including repeats and toggles once per normal press', () => {
  const { rig } = setup();
  assert.equal(rig.thirdPerson, false);
  let prevented = 0;
  const press = (repeat = false, code = 'F5') => rig.keyDown({ code, repeat, preventDefault: () => prevented++ });
  press();
  assert.equal(rig.thirdPerson, true);
  press(true);
  assert.equal(rig.thirdPerson, true);
  press();
  assert.equal(rig.thirdPerson, false);
  assert.equal(prevented, 3);
  assert.equal(press(false, 'KeyW'), false);
  assert.equal(prevented, 3);
  assert.equal(new PlayerCamera().thirdPerson, false);
});

test('third person stays directly behind the view at several yaw and pitch angles, with no shoulder offset', () => {
  const { rig, camera, scene, anchor } = setup();
  rig.thirdPerson = true;
  for (const yaw of [0, Math.PI / 2, Math.PI, -1]) {
    for (const pitch of [-1.4, 0, 1.4]) {
      camera.rotation.set(pitch, yaw, 0);
      rig.place(camera, scene, anchor);
      const offset = camera.position.clone().sub(anchor);
      close(offset.length(), CAMERA_DISTANCE.initial);
      close(offset.x * Math.cos(yaw) - offset.z * Math.sin(yaw), 0);
      assert.ok(offset.x * Math.sin(yaw) + offset.z * Math.cos(yaw) > 0);
      close(offset.clone().normalize().dot(camera.getWorldDirection(new THREE.Vector3())), -1);
    }
  }
});

test('wheel respects desired-distance limits and does nothing in first person', () => {
  const { rig } = setup();
  rig.zoom(100);
  close(rig.desiredDistance, CAMERA_DISTANCE.initial);
  rig.thirdPerson = true;
  rig.zoom(100);
  close(rig.desiredDistance, CAMERA_DISTANCE.initial + CAMERA_DISTANCE.wheelStep);
  for (let i = 0; i < 100; i++) rig.zoom(100);
  close(rig.desiredDistance, CAMERA_DISTANCE.max);
  for (let i = 0; i < 100; i++) rig.zoom(-100);
  close(rig.desiredDistance, CAMERA_DISTANCE.min);
});

test('nearest obstacle wins regardless of scene order, even when noRay is set for interaction', () => {
  const { rig, camera, scene, anchor } = setup();
  rig.thirdPerson = true;
  wall(scene, 2.5);
  wall(scene, 1).userData.noRay = true;
  rig.place(camera, scene, anchor);
  close(rig.actualDistance, 0.95 - CAMERA_DISTANCE.margin);
  close(camera.position.z, rig.actualDistance);
  close(rig.desiredDistance, CAMERA_DISTANCE.initial);
});

test('ray uses world transforms and stops at the desired distance', () => {
  const { rig, camera, scene, anchor } = setup();
  rig.thirdPerson = true;
  const beyond = wall(scene, 5);
  rig.place(camera, scene, anchor);
  close(rig.actualDistance, rig.desiredDistance);
  scene.remove(beyond);
  const group = new THREE.Group();
  group.rotation.y = Math.PI / 2;
  group.add(wall(scene, 1));
  scene.add(group);
  camera.rotation.y = Math.PI / 2;
  rig.place(camera, scene, anchor);
  close(rig.actualDistance, 0.95 - CAMERA_DISTANCE.margin);
  close(camera.position.x, rig.actualDistance);
  close(camera.position.z, 0);
});

test('close obstacles override the minimum and disappearing obstacles restore the current desired distance', () => {
  const { rig, camera, scene, anchor } = setup();
  rig.thirdPerson = true;
  const obstacle = wall(scene, 0.2);
  rig.place(camera, scene, anchor);
  close(rig.actualDistance, 0);
  close(rig.desiredDistance, CAMERA_DISTANCE.initial);
  rig.zoom(1);
  rig.place(camera, scene, anchor);
  close(rig.actualDistance, 0);
  const desired = CAMERA_DISTANCE.initial + CAMERA_DISTANCE.wheelStep;
  close(rig.desiredDistance, desired);
  scene.remove(obstacle);
  rig.place(camera, scene, anchor);
  close(rig.actualDistance, desired);
});

test('self avatar collider, first-person models and hidden meshes do not obstruct the camera', () => {
  const { rig, camera, scene, anchor } = setup();
  rig.thirdPerson = true;
  const self = new THREE.Group();
  self.userData.selfBody = true;
  const collider = wall(scene, 0.3);
  self.add(collider);
  scene.add(self);
  wall(scene, 0.5).userData.firstPerson = true;
  wall(scene, 0.7).visible = false;
  const invisible = wall(scene, 0.9).material as THREE.MeshBasicMaterial;
  invisible.transparent = true;
  invisible.opacity = 0;
  rig.place(camera, scene, anchor);
  close(rig.actualDistance, rig.desiredDistance);
});

test('switching back restores the exact first-person position and rotation without changing player position', () => {
  const { rig, camera, scene, anchor } = setup();
  const original = anchor.clone();
  camera.rotation.set(0.4, 0.7, 0);
  const orientation = camera.quaternion.clone();
  rig.thirdPerson = true;
  rig.place(camera, scene, anchor);
  assert.ok(!camera.position.equals(anchor));
  assert.ok(anchor.equals(original));
  rig.thirdPerson = false;
  rig.place(camera, scene, anchor);
  assert.ok(camera.position.equals(original));
  assert.ok(camera.quaternion.equals(orientation));
  close(rig.actualDistance, 0);
  close(rig.desiredDistance, CAMERA_DISTANCE.initial);
});
