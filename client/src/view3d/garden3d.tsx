import { Sky } from '@react-three/drei';
import { GARDEN } from '../../../shared/worlds.ts';
import { useStore } from '../store.ts';
import { Box, Cyl } from './parts3d.tsx';

function Tree({ x, z, r, h, canopy, color }: (typeof GARDEN.trees)[number]) {
  return (
    <group position={[x, 0, z]}>
      <Cyl p={[0, h / 2, 0]} r={r} h={h} color="#74523b" seg={12} />
      <group userData={{ noRay: true }}>
        <mesh position={[0, h + canopy * 0.6, 0]} scale={[1, 0.85, 1]}>
          <icosahedronGeometry args={[canopy, 1]} />
          <meshStandardMaterial color={color} roughness={1} flatShading />
        </mesh>
        <mesh position={[canopy * 0.22, h + canopy * 1.1, -canopy * 0.1]}>
          <icosahedronGeometry args={[canopy * 0.65, 1]} />
          <meshStandardMaterial color={color} roughness={1} flatShading />
        </mesh>
      </group>
    </group>
  );
}

function Bench({ x, z, w, d, facing }: (typeof GARDEN.benches)[number]) {
  return (
    <group position={[x, 0, z]} rotation-y={facing === 1 ? 0 : Math.PI}>
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box p={[side * (w / 2 - 0.2), 0.24, 0]} s={[0.12, 0.48, d * 0.8]} color="#384d43" />
          <Box p={[side * (w / 2 - 0.2), 0.72, -d / 2 + 0.07]} s={[0.1, 0.65, 0.1]} color="#384d43" />
        </group>
      ))}
      {[-1, 0, 1].map((slat) => (
        <Box key={slat} p={[0, 0.52, slat * d / 3]} s={[w, 0.14, d / 3 - 0.02]} color="#b88752" rough={0.9} />
      ))}
      {[0.82, 1.06].map((y) => (
        <Box key={y} p={[0, y, -d / 2 + 0.07]} s={[w, 0.2, 0.12]} color="#bd905c" rough={0.9} />
      ))}
    </group>
  );
}

function Path({ x, z, w, d }: (typeof GARDEN.paths)[number]) {
  return (
    <mesh position={[x, 0.003, z]} rotation-x={-Math.PI / 2} userData={{ noRay: true }}>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color="#d6cfb6" roughness={1} />
    </mesh>
  );
}

function FlowerBed({ x, z, w, d, color }: (typeof GARDEN.beds)[number]) {
  return (
    <group position={[x, 0, z]}>
      <Box p={[0, 0.21, 0]} s={[w, 0.42, d]} color="#ddd6c2" />
      <Box p={[0, 0.421, 0]} s={[w - 0.18, 0.025, d - 0.18]} color="#65533e" rough={1} />
      <group userData={{ noRay: true }}>
        {[-1, 1].flatMap((side) => [-1, 0, 1].map((row) => (
          <group key={`${side},${row}`} position={[side * w * 0.22, 0.44, row * d * 0.3]}>
            <Cyl p={[0, 0.12, 0]} r={0.018} h={0.24} color="#4d7545" seg={6} />
            <mesh position={[0.045, 0.1, 0]} scale={[1, 0.35, 0.6]}>
              <sphereGeometry args={[0.085, 8, 6]} />
              <meshStandardMaterial color="#67935a" roughness={1} />
            </mesh>
            <mesh position={[0, 0.25, 0]}>
              <icosahedronGeometry args={[0.115, 1]} />
              <meshStandardMaterial color={color} roughness={0.9} flatShading />
            </mesh>
            <mesh position={[0, 0.34, 0]}>
              <sphereGeometry args={[0.043, 8, 6]} />
              <meshStandardMaterial color="#f4d379" roughness={0.9} />
            </mesh>
          </group>
        )))}
      </group>
    </group>
  );
}

function GardenLamp({ x, z, r, h, lit }: (typeof GARDEN.lamps)[number] & { lit: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <Cyl p={[0, 0.08, 0]} r={r} h={0.16} color="#475b4f" seg={12} />
      <Cyl p={[0, h / 2, 0]} r={r * 0.3} h={h} color="#475b4f" seg={10} />
      <Cyl p={[0, h - 0.28, 0]} r={r * 0.9} h={0.06} color="#384d43" seg={12} />
      <mesh position={[0, h - 0.12, 0]} userData={{ noRay: true }}>
        <cylinderGeometry args={[r * 0.65, r * 0.65, 0.26, 10]} />
        <meshStandardMaterial color="#fff0ca" emissive="#ffd382" emissiveIntensity={0.65} roughness={0.35} />
      </mesh>
      <Cyl p={[0, h + 0.04, 0]} r={r} r2={r * 1.2} h={0.08} color="#384d43" seg={12} />
      {lit && <pointLight position={[0, h - 0.12, 0]} color="#ffdaa0" intensity={1.2} distance={4} decay={2} />}
    </group>
  );
}

export function GardenWorld({ map = false }: { map?: boolean }) {
  const lightweight = useStore((s) => s.lightweight);
  return (
    <>
      <ambientLight intensity={0.65} />
      <hemisphereLight args={['#e4f2ff', '#698555', 0.95]} />
      <directionalLight position={[12, 15, -8]} color="#fff2da" intensity={1.25} />
      {!map && <group userData={{ noRay: true }}><Sky distance={450} sunPosition={[12, 15, -8]} turbidity={2} rayleigh={0.5} /></group>}
      {GARDEN.paths.map((path) => <Path key={`${path.x},${path.z}`} {...path} />)}
      {GARDEN.trees.map((tree) => <Tree key={`${tree.x},${tree.z}`} {...tree} />)}
      {GARDEN.benches.map((bench) => <Bench key={`${bench.x},${bench.z}`} {...bench} />)}
      {GARDEN.beds.map((bed) => <FlowerBed key={`${bed.x},${bed.z}`} {...bed} />)}
      {GARDEN.lamps.map((lamp, i) => <GardenLamp key={`${lamp.x},${lamp.z}`} {...lamp} lit={!map && !lightweight && i < 2} />)}
    </>
  );
}
