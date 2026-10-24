// Three.jsと同じ頂点・法線をUnityへ渡す。戦闘用の独自形状は作らない。
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const geometries = {
  cone3: new THREE.ConeGeometry(1, 2.2, 3).toNonIndexed(),
  cone6: new THREE.ConeGeometry(1, 2.2, 6).toNonIndexed(),
  enemyBox: new THREE.BoxGeometry(1.7, 1.9, 1.2).toNonIndexed(),
  wispHalo: new THREE.TorusGeometry(.43, .025, 6, 24).toNonIndexed(),
  head: new THREE.SphereGeometry(1, 12, 8).toNonIndexed(),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodeca1: new THREE.DodecahedronGeometry(1, 1),
  octa0: new THREE.OctahedronGeometry(1, 0),
  octa1: new THREE.OctahedronGeometry(1, 1),
};
const result = Object.fromEntries(Object.entries(geometries).map(([name, geometry]) => [name, {
  positions: Array.from(geometry.attributes.position.array),
  normals: Array.from(geometry.attributes.normal.array),
}]));
fs.writeFileSync(path.resolve(__dirname, '../Assets/Resources/Web/SurvivorMeshes.json'), JSON.stringify(result));
