// antimatter ワールドの 3D オブジェクト群。既存ファイルは触らず、親が WorldMesh へ分岐追加する。
// drei の Html は使わない。Label.tsx の注記どおり、3D 参加直後の分が空になり撮影にも写らないうえ、
// ポインターロック中は DOM をマウスで直接操作できないため。代わりに、空間内は CanvasTexture の
// ボード（撮影にも写る・遮蔽も 3D 通り）で示し、操作は照準＋クリックで前面パネルを開く方式にする。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ANTIMATTER_ALTAR, ANTIMATTER_CORE, ANTIMATTER_EXHIBITS, ANTIMATTER_PALETTE, ANTIMATTER_PORTAL,
  ANTIMATTER_TOWERS, DIMENSION_TARGETS, clampLog, lodForDistance, particleCountFromLog,
  ringSpeedFromBought, streamOpacityFromLog, towerHeightFromLog,
  type AdDioramaView, type AdLabSnapshot, type AdLod, type AdPanelTarget,
} from '../../../shared/antimatterLayout.ts';
import { Box, Cyl, SpawnArea } from './parts3d.tsx';
import { Label } from './Label.tsx';
import { PanelBoard } from './antimatterPanels.tsx';
import { AntimatterReadout } from './AntimatterReadout.tsx';
import { AdPurchaseParticles3D } from './AdPurchaseParticles3D.tsx';
import { DimensionReactor3D } from './DimensionReactor3D.tsx';

export type Origin = [number, number];

/** カメラと研究所中心の距離から詳細度を決める。変わったときだけ React を起こす */
export function useAntimatterLod(origin: Origin): AdLod {
  const [lod, setLod] = useState<AdLod>('full');
  useFrame(({ camera }) => {
    const d = Math.hypot(camera.position.x - (origin[0] + ANTIMATTER_CORE.x), camera.position.z - (origin[1] + ANTIMATTER_CORE.z));
    const next = lodForDistance(d);
    if (next !== lod) setLod(next);
  });
  return lod;
}

type OpenPanel = (target: AdPanelTarget) => void;

function LabShell({ origin }: { origin: Origin }) {
  const pal = ANTIMATTER_PALETTE;
  return (
    <group position={[origin[0], 0, origin[1]]}>
      <ambientLight intensity={0.9} color="#cdd8ff" />
      <directionalLight position={[5, 10, 5]} intensity={0.9} color="#dfe8ff" />
      <mesh rotation-x={-Math.PI / 2} userData={{ noRay: true }}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color={pal.floor} roughness={0.85} />
      </mesh>
      <gridHelper args={[20, 20, '#3a3f66', '#2a2e4d']} position-y={0.005} userData={{ noRay: true }} />
      <Box p={[0, 2, -10]} s={[20, 4, 0.2]} color={pal.wall} />
      <Box p={[0, 2, 10]} s={[20, 4, 0.2]} color={pal.wall} />
      <Box p={[-10, 2, 0]} s={[0.2, 4, 20]} color={pal.wall} />
      <Box p={[10, 2, 0]} s={[0.2, 4, 20]} color={pal.wall} />
      {origin[0] === 0 && origin[1] === 0 && <SpawnArea color={pal.spawn} />}
    </group>
  );
}

const PARTICLE_MAX = 300;

/** 中央コアの粒子噴水。粒子数は log の飽和関数で決め、量に比例させない */
function CoreFountain({ log10, bought }: { log10: number; bought: number }) {
  const points = useRef<THREE.Points>(null);
  const ring = useRef<THREE.Group>(null);
  const logRef = useRef(log10);
  useEffect(() => { logRef.current = log10; }, [log10]);
  const { geo, seeds } = useMemo(() => {
    const arr = new Float32Array(PARTICLE_MAX * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.setDrawRange(0, 0);
    const s = Array.from({ length: PARTICLE_MAX }, (_, i) => ({
      a: (i * 2.39996) % (Math.PI * 2),
      r: 0.2 + ((i * 37) % 100) / 100 * 0.9,
      sp: 0.5 + ((i * 13) % 100) / 100,
      y: ((i * 29) % 100) / 100,
    }));
    return { geo: g, seeds: s };
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const n = particleCountFromLog(logRef.current);
    const attr = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const s = seeds[i];
      const a = s.a + t * s.sp * 0.9;
      arr[i * 3] = Math.cos(a) * s.r;
      arr[i * 3 + 1] = ((s.y + t * 0.12 * s.sp) % 1) * 2.2 + 0.3;
      arr[i * 3 + 2] = Math.sin(a) * s.r;
    }
    attr.needsUpdate = true;
    geo.setDrawRange(0, n);
    if (ring.current) ring.current.rotation.y = t * ringSpeedFromBought(bought);
  });
  return (
    <group userData={{ noRay: true }}>
      <mesh position-y={0.5}>
        <sphereGeometry args={[0.55, 24, 16]} />
        <meshStandardMaterial color="#7fd8ff" emissive="#2a6cff" emissiveIntensity={1.4} roughness={0.3} />
      </mesh>
      <group ref={ring} position-y={0.5}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[1.3, 0.05, 8, 48]} />
          <meshBasicMaterial color="#9cf0ff" transparent opacity={0.9} toneMapped={false} />
        </mesh>
      </group>
      <points ref={points} geometry={geo}>
        <pointsMaterial size={0.08} color="#aef3ff" transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
      </points>
    </group>
  );
}

/** 塔とコアの間の生産の流れ。床上の帯で向きだけ示し、数値は帯の濃さにしない */
function FlowStrip({ from, to, opacity }: { from: { x: number; z: number }; to: { x: number; z: number }; opacity: number }) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  // 平面を寝かせてから Y 回転で向きを合わせる。オイラーで一度に回すと向きがずれるため分ける
  const yaw = Math.atan2(-dx, -dz);
  return (
    <group position={[(from.x + to.x) / 2, 0.02, (from.z + to.z) / 2]} rotation-y={yaw} userData={{ noRay: true }}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.3, len]} />
        <meshBasicMaterial color="#7fd8ff" transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

function DimensionTower({ tier, x, z, view, interactable, onOpen, detail }: {
  tier: number; x: number; z: number;
  view: AdLabSnapshot['dimensions'][number];
  interactable: boolean; onOpen: OpenPanel; detail: 'full' | 'simple';
}) {
  const target = DIMENSION_TARGETS[tier - 1];
  const h = view.locked ? 0.5 : towerHeightFromLog(view.amountLog10);
  const groupProps = interactable
    ? { userData: { hint: `第${tier}次元（クリックでパネル）`, use: () => onOpen(target) } }
    : { userData: { noRay: true } };
  return (
    <group position={[x, 0, z]} {...groupProps}>
      <DimensionReactor3D tier={tier} amountLog10={view.amountLog10} productionLog10={view.productionLog10} bought={view.bought} locked={view.locked} detail={detail} />
      <Label text={view.locked ? `🔒 第${tier}次元` : `第${tier}次元`} position={[0, h + 1.4, 0]} height={0.22} bg="rgba(20,24,48,.92)" />
      {/* 流れの帯は同列の隣塔だけに引く。列をまたぐと研究所を斜めに横切ってしまうため */}
      {!view.locked && tier !== 1 && tier !== 5 && <FlowStrip from={{ x, z }} to={ANTIMATTER_TOWERS[tier - 2]} opacity={streamOpacityFromLog(view.productionLog10)} />}
    </group>
  );
}

function ExhibitPlinth({ id, x, z, title, interactable, onOpen }: {
  id: AdPanelTarget; x: number; z: number; title: string; interactable: boolean; onOpen: OpenPanel;
}) {
  const groupProps = interactable
    ? { userData: { hint: `${title}（モック・クリックで説明）`, use: () => onOpen(id) } }
    : { userData: { noRay: true } };
  return (
    <group position={[x, 0, z]} {...groupProps}>
      <Cyl p={[0, 0.35, 0]} r={0.42} r2={0.5} h={0.7} color="#2e334f" />
      <Box p={[0, 1.05, 0]} s={[0.7, 0.7, 0.18]} color="#8a7a5c" />
      <Label text={`${title}（モック）`} position={[0, 1.75, 0]} height={0.2} bg="rgba(60,50,30,.94)" />
    </group>
  );
}

/** 自分の研究所。isOwn が false の場合は操作を付けず、親は通常こちらではなく DioramaLab を使う */
export function AntimatterLab({ origin = [0, 0], snapshot, isOwn, onOpenPanel }: {
  origin?: Origin; snapshot: AdLabSnapshot; isOwn: boolean; onOpenPanel?: OpenPanel;
}) {
  const lod = useAntimatterLod(origin);
  const open: OpenPanel = (target) => {
    if (!isOwn) return;
    onOpenPanel?.(target);
    // ポインターロック中は DOM を触れないので、パネルを開くときにロックを外す。
    // 閉じたあとは既存の挙動どおりキャンバスをクリックすれば再ロックされる
    if (document.pointerLockElement) document.exitPointerLock();
  };
  if (lod === 'silhouette') {
    return (
      <group position={[origin[0], 0, origin[1]]} userData={{ noRay: true }}>
        <mesh position={[ANTIMATTER_CORE.x, 0.8, ANTIMATTER_CORE.z]}>
          <sphereGeometry args={[0.8, 12, 8]} />
          <meshStandardMaterial color="#24304f" roughness={0.9} />
        </mesh>
        {ANTIMATTER_TOWERS.map((t) => (
          <Box key={t.tier} p={[t.x, 0.6, t.z]} s={[0.7, 1.2, 0.7]} color="#24304f" />
        ))}
      </group>
    );
  }
  const full = lod === 'full';
  return (
    <group position={[origin[0], 0, origin[1]]}>
      <LabShell origin={origin} />
      {isOwn && <AdPurchaseParticles3D snapshot={snapshot} />}
      <group position={[ANTIMATTER_CORE.x, 0, ANTIMATTER_CORE.z]} userData={{ hint: '反物質コア（クリックでパネル）', use: () => open('core') }}>
        {full && <CoreFountain log10={snapshot.antimatterLog10} bought={snapshot.tickspeedBought} />}
        {!full && (
          <mesh position-y={0.5}>
            <sphereGeometry args={[0.55, 16, 12]} />
            <meshStandardMaterial color="#7fd8ff" emissive="#2a6cff" emissiveIntensity={0.8} roughness={0.3} />
          </mesh>
        )}
        <Label text="反物質コア" position={[0, 2.6, 0]} height={0.24} bg="rgba(20,24,48,.92)" />
        <AntimatterReadout snapshot={snapshot} onOpen={isOwn ? () => open('core') : undefined} />
      </group>
      {ANTIMATTER_TOWERS.map((t) => (
        <group key={t.tier} position={[0, 0, 0]}>
          <DimensionTower tier={t.tier} x={t.x} z={t.z} view={snapshot.dimensions[t.tier - 1]} interactable={isOwn} onOpen={open} detail={full ? 'full' : 'simple'} />
          {full && isOwn && !snapshot.dimensions[t.tier - 1].locked && (
            <PanelBoard
              hint={`第${t.tier}次元（クリックでパネル）`} onOpen={() => open(DIMENSION_TARGETS[t.tier - 1])}
              position={[t.x, towerHeightFromLog(snapshot.dimensions[t.tier - 1].amountLog10) + 1.9, t.z]}
              lines={[
                `第${t.tier}次元`,
                `所持 ${snapshot.dimensions[t.tier - 1].amountText}`,
                `生産 ${snapshot.dimensions[t.tier - 1].productionText} / 秒`,
                `次コスト ${snapshot.dimensions[t.tier - 1].nextCostText}`,
              ]}
            />
          )}
        </group>
      ))}
      <group position={[ANTIMATTER_ALTAR.x, 0, ANTIMATTER_ALTAR.z]} userData={isOwn ? { hint: 'Sacrifice 祭壇（クリックでパネル）', use: () => open('sacrifice') } : { noRay: true }}>
        <Cyl p={[0, 0.3, 0]} r={0.5} r2={0.62} h={0.6} color="#5c2a3a" />
        <mesh position-y={0.85}>
          <sphereGeometry args={[0.24, 16, 12]} />
          <meshStandardMaterial color="#ff6b8a" emissive="#b32e50" emissiveIntensity={1.1} roughness={0.3} />
        </mesh>
        <Label text="Sacrifice 祭壇" position={[0, 1.5, 0]} height={0.2} bg="rgba(60,20,32,.94)" />
      </group>
      <group position={[ANTIMATTER_PORTAL.x, 0, ANTIMATTER_PORTAL.z]} userData={isOwn ? { hint: 'Big Crunch ポータル（クリックでパネル）', use: () => open('crunch') } : { noRay: true }}>
        <mesh position-y={1.1}>
          <torusGeometry args={[0.85, 0.09, 12, 40]} />
          <meshStandardMaterial color={snapshot.canCrunch ? '#c084fc' : '#3a3f66'} emissive={snapshot.canCrunch ? '#7c3aed' : '#000000'} emissiveIntensity={snapshot.canCrunch ? 1.4 : 0} roughness={0.4} />
        </mesh>
        <mesh position-y={1.1}>
          <circleGeometry args={[0.8, 32]} />
          <meshBasicMaterial color="#0b0d1a" transparent opacity={snapshot.canCrunch ? 0.9 : 0.4} depthWrite={false} />
        </mesh>
        <Label text={snapshot.canCrunch ? 'Big Crunch 可能' : 'Big Crunch ポータル'} position={[0, 2.3, 0]} height={0.2} bg="rgba(40,20,60,.94)" />
      </group>
      {snapshot.galaxies > 0 && (
        <group position={[ANTIMATTER_CORE.x, 2.6, ANTIMATTER_CORE.z]} userData={{ noRay: true }}>
          {Array.from({ length: Math.min(snapshot.galaxies, 8) }, (_, i) => (
            <mesh key={i} position={[Math.cos(i * 0.9) * 2.1, 0, Math.sin(i * 0.9) * 2.1]} rotation-x={-Math.PI / 2}>
              <circleGeometry args={[0.32, 24]} />
              <meshBasicMaterial color="#e9d5ff" transparent opacity={0.75} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
          ))}
          <Label text={`銀河 ×${snapshot.galaxies}`} position={[0, 0.7, 0]} height={0.2} bg="rgba(40,20,60,.94)" />
        </group>
      )}
      {ANTIMATTER_EXHIBITS.map((e) => (
        <ExhibitPlinth key={e.id} id={e.id} x={e.x} z={e.z} title={e.title} interactable={isOwn} onOpen={open} />
      ))}
    </group>
  );
}

/** 他人の研究所。useFrame を使わず静止画にし、31 人分でも毎フレーム計算を増やさない */
export function DioramaLab({ origin = [0, 0], view }: { origin?: Origin; view: AdDioramaView }) {
  const log = clampLog(view.antimatterLog10);
  return (
    <group position={[origin[0], 0, origin[1]]} userData={{ noRay: true }}>
      <mesh position={[ANTIMATTER_CORE.x, 0.5, ANTIMATTER_CORE.z]}>
        <sphereGeometry args={[0.45 + 0.15 * Math.min(log, 10) / 10, 16, 12]} />
        <meshStandardMaterial color="#3a4a7a" roughness={0.8} />
      </mesh>
      {ANTIMATTER_TOWERS.map((t) => (
        <Box key={t.tier} p={[t.x, (t.tier <= view.maxTier ? 0.5 + 0.2 * Math.min(log, 20) : 0.25), t.z]} s={[0.6, t.tier <= view.maxTier ? 1 + 0.4 * Math.min(log, 20) : 0.5, 0.6]} color="#2a3355" />
      ))}
      <Label text="研究所（ジオラマ）" position={[ANTIMATTER_CORE.x, 2.2, ANTIMATTER_CORE.z]} height={0.22} bg="rgba(20,24,48,.92)" />
    </group>
  );
}
