import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ROOM_HALF, NOTE_COLORS, type AvatarState, type Note } from '../../../shared/protocol.ts';
import { useStore, get, set, colorOf, nameOf } from '../store.ts';
import { send } from '../net/ws.ts';
import { shareVideoEl } from '../net/livekit.ts';
import { createNote, deleteNote, selectNote, updateNote } from '../actions.ts';
import { drawText, makeCanvasTexture } from './textTexture.ts';

const EYE = 1.6;
const NOTE_Y = 1.5;
const SPEED = 4;
const LIMIT = ROOM_HALF - 0.5;

/** R3F のオブジェクトイベントと、視点ドラッグ（DOM）との橋渡し */
const interaction = {
  hitObject: false,
  dragNote: null as null | { id: string; x: number; z: number; last: number },
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const clamp = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v));

// ---------- 自分（一人称カメラ・移動・送信） ----------
function Player() {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const look = useRef({ yaw: get().selfAvatar.ry, pitch: -0.05 });
  const sent = useRef({ t: 0, x: NaN, z: NaN, ry: NaN });

  useEffect(() => {
    const a = get().selfAvatar;
    camera.position.set(a.x, EYE, a.z);
    camera.rotation.order = 'YXZ';

    let dragging = false;
    let lx = 0;
    let ly = 0;
    const kd = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      keys.current[e.code] = true;
      if (e.code === 'Escape') selectNote(null);
    };
    const ku = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    const blur = () => { keys.current = {}; };
    // window の bubble で受けるので、R3F のオブジェクトイベントが先に hitObject を立てる
    const pd = (e: PointerEvent) => {
      if (e.target !== gl.domElement) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      lx = e.clientX; ly = e.clientY;
      if (interaction.hitObject) { interaction.hitObject = false; return; }
      dragging = true;
    };
    const pm = (e: PointerEvent) => {
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      const d = interaction.dragNote;
      if (d) {
        // 付箋ドラッグ: 横移動=カメラの左右、縦移動=奥行き
        const yaw = look.current.yaw;
        const k = 0.02;
        d.x = clamp(d.x + Math.cos(yaw) * dx * k + Math.sin(yaw) * dy * k);
        d.z = clamp(d.z - Math.sin(yaw) * dx * k + Math.cos(yaw) * dy * k);
        const now = performance.now();
        if (now - d.last > 60) { d.last = now; updateNote(d.id, { x: d.x, z: d.z }); }
        return;
      }
      if (!dragging) return;
      look.current.yaw -= dx * 0.005;
      look.current.pitch = Math.max(-1.3, Math.min(1.3, look.current.pitch - dy * 0.005));
    };
    const pu = () => {
      dragging = false;
      const d = interaction.dragNote;
      if (d) { updateNote(d.id, { x: d.x, z: d.z }); interaction.dragNote = null; }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    window.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
    };
  }, [camera, gl]);

  useFrame((_, dt) => {
    const { yaw, pitch } = look.current;
    camera.rotation.set(pitch, yaw, 0);
    const k = keys.current;
    const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const r = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    if (f || r) {
      const len = Math.hypot(f, r);
      const step = (SPEED * Math.min(dt, 0.1)) / len;
      camera.position.x = clamp(camera.position.x + (-Math.sin(yaw) * f + Math.cos(yaw) * r) * step);
      camera.position.z = clamp(camera.position.z + (-Math.cos(yaw) * f - Math.sin(yaw) * r) * step);
    }
    const now = performance.now();
    const s = sent.current;
    const x = camera.position.x;
    const z = camera.position.z;
    if (now - s.t > 100 && (Math.abs(x - s.x) > 0.01 || Math.abs(z - s.z) > 0.01 || Math.abs(yaw - s.ry) > 0.01)) {
      Object.assign(s, { t: now, x, z, ry: yaw });
      const a: AvatarState = { x, z, ry: yaw };
      set({ selfAvatar: a });
      send({ t: 'avatar', s: a });
    }
  });
  return null;
}

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
      <gridHelper args={[2 * H, 20, '#5c5f66', '#4a4d54']} position-y={0.005} />
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

// ---------- 2D 参加者の掲示板 ----------
function TwoDBoard() {
  const participants = useStore((s) => s.participants);
  const speaking = useStore((s) => s.speaking);
  const micOn = useStore((s) => s.micOn);
  const { canvas, tex } = useMemo(() => makeCanvasTexture(512, 512), []);
  useEffect(() => {
    const list = participants.filter((p) => p.mode === '2d');
    drawText(canvas, [
      { text: '💻 2Dで参加中', size: 60, color: '#fafaf9' },
      ...(list.length
        ? list.map((p) => ({
          text: `${speaking[p.id] ? '🗣' : micOn[p.id] ? '・' : '🔇'} ${p.name}`,
          size: 52,
          color: speaking[p.id] ? '#4ade80' : '#e7e5e4',
        }))
        : [{ text: '（いません）', size: 36, color: '#a8a29e' }]),
    ], { bg: '#292524' });
    tex.needsUpdate = true;
  }, [participants, speaking, micOn, canvas, tex]);
  return (
    <mesh position={[-7, 2.4, -ROOM_HALF + 0.12]}>
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
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const k = Math.min(1, dt * 10);
    g.position.x += (state.x - g.position.x) * k;
    g.position.z += (state.z - g.position.z) * k;
    let d = state.ry - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * k;
  });
  if (!name) return null;
  const color = colorOf(id);
  return (
    <group ref={ref} position={[state.x, 0, state.z]} rotation-y={state.ry}>
      <mesh position-y={0.75}>
        <capsuleGeometry args={[0.3, 0.8, 4, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position-y={1.45}>
        <sphereGeometry args={[0.24, 20, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.48, -0.2]}>
        <boxGeometry args={[0.3, 0.1, 0.1]} />
        <meshStandardMaterial color="#1c1917" />
      </mesh>
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
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    // ドラッグ中は手元の値を即時に、それ以外は滑らかに追従
    const d = interaction.dragNote?.id === note.id ? interaction.dragNote : null;
    const k = d ? 1 : Math.min(1, dt * 12);
    g.position.x += ((d?.x ?? note.x) - g.position.x) * k;
    g.position.z += ((d?.z ?? note.z) - g.position.z) * k;
    let r = note.ry - g.rotation.y;
    r = Math.atan2(Math.sin(r), Math.cos(r));
    g.rotation.y += r * Math.min(1, dt * 12);
  });

  return (
    <group
      ref={ref} position={[note.x, 0, note.z]} rotation-y={note.ry}
      onPointerDown={(e) => {
        e.stopPropagation();
        interaction.hitObject = true;
        selectNote(note.id);
        interaction.dragNote = { id: note.id, x: note.x, z: note.z, last: 0 };
      }}
      onPointerOver={() => { document.body.style.cursor = 'grab'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}
    >
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
    <div className="noteeditor" onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        value={note.text} placeholder="付箋の内容"
        style={{ background: note.color }}
        onChange={(e) => updateNote(note.id, { text: e.target.value })}
      />
      <div className="row">
        {NOTE_COLORS.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} onClick={() => updateNote(note.id, { color: c })} />
        ))}
        <button className="small" onClick={faceMe}>こちらに向ける</button>
        <button className="small" onClick={() => deleteNote(note.id)}>削除</button>
        <button className="small" onClick={() => selectNote(null)}>閉じる (Esc)</button>
      </div>
      <small>付箋をドラッグすると移動できます</small>
    </div>
  );
}

function addNoteInFront() {
  const a = get().selfAvatar;
  createNote('', { x: clamp(a.x - Math.sin(a.ry) * 2), z: clamp(a.z - Math.cos(a.ry) * 2), ry: a.ry });
}

export function View3D() {
  const avatars = useStore((s) => s.avatars);
  const notes = useStore((s) => s.notes);
  const a0 = get().selfAvatar;
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  return (
    <div className="view3d">
      <Canvas camera={{ fov: 70, near: 0.1, far: 100, position: [a0.x, EYE, a0.z] }}>
        <color attach="background" args={["#2b2d31"]} />
        <RoomMesh />
        <Screen />
        <TwoDBoard />
        {Object.entries(avatars).map(([id, s]) => <Avatar3D key={id} id={id} state={s} />)}
        {Object.values(notes).map((n) => <Note3D key={n.id} note={n} />)}
        <Player />
      </Canvas>
      <button className="addnote3d primary" onClick={addNoteInFront}>＋ 目の前に付箋を置く</button>
      <NoteEditor />
    </div>
  );
}
