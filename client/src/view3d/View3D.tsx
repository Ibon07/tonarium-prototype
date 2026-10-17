import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ROOM_HALF, NOTE_COLORS, type AvatarState, type Note, type User } from '../../../shared/protocol.ts';
import { useStore, get, colorOf, nameOf, heldHammer } from '../store.ts';
import { shareVideoEl } from '../net/livekit.ts';
import { createNote, deleteNote, selectNote, updateNote } from '../actions.ts';
import { ItemMenu } from '../items/ItemMenu.tsx';
import { bump, recentlyHit } from '../items/effects.ts';
import { drawText, makeCanvasTexture } from './textTexture.ts';
import { clampRoom, EYE, type Interactable } from './interact.ts';
import { Player } from './Player.tsx';
import { HammerModel, Item3D, useFollow } from './items3d.tsx';

const NOTE_Y = 1.5;

// ---------- 部屋 ----------
function RoomMesh() {
  const H = ROOM_HALF;
  const walls: [number, number, number, number][] = [
    [0, -H, 2 * H, 0.2], [0, H, 2 * H, 0.2], [-H, 0, 0.2, 2 * H], [H, 0, 0.2, 2 * H],
  ];
  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight position={[5, 10, 5]} intensity={1.2} />
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[2 * H, 2 * H]} />
        <meshStandardMaterial color="#565961" />
      </mesh>
      <gridHelper args={[2 * H, 20, '#5c5f66', '#4a4d54']} position-y={0.005} userData={{ noRay: true }} />
      {walls.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 2, z]}>
          <boxGeometry args={[w, 4, d]} />
          <meshStandardMaterial color="#80848e" />
        </mesh>
      ))}
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
    <group position={[0, 2.4, -ROOM_HALF + 0.12]}>
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

// ---------- 2D 参加者の掲示板（ハンマーで名前を叩くと、その人の 2D 画面に演出が出る） ----------
const BOARD_PX = 512;
const ROW_Y = 110;
const ROW_H = 64;

function TwoDBoard() {
  const participants = useStore((s) => s.participants);
  const speaking = useStore((s) => s.speaking);
  const micOn = useStore((s) => s.micOn);
  const items = useStore((s) => s.items);
  useStore((s) => s.hits);
  const list = useMemo(() => participants.filter((p) => p.mode === '2d'), [participants]);
  const listRef = useRef<User[]>(list);
  listRef.current = list;
  const { canvas, tex } = useMemo(() => makeCanvasTexture(BOARD_PX, BOARD_PX), []);
  useEffect(() => {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#292524';
    ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);
    ctx.textBaseline = 'middle';
    ctx.font = '600 52px "Segoe UI", "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#fafaf9';
    ctx.fillText('💻 2Dで参加中', 28, 60);
    ctx.font = '48px "Segoe UI", "Noto Sans JP", sans-serif';
    if (!list.length) {
      ctx.fillStyle = '#a8a29e';
      ctx.fillText('（いません）', 28, ROW_Y + ROW_H / 2);
    }
    list.forEach((p, i) => {
      const y = ROW_Y + i * ROW_H + ROW_H / 2;
      const holding = Object.values(items).some((it) => it.kind === 'hammer' && it.holder === p.id);
      ctx.fillStyle = recentlyHit(p.id) ? '#fde047' : speaking[p.id] ? '#4ade80' : '#e7e5e4';
      const mark = recentlyHit(p.id) ? '💥' : speaking[p.id] ? '🗣' : micOn[p.id] === false ? '🔇' : '・';
      ctx.fillText(`${mark} ${p.name}${holding ? ' 🔨' : ''}`, 28, y);
    });
    tex.needsUpdate = true;
  });
  const data: Interactable = {
    hitTarget: (hit) => {
      if (!hit.uv) return null;
      const i = Math.floor(((1 - hit.uv.y) * BOARD_PX - ROW_Y) / ROW_H);
      return listRef.current[i]?.id ?? null;
    },
  };
  return (
    <mesh position={[-7, 2.4, -ROOM_HALF + 0.12]} userData={data}>
      <planeGeometry args={[3, 3]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
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

// ---------- 付箋 ----------
function Note3D({ note }: { note: Note }) {
  const selfId = useStore((s) => s.selfId);
  const selected = useStore((s) => s.selectedNote === note.id);
  const participants = useStore((s) => s.participants);
  const { canvas, tex } = useMemo(() => makeCanvasTexture(512, 384), []);
  useEffect(() => {
    const other = note.editingBy && note.editingBy !== selfId;
    drawText(canvas, [
      { text: note.text || '（空の付箋）', color: note.text ? '#1c1917' : '#78716c', size: 64 },
      ...(other ? [{ text: `✏ ${nameOf(note.editingBy)} が編集中`, size: 36, color: '#b91c1c' }] : []),
    ], { bg: note.color });
    tex.needsUpdate = true;
  }, [note.text, note.color, note.editingBy, participants, selfId, canvas, tex]);

  const ref = useRef<THREE.Group>(null);
  useFollow(ref, 'note', note.id, note.x, note.z, note.ry);
  const data: Interactable = {
    hint: 'クリック: 編集',
    carry: { type: 'note', id: note.id },
    remove: () => deleteNote(note.id),
    // 文字を打てるようにマウスのロックを外して編集欄を出す
    use: () => { selectNote(note.id); document.exitPointerLock(); },
  };

  return (
    <group ref={ref} position={[note.x, 0, note.z]} rotation-y={note.ry} userData={data}>
      <mesh position-y={(NOTE_Y - 0.6) / 2}>
        <cylinderGeometry args={[0.03, 0.03, NOTE_Y - 0.6]} />
        <meshStandardMaterial color="#78716c" />
      </mesh>
      <group position-y={NOTE_Y}>
        <mesh>
          <boxGeometry args={[1.6, 1.2, 0.04]} />
          <meshStandardMaterial color={note.color} />
        </mesh>
        <mesh position-z={0.021}>
          <planeGeometry args={[1.6, 1.2]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
        <mesh position-z={-0.021} rotation-y={Math.PI}>
          <planeGeometry args={[1.6, 1.2]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
        {selected && (
          <mesh>
            <boxGeometry args={[1.72, 1.32, 0.06]} />
            <meshBasicMaterial color="#f43f5e" wireframe />
          </mesh>
        )}
      </group>
    </group>
  );
}

// ---------- DOM オーバーレイ ----------
function NoteEditor() {
  const id = useStore((s) => s.selectedNote);
  const note = useStore((s) => (id ? s.notes[id] : undefined));
  if (!note) return null;
  const faceMe = () => {
    const a = get().selfAvatar;
    updateNote(note.id, { ry: Math.atan2(a.x - note.x, a.z - note.z) });
  };
  return (
    <div className="noteeditor">
      <textarea
        autoFocus value={note.text} placeholder="付箋の内容"
        style={{ background: note.color }}
        onChange={(e) => updateNote(note.id, { text: e.target.value })}
      />
      <div className="row">
        {NOTE_COLORS.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} onClick={() => updateNote(note.id, { color: c })} />
        ))}
        <button className="small" onClick={faceMe}>こちらに向ける</button>
        <button className="small" onClick={() => deleteNote(note.id)}>削除</button>
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

function addNoteInFront() {
  const a = get().selfAvatar;
  createNote('', { x: clampRoom(a.x - Math.sin(a.ry) * 2), z: clampRoom(a.z - Math.cos(a.ry) * 2), ry: a.ry });
}

export function View3D() {
  const avatars = useStore((s) => s.avatars);
  const notes = useStore((s) => s.notes);
  const items = useStore((s) => s.items);
  const locked = useStore((s) => s.locked);
  const a0 = get().selfAvatar;
  return (
    <div className={`view3d ${locked ? 'locked' : ''}`}>
      <Canvas camera={{ fov: 70, near: 0.05, far: 100, position: [a0.x, EYE, a0.z] }}>
        <color attach="background" args={['#2b2d31']} />
        <RoomMesh />
        <Screen />
        <TwoDBoard />
        {Object.entries(avatars).map(([id, s]) => <Avatar3D key={id} id={id} state={s} />)}
        {Object.values(notes).map((n) => <Note3D key={n.id} note={n} />)}
        {Object.values(items).map((it) => <Item3D key={it.id} item={it} />)}
        <Player />
      </Canvas>
      <Crosshair />
      <div className="tools3d">
        <button className="primary" onClick={addNoteInFront}>＋ 付箋</button>
        <ItemMenu />
      </div>
      <NoteEditor />
    </div>
  );
}
