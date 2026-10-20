import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { jumpHeight, spawnSlot, type AvatarState, type User } from '../../../shared/protocol.ts';
import { NOTE_COLORS } from '../../../shared/items.ts';
import { useStore, get, colorOf, nameOf, heldHammer, heldCamera, worldKindOf } from '../store.ts';
import { selectNote } from '../actions.ts';
import { pitchOf, placesOf } from '../spatial.ts';
import { publishView } from '../net/livekit.ts';
import { editNote, moveItem, removeItem } from '../items/actions.ts';
import { bump, recentlyHit } from '../items/effects.ts';
import { EYE, carrying, type Interactable } from './interact.ts';
import { Player } from './Player.tsx';
import { AttentionGlow, HammerModel, Item3D } from './items3d.tsx';
import { Label } from './Label.tsx';
import { OekakiAvatar } from './OekakiAvatar.tsx';
import { CameraModel, CameraStreamer, CamMonitor } from './camera3d.tsx';
import { WORLD_BG, WorldMesh } from './worlds3d.tsx';
import { ShareDisplay } from './shareDisplay.tsx';

/** 2D で参加している人。3D の人と同じアバターで、スポーンエリア・置かれた場所・ついていく相手の後ろに立つ */
function Standee({ user }: { user: User }) {
  const speaking = useStore((s) => !!s.speaking[user.id]);
  const micOff = useStore((s) => s.voice === 'connected' && s.micOn[user.id] === false);
  const ref = useRef<THREE.Group>(null);
  const card = useRef<THREE.Group>(null);
  const pos0 = spawnSlot(0);
  useFrame((_, dt) => {
    const g = ref.current;
    const s = get();
    const carried = carrying.current?.id === `user:${user.id}` ? carrying.current : null;
    const pos = carried ? { x: carried.x, z: carried.z, ry: carried.ry + Math.PI, small: false } : placesOf(s).get(user.id);
    if (g && pos) {
      const k = carried ? 1 : Math.min(1, dt * 8);
      g.position.x += (pos.x - g.position.x) * k;
      g.position.z += (pos.z - g.position.z) * k;
      let r = pos.ry - g.rotation.y;
      r = Math.atan2(Math.sin(r), Math.cos(r));
      g.rotation.y += r * k;
      const sc = g.scale.x + ((pos.small ? 0.45 : 1) - g.scale.x) * k;
      g.scale.setScalar(sc);
    }
    const b = bump(s.hits[user.id]);
    card.current?.scale.set(1 + 0.3 * b, 1 - 0.45 * b, 1 + 0.3 * b);
  });
  return (
    <group ref={ref} position={[pos0.x, 0, pos0.z]} userData={{ hitTarget: user.id, carry: `user:${user.id}`, hint: `💻 ${user.name}（2Dで参加中）` } satisfies Interactable}>
      <group ref={card}>
        <Suspense fallback={null}>
          <OekakiAvatar name={user.name} version={user.avatar} speaking={speaking} />
        </Suspense>
      </group>
      <mesh position-y={0.65}>
        <cylinderGeometry args={[0.35, 0.35, 1.3, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {speaking && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
          <ringGeometry args={[0.32, 0.42, 32]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      )}
      <Label
        position={[0, 1.3, 0]} text={`2D ${micOff ? '🔇 ' : ''}${user.name}`}
        bg={recentlyHit(user.id) ? 'rgba(240,177,50,0.95)' : speaking ? 'rgba(35,165,90,0.95)' : 'rgba(78,80,88,0.9)'}
        fg={recentlyHit(user.id) ? '#1e1f22' : '#ffffff'}
      />
    </group>
  );
}

function Entrance() {
  const participants = useStore((s) => s.participants);
  useStore((s) => s.hits);
  const in2d = participants.filter((p) => p.mode === '2d');
  return <>{in2d.map((u) => <Standee key={u.id} user={u} />)}</>;
}

/** self は一人称では見えないので隠しておき、カメラで撮るときだけ表示する（renderCamera） */
function Avatar3D({ id, state, self = false }: { id: string; state: AvatarState; self?: boolean }) {
  const name = useStore((s) => s.participants.find((p) => p.id === id)?.name);
  const speaking = useStore((s) => !!s.speaking[id]);
  const micOff = useStore((s) => s.voice === 'connected' && s.micOn[id] === false);
  const holding = useStore((s) => Object.values(s.items).some((i) => i.kind === 'hammer' && i.holder === id));
  const camera = useStore((s) => Object.values(s.items).find((i) => i.kind === 'camera' && i.holder === id));
  const avatarV = useStore((s) => s.participants.find((p) => p.id === id)?.avatar ?? null);
  const ref = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);
  // 途中から見えた人の過去のジャンプは再生しない
  const jump = useRef({ n: state.jump ?? 0, at: -Infinity });
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const k = Math.min(1, dt * 10);
    g.position.x += (state.x - g.position.x) * k;
    g.position.z += (state.z - g.position.z) * k;
    const j = jump.current;
    if ((state.jump ?? 0) !== j.n) { j.n = state.jump ?? 0; j.at = performance.now(); }
    if (state.y !== undefined) g.position.y += (state.y - g.position.y) * Math.min(1, dt * 15);
    else g.position.y = jumpHeight(performance.now() - j.at);
    let d = state.ry - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * k;
    const s = get();
    const b = bump(s.hits[id]);
    body.current?.scale.set(1 + 0.3 * b, 1 - 0.45 * b, 1 + 0.3 * b);
    if (hand.current) hand.current.rotation.x = -0.4 - bump(s.swings[id], performance.now(), 350) * 1.6;
  });
  if (!name) return null;
  return (
    <group
      ref={ref} position={[state.x, 0, state.z]} rotation-y={state.ry} visible={!self}
      userData={self ? { noRay: true, selfBody: true } : ({ hitTarget: id } satisfies Interactable)}
    >
      <group ref={body}>
        <Suspense fallback={null}>
          <OekakiAvatar name={name} version={avatarV} speaking={speaking} look={() => pitchOf(id)} />
        </Suspense>
      </group>
      {/* 板ポリのモデルは横から当てにくいので、照準用の当たり判定を別に置く */}
      <mesh position-y={0.65}>
        <cylinderGeometry args={[0.35, 0.35, 1.3, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {holding && (
        <group ref={hand} position={[0.32, 0.6, -0.1]}>
          <HammerModel />
        </group>
      )}
      {camera?.kind === 'camera' && (
        <>
          <CameraModel live={camera.live} position={[0.2, 0.9, -0.3]} />
          <CamMonitor item={camera} position={[0, 1.95, 0]} />
        </>
      )}
      {speaking && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.45, 0.62, 32]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      )}
      <Label position={[0, 1.3, 0]} text={`${micOff ? '🔇 ' : ''}${name}`} bg={speaking ? 'rgba(35,165,90,0.95)' : 'rgba(0,0,0,0.75)'} />
    </group>
  );
}

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

function ViewStreamer() {
  const { gl } = useThree();
  useEffect(() => {
    let stop: (() => Promise<void>) | null = null;
    let cancelled = false;
    publishView(gl.domElement)
      .then((s) => { if (cancelled) void s(); else stop = s; })
      .catch(() => { /* 通話に未接続なら配信しない */ });
    return () => { cancelled = true; void stop?.(); };
  }, [gl]);
  return null;
}

function Viewfinder() {
  const cam = useStore((s) => heldCamera(s));
  const flashAt = useStore((s) => s.flashAt);
  return (
    <>
      {cam && (
        <div className="viewfinder">
          <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
          {cam.live && <div className="rec">● LIVE 配信中</div>}
        </div>
      )}
      {flashAt > 0 && <div key={flashAt} className="flash" />}
    </>
  );
}

function Crosshair() {
  const locked = useStore((s) => s.locked);
  const hint = useStore((s) => s.aimHint);
  const holding = useStore((s) => !!heldHammer(s) || !!heldCamera(s));
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
          ? <>WASD: 移動 ・ Space: ジャンプ ・ マウス: 視点 ・ クリック: 操作 ・ G: 持ち運ぶ ・ X: 片付ける{holding && ' ・ Q: 手に持った物を置く'} ・ Esc: カーソルを出す</>
          : <>画面をクリックすると操作を始めます（マウスで視点・照準で操作）</>}
      </div>
    </>
  );
}

export function View3D() {
  const avatars = useStore((s) => s.avatars);
  const items = useStore((s) => s.items);
  const locked = useStore((s) => s.locked);
  const selfId = useStore((s) => s.selfId);
  const selfAvatar = useStore((s) => s.selfAvatar);
  const viewLive = useStore((s) => !!s.participants.find((p) => p.id === s.selfId)?.viewLive);
  const world = useStore((s) => worldKindOf(s));
  const a0 = get().selfAvatar;
  return (
    <div className={`view3d ${locked ? 'locked' : ''}`}>
      <Canvas camera={{ fov: 70, near: 0.05, far: 100, position: [a0.x, EYE, a0.z] }}>
        <color attach="background" args={[WORLD_BG[world]]} />
        <WorldMesh kind={world} />
        <ShareDisplay />
        <Entrance />
        {Object.entries(avatars).map(([id, s]) => <Avatar3D key={id} id={id} state={s} />)}
        <Avatar3D id={selfId} state={selfAvatar} self />
        {Object.values(items).map((it) => <Item3D key={it.id} item={it} />)}
        {Object.values(items).map((it) => <AttentionGlow key={`attn-${it.id}`} item={it} />)}
        {Object.values(items).map((it) => (it.kind === 'camera' && it.live && it.operator === selfId
          ? <CameraStreamer key={`stream-${it.id}`} item={it} /> : null))}
        {viewLive && <ViewStreamer />}
        <Player />
      </Canvas>
      <Viewfinder />
      <Crosshair />
      <NoteEditor />
    </div>
  );
}
