import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ANTIMATTER_CORE, ANTIMATTER_TOWERS, towerHeightFromLog, type AdLabSnapshot } from '../../../shared/antimatterLayout.ts';
import { subscribeAdFeedback } from '../ad/feedback.ts';
import { useAdReducedMotion } from '../ad/useAdReducedMotion.ts';

const PARTICLE_LIMIT = 192;
const SUCCESS_KINDS = new Set(['purchase', 'tickspeed', 'boost', 'galaxy', 'sacrifice', 'crunch']);

/** One bounded, reused point buffer. Coordinates belong to the lab's actual 3D space. */
export function AdPurchaseParticles3D({ snapshot }: { snapshot: AdLabSnapshot }) {
  const latest = useRef(snapshot);
  useEffect(() => { latest.current = snapshot; }, [snapshot]);
  const reduced = useAdReducedMotion();
  const system = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_LIMIT * 3);
    const colors = new Float32Array(PARTICLE_LIMIT * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({ size: 0.085, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    return {
      geometry, material, positions, colors,
      xyz: new Float32Array(PARTICLE_LIMIT * 3), velocity: new Float32Array(PARTICLE_LIMIT * 3),
      rgb: new Float32Array(PARTICLE_LIMIT * 3), life: new Float32Array(PARTICLE_LIMIT), cursor: 0, active: 0,
    };
  }, []);
  useEffect(() => () => { system.geometry.dispose(); system.material.dispose(); }, [system]);
  useEffect(() => {
    system.life.fill(0);
    system.active = 0;
    system.geometry.setDrawRange(0, 0);
    if (reduced) return;
    return subscribeAdFeedback((event) => {
      if (!SUCCESS_KINDS.has(event.kind)) return;
      const tier = event.kind === 'purchase' ? event.tier : undefined;
      const tower = Number.isInteger(tier) && tier! >= 1 && tier! <= 8 ? ANTIMATTER_TOWERS[tier! - 1] : undefined;
      const x = tower?.x ?? ANTIMATTER_CORE.x;
      const z = tower?.z ?? ANTIMATTER_CORE.z;
      const y = tower ? towerHeightFromLog(latest.current.dimensions[tier! - 1].amountLog10) + 0.55 : 0.65;
      const count = tower ? 24 : 36;
      const purple = event.kind === 'galaxy' || event.kind === 'crunch';
      for (let i = 0; i < count; i++) {
        const index = system.cursor;
        system.cursor = (index + 1) % PARTICLE_LIMIT;
        const offset = index * 3;
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.2;
        const speed = 0.7 + Math.random() * 1.2;
        system.xyz[offset] = x;
        system.xyz[offset + 1] = y;
        system.xyz[offset + 2] = z;
        system.velocity[offset] = Math.cos(angle) * speed;
        system.velocity[offset + 1] = 0.7 + Math.random() * 1.2;
        system.velocity[offset + 2] = Math.sin(angle) * speed;
        system.rgb[offset] = purple ? 0.85 : 0.4;
        system.rgb[offset + 1] = purple ? 0.45 : 1;
        system.rgb[offset + 2] = 1;
        if (system.life[index] <= 0) system.active++;
        system.life[index] = 0.65;
      }
    });
  }, [reduced, system]);
  useFrame((_, delta) => {
    if (reduced || system.active === 0) return;
    const dt = Math.min(delta, 0.1);
    let visible = 0;
    for (let i = 0; i < PARTICLE_LIMIT; i++) {
      if (system.life[i] <= 0) continue;
      system.life[i] -= dt;
      if (system.life[i] <= 0) continue;
      const offset = i * 3;
      const output = visible++ * 3;
      const fade = system.life[i] / 0.65;
      system.velocity[offset + 1] -= dt * 1.8;
      for (let axis = 0; axis < 3; axis++) {
        system.xyz[offset + axis] += system.velocity[offset + axis] * dt;
        system.positions[output + axis] = system.xyz[offset + axis];
        system.colors[output + axis] = system.rgb[offset + axis] * fade;
      }
    }
    system.geometry.setDrawRange(0, visible);
    system.active = visible;
    if (visible > 0) {
      system.geometry.getAttribute('position').needsUpdate = true;
      system.geometry.getAttribute('color').needsUpdate = true;
    }
  });
  return <points geometry={system.geometry} material={system.material} frustumCulled={false} userData={{ noRay: true }} />;
}
