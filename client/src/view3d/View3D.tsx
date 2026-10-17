import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { DOOR_HALF, ROOM_HALF, entranceSlot, type AvatarState, type User } from '../../../shared/protocol.ts';
import { NOTE_COLORS } from '../../../shared/items.ts';
import { useStore, get, colorOf, nameOf, heldHammer } from '../store.ts';
import { shareVideoEl } from '../net/livekit.ts';
import { selectNote } from '../actions.ts';
import { ItemMenu } from '../items/ItemMenu.tsx';
import { editNote, moveItem, removeItem, spawnItem } from '../items/actions.ts';
import { bump, recentlyHit } from '../items/effects.ts';
import { drawText, makeCanvasTexture } from './textTexture.ts';
import { EYE, type Interactable } from './interact.ts';
import { Player } from './Player.tsx';
import { HammerModel, Item3D } from './items3d.tsx';

// ---------- 部屋（南壁の中央に入口） ----------
const H = ROOM_HALF;
const WALL_H = 4;
const DOOR_H = 2.6;
const HALL = 3.2; // 入口の外の奥行き

function Box({ p, s, color }: { p: [number, number, number]; s: [number, number, number]; color: string }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

/** 入口の上の看板（部屋の内側に向ける） */
function DoorSign() {
  const tex = useMemo(() => {
    const { canvas, tex: t } = makeCanvasTexture(1024, 128);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f0b132';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#1e1f22';
    ctx.font = '800 64px "Segoe UI", "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚪 入口 ・ 2Dで参加中の人', 512, 68);
    t.needsUpdate = true;
    return t;
  }, []);
  return (
    <mesh position={[0, DOOR_H + 0.4, H - 0.11]} rotation-y={Math.PI}>
      <planeGeometry args={[3.2, 0.4]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

function RoomMesh() {
  const side = (H - DOOR_HALF);
  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight position={[5, 10, 5]} intensity={1.2} />
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[2 * H, 2 * H]} />
        <meshStandardMaterial color="#565961" />
      </mesh>
      <gridHelper args={[2 * H, 20, '#5c5f66', '#4a4d54']} position-y={0.005} userData={{ noRay: true }} />
      <Box p={[0, WALL_H / 2, -H]} s={[2 * H, WALL_H, 0.2]} color="#80848e" />
      <Box p={[-H, WALL_H / 2, 0]} s={[0.2, WALL_H, 2 * H]} color="#80848e" />
      <Box p={[H, WALL_H / 2, 0]} s={[0.2, WALL_H, 2 * H]} color="#80848e" />
      {/* 南壁: 入口の左右と上 */}
      <Box p={[-(DOOR_HALF + side / 2), WALL_H / 2, H]} s={[side, WALL_H, 0.2]} color="#80848e" />
      <Box p={[DOOR_HALF + side / 2, WALL_H / 2, H]} s={[side, WALL_H, 0.2]} color="#80848e" />
      <Box p={[0, (WALL_H + DOOR_H) / 2, H]} s={[2 * DOOR_HALF, WALL_H - DOOR_H, 0.2]} color="#80848e" />
      {/* 入口の外（2D の人が並ぶ控えの場所） */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, H + HALL / 2]}>
        <planeGeometry args={[2 * DOOR_HALF + 1.6, HALL]} />
        <meshStandardMaterial color="#3f4147" />
      </mesh>
      <Box p={[-(DOOR_HALF + 0.9), DOOR_H / 2, H + HALL / 2]} s={[0.15, DOOR_H, HALL]} color="#6d717a" />
      <Box p={[DOOR_HALF + 0.9, DOOR_H / 2, H + HALL / 2]} s={[0.15, DOOR_H, HALL]} color="#6d717a" />
      <Box p={[0, DOOR_H / 2, H + HALL]} s={[2 * DOOR_HALF + 1.95, DOOR_H, 0.15]} color="#6d717a" />
      <DoorSign />
    </>
  );
}

// ---------- 共有スクリーン（2D と同じ <video> を VideoTexture で表示） ----------
function Screen() {
  const sharer = useStore((s) => s.sharer);
  useStore((s) => s.participants);
  const videoTex = useMemo(() => {
    const t = new THREE.VideoTexture(shareVideoEl);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const idle = useMemo(() => {
    const { canvas, tex } = makeCanvasTexture(1024, 576);
    drawText(canvas, [{ text: '配信はありません', size: 64 }, { text: '🖥 ボタンから画面を配信できます', size: 40 }], {
      bg: '#1c1917', fg: '#e7e5e4', pad: 60,
    });
    tex.needsUpdate = true;
    return tex;
  }, []);
  const [aspect, setAspect] = useState(16 / 9);
  useEffect(() => {
    const f = () => { if (shareVideoEl.videoWidth) setAspect(shareVideoEl.videoWidth / shareVideoEl.videoHeight); };
    shareVideoEl.addEventListener('resize', f);
    shareVideoEl.addEventListener('loadedmetadata', f);
    f();
    return () => {
      shareVideoEl.removeEventListener('resize', f);
      shareVideoEl.removeEventListener('loadedmetadata', f);
    };
  }, []);
  const a = sharer ? aspect : 16 / 9;
  const h = Math.min(4.5, 8 / a);
  const w = h * a;
  return (
    <group position={[0, 2.4, -H + 0.12]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={sharer ? videoTex : idle} toneMapped={false} />
      </mesh>
      {sharer && (
        <Html position={[0, h / 2 + 0.3, 0]} center distanceFactor={10}>
          <div className="nametag live">🔴 {nameOf(sharer)} の配信</div>
        </Html>
      )}
    </group>
  );
}

// ---------- 2D 参加者: 入口の外に並ぶ「紙の立ち姿」 ----------
function Standee({ user, slot }: { user: User; slot: number }) {
  const speaking = useStore((s) => !!s.speaking[user.id]);
  const micOff = useStore((s) => s.voice === 'connected' && s.micOn[user.id] === false);
  const holding = useStore((s) => Object.values(s.items).some((i) => i.kind === 'hammer' && i.holder === user.id));
  const ref = useRef<THREE.Group>(null);
  const card = useRef<THREE.Group>(null);
  const { canvas, tex } = useMemo(() => makeCanvasTexture(256, 512), []);
  useEffect(() => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 512);
    // 紙の人型: 丸い頭と胴体
    ctx.fillStyle = '#f2f3f5';
    ctx.beginPath();
    ctx.roundRect(28, 150, 200, 340, 60);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(128, 100, 84, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colorOf(user.id);
    ctx.beginPath();
    ctx.arc(128, 100, 72, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(42, 168, 172, 308, 50);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 76px "Segoe UI", "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(user.name.slice(0, 1), 128, 104);
    ctx.font = '64px "Segoe UI Emoji", sans-serif';
    ctx.fillText('💻', 128, 300);
    if (holding) ctx.fillText('🔨', 196, 420);
    tex.needsUpdate = true;
  }, [user.id, user.name, holding, canvas, tex]);
  const pos = entranceSlot(slot);
  useFrame((_, dt) => {
    const g = ref.current;
    if (g) {
      // 並び順が変わったら歩いて移動する
      const k = Math.min(1, dt * 6);
      g.position.x += (pos.x - g.position.x) * k;
      g.position.z += (pos.z - g.position.z) * k;
    }
    const s = get();
    const b = bump(s.hits[user.id]);
    const talk = s.speaking[user.id] ? Math.abs(Math.sin(performance.now() / 120)) * 0.04 : 0;
    card.current?.scale.set(1 + 0.25 * b, 1 - 0.35 * b + talk, 1);
  });
  return (
    <group ref={ref} position={[pos.x, 0, pos.z]} userData={{ hitTarget: user.id } satisfies Interactable}>
      <mesh position-y={0.02}>
        <cylinderGeometry args={[0.28, 0.3, 0.04, 20]} />
        <meshStandardMaterial color="#2b2d31" />
      </mesh>
      <group ref={card}>
        {/* 紙なので両面に貼る（部屋の中＝ -Z 側を向く） */}
        <mesh position-y={0.85} rotation-y={Math.PI}>
          <planeGeometry args={[0.85, 1.7]} />
          <meshBasicMaterial map={tex} transparent alphaTest={0.5} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>
      {speaking && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
          <ringGeometry args={[0.32, 0.42, 32]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      )}
      <Html position={[0, 1.95, 0]} center distanceFactor={8}>
        <div className={`nametag twod ${speaking ? 'speaking' : ''} ${recentlyHit(user.id) ? 'hitflash' : ''}`}>
          💻 {micOff && '🔇 '}{user.name}
        </div>
      </Html>
    </group>
  );
}

function Entrance() {
  const participants = useStore((s) => s.participants);
  useStore((s) => s.hits);
  const in2d = participants.filter((p) => p.mode === '2d');
  return <>{in2d.map((u, i) => <Standee key={u.id} user={u} slot={i} />)}</>;
}

// ---------- 他の参加者のアバター ----------
function Avatar3D({ id, state }: { id: string; state: AvatarState }) {
  const name = useStore((s) => s.participants.find((p) => p.id === id)?.name);
  const speaking = useStore((s) => !!s.speaking[id]);
  const micOff = useStore((s) => s.voice === 'connected' && s.micOn[id] === false);
  const holding = useStore((s) => Object.values(s.items).some((i) => i.kind === 'hammer' && i.holder === id));
  const ref = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const k = Math.min(1, dt * 10);
    g.position.x += (state.x - g.position.x) * k;
    g.position.z += (state.z - g.position.z) * k;
    let d = state.ry - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * k;
    const s = get();
    // 叩かれたら頭が一瞬へこんで戻る
    const b = bump(s.hits[id]);
    head.current?.scale.set(1 + 0.4 * b, 1 - 0.6 * b, 1 + 0.4 * b);
    head.current?.position.setY(1.45 - 0.14 * b);
    if (hand.current) hand.current.rotation.x = -0.4 - bump(s.swings[id], performance.now(), 350) * 1.6;
  });
  if (!name) return null;
  const color = colorOf(id);
  return (
    <group ref={ref} position={[state.x, 0, state.z]} rotation-y={state.ry} userData={{ hitTarget: id } satisfies Interactable}>
      <mesh position-y={0.75}>
        <capsuleGeometry args={[0.3, 0.8, 4, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <group ref={head} position-y={1.45}>
        <mesh>
          <sphereGeometry args={[0.24, 20, 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
        <mesh position={[0, 0.03, -0.2]}>
          <boxGeometry args={[0.3, 0.1, 0.1]} />
          <meshStandardMaterial color="#1c1917" />
        </mesh>
      </group>
      {holding && (
        <group ref={hand} position={[0.38, 0.95, -0.1]}>
          <HammerModel />
        </group>
      )}
      {speaking && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.45, 0.62, 32]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      )}
      <Html position={[0, 2, 0]} center distanceFactor={8}>
        <div className={`nametag ${speaking ? 'speaking' : ''}`}>{micOff && '🔇 '}{name}</div>
      </Html>
    </group>
  );
}

// ---------- DOM オーバーレイ ----------
function NoteEditor() {
  const id = useStore((s) => s.selectedNote);
  const note = useStore((s) => (id ? s.items[id] : undefined));
  if (note?.kind !== 'note') return null;
  const faceMe = () => {
    const a = get().selfAvatar;
    moveItem(note.id, note.x, note.z, Math.atan2(a.x - note.x, a.z - note.z));
  };
  return (
    <div className="noteeditor">
      <textarea
        autoFocus value={note.text} placeholder="付箋の内容"
        style={{ background: note.color }}
        onChange={(e) => editNote(note.id, { text: e.target.value })}
      />
      <div className="row">
        {NOTE_COLORS.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} onClick={() => editNote(note.id, { color: c })} />
        ))}
        <button className="small" onClick={faceMe}>こちらに向ける</button>
        <button className="small" onClick={() => removeItem(note.id)}>片付ける</button>
        <button className="small" onClick={() => selectNote(null)}>閉じる</button>
      </div>
      <small>空間をクリックすると操作に戻ります</small>
    </div>
  );
}

function Crosshair() {
  const locked = useStore((s) => s.locked);
  const hint = useStore((s) => s.aimHint);
  const holding = useStore((s) => !!heldHammer(s));
  const hitMe = useStore((s) => s.hits[s.selfId]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (hitMe === undefined) return;
    const t = setTimeout(() => tick((n) => n + 1), 700);
    return () => clearTimeout(t);
  }, [hitMe]);
  return (
    <>
      {locked && <div className={`crosshair ${hint ? 'on' : ''}`} />}
      {locked && hint && <div className="aimhint">{hint}</div>}
      {recentlyHit(get().selfId) && <div className="hitme">ピコッ!</div>}
      <div className="keyhelp">
        {locked
          ? <>WASD: 移動 ・ マウス: 視点 ・ クリック: 操作 ・ G: 持ち運ぶ ・ X: 片付ける{holding && ' ・ Q: ハンマーを置く'} ・ Esc: カーソルを出す</>
          : <>画面をクリックすると操作を始めます（マウスで視点・照準で操作）</>}
      </div>
    </>
  );
}

export function View3D() {
  const avatars = useStore((s) => s.avatars);
  const items = useStore((s) => s.items);
  const locked = useStore((s) => s.locked);
  const a0 = get().selfAvatar;
  return (
    <div className={`view3d ${locked ? 'locked' : ''}`}>
      <Canvas camera={{ fov: 70, near: 0.05, far: 100, position: [a0.x, EYE, a0.z] }}>
        <color attach="background" args={['#2b2d31']} />
        <RoomMesh />
        <Screen />
        <Entrance />
        {Object.entries(avatars).map(([id, s]) => <Avatar3D key={id} id={id} state={s} />)}
        {Object.values(items).map((it) => <Item3D key={it.id} item={it} />)}
        <Player />
      </Canvas>
      <Crosshair />
      <div className="tools3d">
        <button className="primary" onClick={() => spawnItem('note')}>＋ 付箋</button>
        <ItemMenu />
      </div>
      <NoteEditor />
    </div>
  );
}
