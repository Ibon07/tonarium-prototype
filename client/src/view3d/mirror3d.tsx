import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Item } from '../../../shared/items.ts';
import { removable, useFollow } from './itemHelpers.ts';
import { createMirrorSurface } from './mirrorReflection.ts';

export function MirrorModel() {
  const surface = useRef<THREE.Group>(null);
  useEffect(() => {
    const group = surface.current;
    if (!group) return;
    const resource = createMirrorSurface(1.8, 2.2);
    group.add(resource.mirror);
    return () => {
      group.remove(resource.mirror);
      resource.dispose();
    };
  }, []);
  return <group>
    <mesh position={[0, 1.3, -0.055]}>
      <boxGeometry args={[1.94, 2.34, 0.1]} />
      <meshStandardMaterial color="#354754" metalness={0.5} roughness={0.35} />
    </mesh>
    <group ref={surface} position={[0, 1.3, 0.001]} />
    {[-0.7, 0.7].map((x) => <mesh key={x} position={[x, 0.065, -0.06]}>
      <boxGeometry args={[0.16, 0.13, 0.7]} />
      <meshStandardMaterial color="#354754" />
    </mesh>)}
  </group>;
}

export function Mirror3D({ item }: { item: Extract<Item, { kind: 'mirror' }> }) {
  const ref = useRef<THREE.Group>(null);
  useFollow(ref, item.id, item.x, item.z, item.ry);
  return <group ref={ref} position={[item.x, 0, item.z]} rotation-y={item.ry} userData={removable(item)}>
    <MirrorModel />
  </group>;
}
