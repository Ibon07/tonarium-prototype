import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { ITEM_INFO } from '../../../shared/items.ts';
import { ROOM_HALF, SPAWN } from '../../../shared/protocol.ts';
import { NEAR_RANGE, VOICE_RANGE } from '../../../shared/places.ts';
import { WORLDS, type WorldKind } from '../../../shared/worlds.ts';
import { useStore, get, worldKindOf, serverNow } from '../store.ts';
import { CAR, LOOP, STATION_PARTS, carPose, trackAt } from '../../../shared/city.ts';
import { placesOf } from '../spatial.ts';
import { HEAT_CELL_M, addHeat, cellCenter, decayHeat, heatCells, type HeatCell } from '../voiceHeat.ts';
import { walkTo } from '../walk.ts';
import { usePhone, touchOnly } from '../phone.ts';
import { Avatar3D, Entrance } from '../view3d/View3D.tsx';
import { Item3D } from '../view3d/items3d.tsx';
import { ShareDisplay } from '../view3d/shareDisplay.tsx';
import { WORLD_BG, WorldMesh } from '../view3d/worlds3d.tsx';
import { Face } from './common.tsx';

interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

const boundsOf = (k: WorldKind): Bounds => WORLDS[k].extent ?? { minX: -ROOM_HALF, maxX: ROOM_HALF, minZ: -ROOM_HALF, maxZ: ROOM_HALF };

/** 前面のパネルと顔の帯に隠れない、マップを収める画面の範囲 */
function useMapBox() {
  const phone = usePhone();
  const folded = useStore((s) => s.folded);
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: innerWidth, h: innerHeight });
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  const inset = phone
    ? { l: 8, t: 150, r: 8, b: 130 }
    : { l: folded.left ? 92 : 360, t: 150, r: folded.right ? 92 : 340, b: 144 };
  return { ...size, x0: inset.l, y0: inset.t, x1: Math.max(inset.l + 120, size.w - inset.r), y1: Math.max(inset.t + 120, size.h - inset.b) };
}

function moveSelfTo(x: number, z: number) {
  const s = get();
  const from = placesOf(s).get(s.selfId);
  if (from) walkTo(x, z, from);
}

/** ボタンなどにフォーカスがあるときのスペースはその操作に任せ、何も選んでいない（マップを押した後など）ときだけ拾う */
const onMap = (t: EventTarget | null) => t === document.body || (t instanceof Element && !!t.closest('.map2d, .map3d'));

function useSpaceReset(reset: () => void) {
  const ref = useRef(reset);
  ref.current = reset;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !onMap(e.target)) return;
      e.preventDefault();
      ref.current();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);
}

// 熱はマップの部品ではなくセッション側の状態として 1 つだけ持ち、2D／3D を切り替えても同じ湯気が見えるようにする
const heatMap = new Map<string, number>();
let heatLastAt = 0;
let heatScope = '';

function sampleHeat(): HeatCell[] {
  const s = get();
  const scope = `${s.session ?? ''}:${worldKindOf(s)}`;
  if (scope !== heatScope) { heatScope = scope; heatMap.clear(); heatLastAt = 0; }
  const now = performance.now();
  const dt = heatLastAt ? (now - heatLastAt) / 1000 : 0;
  heatLastAt = now;
  if (dt > 0) {
    decayHeat(heatMap, dt);
    // タブを離れていた間の発話状態は古い可能性があるので、溜める量だけ 1 秒ぶんまでに抑える
    const addDt = Math.min(dt, 1);
    const places = placesOf(s);
    for (const [id, on] of Object.entries(s.speaking)) {
      if (!on) continue;
      const p = places.get(id);
      if (p) addHeat(heatMap, p.x, p.z, addDt);
    }
  }
  return heatCells(heatMap);
}

/** 冷めていく様子が見えるよう、表示中だけ定期的にサンプルし直す */
function useHeatCells(): HeatCell[] {
  const [cells, setCells] = useState<HeatCell[]>([]);
  const sig = useRef('');
  const enabled = useStore((s) => s.voiceHeat);
  useEffect(() => {
    if (!enabled) { heatMap.clear(); sig.current = ''; setCells([]); return; }
    const update = () => {
      const next = sampleHeat();
      // 熱が無い・頭打ちの間は描き直さない
      const key = next.map((c) => `${c.cx},${c.cz},${c.heat.toFixed(2)}`).join(';');
      if (key !== sig.current) { sig.current = key; setCells(next); }
    };
    update();
    const t = setInterval(update, 500);
    return () => clearInterval(t);
  }, [enabled]);
  return cells;
}

interface View2D { k: number; tx: number; ty: number }

function Map2D({ kind }: { kind: WorldKind }) {
  const box = useMapBox();
  const b = boundsOf(kind);
  const fit = useMemo<View2D>(() => {
    const k = Math.min((box.x1 - box.x0) / (b.maxX - b.minX), (box.y1 - box.y0) / (b.maxZ - b.minZ)) * 0.94;
    return { k, tx: (box.x0 + box.x1) / 2 - ((b.minX + b.maxX) / 2) * k, ty: (box.y0 + box.y1) / 2 - ((b.minZ + b.maxZ) / 2) * k };
  }, [box.x0, box.x1, box.y0, box.y1, b.minX, b.maxX, b.minZ, b.maxZ]);
  // null のあいだは画面に合わせて収める（パネルをたたむ・窓の大きさが変わるのにも付いていく）
  const [view, setView] = useState<View2D | null>(null);
  const v = view ?? fit;
  useSpaceReset(() => setView(null));
  useEffect(() => setView(null), [kind]);

  useStore((s) => s.avatars);
  useStore((s) => s.participants);
  const heat = useHeatCells();
  const items = useStore((s) => s.items);
  const selfId = useStore((s) => s.selfId);
  const walk = useStore((s) => s.walk);
  const places = placesOf(get());
  // ほかの人は位置がとびとびに届くので目印をなめらかに動かす。ただし拡大・平行移動した直後は追従が遅れないよう瞬時に
  const prevView = useRef(v);
  const smooth = prevView.current === v || (prevView.current.k === v.k && prevView.current.tx === v.tx && prevView.current.ty === v.ty);
  prevView.current = v;
  const me = places.get(selfId);
  const toScreen = (x: number, z: number) => ({ left: v.tx + x * v.k, top: v.ty + z * v.k });

  const down = useRef<{ x: number; y: number; button: number; v: View2D } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    // ホイールを押したときの自動スクロールを出さない
    if (e.button === 1) e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    down.current = { x: e.clientX, y: e.clientY, button: e.button, v };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = down.current;
    if (!d || d.button !== 1 || touchOnly) return;
    setView({ ...d.v, tx: d.v.tx + e.clientX - d.x, ty: d.v.ty + e.clientY - d.y });
  };
  const onUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || d.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    moveSelfTo((e.clientX - v.tx) / v.k, (e.clientY - v.ty) / v.k);
  };
  const onWheel = (e: React.WheelEvent) => {
    const f = Math.exp(-e.deltaY * 0.0015);
    const k = Math.max(fit.k * 0.3, Math.min(fit.k * 8, v.k * f));
    const r = k / v.k;
    setView({ k, tx: e.clientX - (e.clientX - v.tx) * r, ty: e.clientY - (e.clientY - v.ty) * r });
  };

  return (
    <div className="map2d" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { down.current = null; }} onWheel={onWheel} onAuxClick={(e) => e.preventDefault()}>
      <svg width={box.w} height={box.h} aria-hidden="true">
        <defs>
          <radialGradient id="voiceheat">
            <stop offset="0%" stopColor="#ff9a3c" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#ff7a2f" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ff7a2f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g transform={`translate(${v.tx} ${v.ty}) scale(${v.k})`}>
          <rect className="mfloor" x={b.minX} y={b.minZ} width={b.maxX - b.minX} height={b.maxZ - b.minZ} rx={0.4} />
          {WORLDS[kind].extent && <rect className="mfloor" x={-ROOM_HALF} y={-ROOM_HALF} width={ROOM_HALF * 2} height={ROOM_HALF * 2} rx={0.4} />}
          <circle className="mspawn" cx={SPAWN.x} cy={SPAWN.z} r={SPAWN.r} />
          {/* 地上の物だけ（マンションの上の階の壁や駅の柵は描かない） */}
          {WORLDS[kind].solids.filter((s) => (s.y0 ?? 0) < 0.5).map((s, i) => ('r' in s
            ? <circle key={i} className="msolid" cx={s.x} cy={s.z} r={s.r} />
            : <rect key={i} className="msolid" x={s.x - s.w / 2} y={s.z - s.d / 2} width={s.w} height={s.d} rx={0.08} />))}
          {/* 床と家具より上に出さないと、extent のあるワールドで内側の床に隠れる */}
          {heat.map((c) => {
            const ctr = cellCenter(c.cx, c.cz);
            return <circle key={`${c.cx},${c.cz}`} className="mheat" cx={ctr.x} cy={ctr.z} r={HEAT_CELL_M * 0.95} fill="url(#voiceheat)" opacity={0.25 + c.heat * 0.55} />;
          })}
          {kind === 'city' && <CityTrain2D />}
          {me && walk?.to && <line className="mroute" x1={me.x} y1={me.z} x2={walk.to.x} y2={walk.to.z} />}
          {walk?.to && <g className="mgoal"><circle cx={walk.to.x} cy={walk.to.z} r={0.45} /><circle cx={walk.to.x} cy={walk.to.z} r={0.12} /></g>}
          {me && <circle className="mvoice" cx={me.x} cy={me.z} r={VOICE_RANGE} />}
          {me && <circle className="mnear" cx={me.x} cy={me.z} r={NEAR_RANGE} />}
        </g>
      </svg>
      {Object.values(items).filter((it) => !('holder' in it && it.holder)).map((it) => (
        <span key={it.id} className="mitem" style={{ ...toScreen(it.x, it.z), background: ITEM_INFO[it.kind].tint, color: ITEM_INFO[it.kind].ink }} title={ITEM_INFO[it.kind].name}>
          {ITEM_INFO[it.kind].mark}
        </span>
      ))}
      {get().participants.map((u) => {
        const p = places.get(u.id);
        if (!p) return null;
        return (
          <span key={u.id} className={`mperson ${u.id === selfId ? 'self' : smooth ? 'smooth' : ''} ${p.small ? 'small' : ''}`} style={toScreen(p.x, p.z)}>
            <Face id={u.id} name={u.name} size={p.small ? 22 : 30} />
            <span className="mname">{u.id === selfId ? 'あなた' : u.name}</span>
          </span>
        );
      })}
    </div>
  );
}

const TRACK_PATH = (() => {
  const pts: string[] = [];
  for (let s = 0; s <= LOOP; s += 2) { const p = trackAt(s); pts.push(`${p.x.toFixed(2)},${p.z.toFixed(2)}`); }
  return `M${pts.join('L')}Z`;
})();

/** 2D マップの街の線路・駅と、走っている電車。電車の位置は時刻から出すので、短い間隔で描き直す */
function CityTrain2D() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 150);
    return () => clearInterval(t);
  }, []);
  const now = serverNow();
  return (
    <>
      <path className="mtrack" d={TRACK_PATH} />
      {STATION_PARTS.map((p, i) => {
        const r = p.surfaces[0];
        return <rect key={i} className="mstation" x={r.x0} y={r.z0} width={r.x1 - r.x0} height={r.z1 - r.z0} />;
      })}
      {[0, 1].map((k) => {
        const c = carPose(now, k);
        return (
          <rect
            key={k} className="mtrain" x={-CAR.w / 2} y={-CAR.len / 2} width={CAR.w} height={CAR.len} rx={0.4}
            transform={`translate(${c.x} ${c.z}) rotate(${(-c.ry * 180) / Math.PI})`}
          />
        );
      })}
    </>
  );
}

/** 3D マップでの自分の声が届く範囲 */
function VoiceRing() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const s = get();
    const p = placesOf(s).get(s.selfId);
    if (ref.current && p) ref.current.position.set(p.x, 0.03, p.z);
  });
  return (
    <group ref={ref} rotation-x={-Math.PI / 2}>
      <mesh><ringGeometry args={[VOICE_RANGE - 0.08, VOICE_RANGE, 96]} /><meshBasicMaterial color="#2F5FC4" transparent opacity={0.7} /></mesh>
      <mesh><ringGeometry args={[NEAR_RANGE - 0.05, NEAR_RANGE, 48]} /><meshBasicMaterial color="#23A55A" transparent opacity={0.8} /></mesh>
    </group>
  );
}

/** 3D マップでの声の湯気。真上から見るマップでは、床の温かい光として出す */
function HeatDiscs() {
  const cells = useHeatCells();
  return (
    <>
      {cells.map((c) => {
        const ctr = cellCenter(c.cx, c.cz);
        return (
          <mesh key={`${c.cx},${c.cz}`} rotation-x={-Math.PI / 2} position={[ctr.x, 0.04, ctr.z]}>
            <circleGeometry args={[HEAT_CELL_M * 0.95, 32]} />
            <meshBasicMaterial color="#ff8a3c" transparent opacity={0.08 + c.heat * 0.22} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}

/** 3D マップでの目的地の目印 */
function Goal3D() {
  const to = useStore((s) => s.walk?.to);
  if (!to) return null;
  return (
    <group position={[to.x, 0.04, to.z]}>
      <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[0.32, 0.45, 32]} /><meshBasicMaterial color="#E2533F" /></mesh>
      <mesh position-y={0.6}><coneGeometry args={[0.16, 0.45, 16]} /><meshBasicMaterial color="#E2533F" /></mesh>
    </group>
  );
}

/** 上から見るとアバターは小さいので、2D マップと同じ顔の目印を頭の上に出す。
 * 目印は Canvas の外の普通の DOM に置き、毎フレーム画面上の位置へ動かす */
function PinProjector({ els }: { els: React.RefObject<Map<string, HTMLElement>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const places = placesOf(get());
    for (const [id, el] of els.current) {
      const p = places.get(id);
      if (p) v.set(p.x, (p.y ?? 0) + 2.2, p.z).project(camera);
      const shown = !!p && v.z < 1;
      el.style.visibility = shown ? 'visible' : 'hidden';
      if (shown) el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`;
    }
  });
  return null;
}

function PersonPins({ els }: { els: React.RefObject<Map<string, HTMLElement>> }) {
  const participants = useStore((s) => s.participants);
  const selfId = useStore((s) => s.selfId);
  return (
    <>
      {participants.map((u) => (
        <span key={u.id} className={`mpin ${u.id === selfId ? 'self' : ''}`} ref={(el) => { if (el) els.current.set(u.id, el); else els.current.delete(u.id); }}>
          <Face id={u.id} name={u.name} size={26} /><span className="mname">{u.id === selfId ? 'あなた' : u.name}</span>
        </span>
      ))}
    </>
  );
}

/** 画面の中心ではなく、パネルに隠れない範囲の中心にワールドを映す */
function CenterInBox({ box }: { box: ReturnType<typeof useMapBox> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    const dx = (box.x0 + box.x1) / 2 - box.w / 2;
    const dy = (box.y0 + box.y1) / 2 - box.h / 2;
    camera.setViewOffset(box.w, box.h, -dx, -dy, box.w, box.h);
    return () => camera.clearViewOffset();
  }, [camera, box.w, box.h, box.x0, box.x1, box.y0, box.y1]);
  return null;
}

const FOV = 45;
/** 天井のある部屋だけ。ゲームの塔や街の建物は切らない */
const CLIP_Y: Partial<Record<WorldKind, number>> = { room: 3, cafe: 3 };

/** 最初だけカメラを構える。窓の大きさやパネルが変わったときは、見ている角度は保ったままスペースで戻る先だけ更新する。
 * Canvas の中で OrbitControls の後に置くと、ref が付いてから動く */
function ControlsHome({ controls, camera0, target }: { controls: React.RefObject<OrbitControlsImpl | null>; camera0: THREE.Vector3; target: [number, number, number] }) {
  const placed = useRef(false);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.position0.copy(camera0);
    c.target0.set(...target);
    if (placed.current) return;
    placed.current = true;
    c.reset();
  }, [controls, camera0, target[0], target[1], target[2]]);
  return null;
}

function Map3D({ kind }: { kind: WorldKind }) {
  const box = useMapBox();
  const avatarIds = useStore((s) => s.avatarIds);
  const items = useStore((s) => s.items);
  const b = boundsOf(kind);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const controls = useRef<OrbitControlsImpl>(null);
  const pins = useRef(new Map<string, HTMLElement>());
  // パネルに隠れない範囲にワールド全体が入る距離から、斜め上に構える
  const camera0 = useMemo(() => {
    const frac = Math.min((box.y1 - box.y0) / box.h, ((box.x1 - box.x0) / box.h));
    const dist = (span / frac / (2 * Math.tan((FOV / 2) * (Math.PI / 180)))) * 1.1;
    return new THREE.Vector3(cx, 0, cz).addScaledVector(new THREE.Vector3(0, 0.8, 0.6), dist);
  }, [cx, cz, span, box.w, box.h, box.x0, box.x1, box.y0, box.y1]);
  useSpaceReset(() => controls.current?.reset());
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.nativeEvent.button !== 0 || e.delta > 6) return;
    moveSelfTo(e.point.x, e.point.z);
  };
  return (
    <div className="map3d" onAuxClick={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
      {/* 天井や梁が見下ろす視界をふさぐ部屋では、マップでは天井より上を切り落とす */}
      <Canvas camera={{ fov: FOV, near: 0.1, far: 400, position: camera0.toArray() }} onCreated={({ gl }) => { const y = CLIP_Y[kind]; if (y !== undefined) gl.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), y)]; }}>
        <color attach="background" args={[WORLD_BG[kind]]} />
        <CenterInBox box={box} />
        <WorldMesh kind={kind} map />
        <ShareDisplay />
        <Entrance />
        {avatarIds.map((id) => <Avatar3D key={id} id={id} />)}
        {Object.values(items).map((it) => <Item3D key={it.id} item={it} />)}
        <VoiceRing />
        <HeatDiscs />
        <Goal3D />
        <PinProjector els={pins} />
        <mesh rotation-x={-Math.PI / 2} position={[cx, 0.02, cz]} onClick={onClick}>
          <planeGeometry args={[span * 4, span * 4]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <Suspense fallback={null}>
          <OrbitControls
            ref={controls} target={[cx, 0, cz]} enabled={!touchOnly} screenSpacePanning={false} zoomSpeed={2}
            maxPolarAngle={Math.PI / 2 - 0.08} minDistance={3} maxDistance={span * 5}
            // 左クリックは移動に使うので、回転は右・平行移動はホイールを押してドラッグ
            mouseButtons={{ LEFT: -1 as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
          />
          <ControlsHome controls={controls} camera0={camera0} target={[cx, 0, cz]} />
        </Suspense>
      </Canvas>
      <PersonPins els={pins} />
    </div>
  );
}

/** 2D の背景に出すマップ。マップを入れるべきか試すためのもので、設定で なし／2D／3D を選ぶ */
export function MapLayer() {
  const mapMode = useStore((s) => s.mapMode);
  const kind = useStore((s) => worldKindOf(s));
  if (mapMode === '2d') return <Map2D kind={kind} />;
  if (mapMode === '3d') return <Map3D key={kind} kind={kind} />;
  return null;
}
