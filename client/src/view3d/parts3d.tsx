import { SPAWN } from '../../../shared/protocol.ts';

export type V3 = [number, number, number];

export function Box({ p, s, color, ry = 0, rough = 0.8 }: { p: V3; s: V3; color: string; ry?: number; rough?: number }) {
  return (
    <mesh position={p} rotation-y={ry}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} roughness={rough} />
    </mesh>
  );
}

export function Cyl({ p, r, h, color, r2 = r, seg = 24 }: { p: V3; r: number; h: number; color: string; r2?: number; seg?: number }) {
  return (
    <mesh position={p}>
      <cylinderGeometry args={[r, r2, h, seg]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  );
}

/** 入ってきた人が現れる丸いエリア */
export function SpawnArea({ color }: { color: string }) {
  return (
    <group position={[SPAWN.x, 0, SPAWN.z]} userData={{ noRay: true }}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.006}>
        <circleGeometry args={[SPAWN.r, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.008}>
        <ringGeometry args={[SPAWN.r - 0.06, SPAWN.r, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} />
      </mesh>
    </group>
  );
}

