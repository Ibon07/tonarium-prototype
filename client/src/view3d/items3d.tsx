import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { ITEM_INFO, type Item } from '../../../shared/items.ts';
import { useStore, get, nameOf } from '../store.ts';
import { selectNote } from '../actions.ts';
import { itemAction, removeItem } from '../items/actions.ts';
import { COMPAT_ONLY, PANELS, chessSelect } from '../items/panels.ts';
import { drawPanel } from '../items/PanelCanvas.tsx';
import { carrying, type Interactable } from './interact.ts';
import { drawText, makeCanvasTexture } from './textTexture.ts';
import { Camera3D } from './camera3d.tsx';
import { Label } from './Label.tsx';

function useFollow(ref: React.RefObject<THREE.Group | null>, id: string, x: number, z: number, ry: number) {
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const c = carrying.current?.id === id ? carrying.current : null;
    const k = c ? 1 : Math.min(1, dt * 12);
    g.position.x += ((c?.x ?? x) - g.position.x) * k;
    g.position.z += ((c?.z ?? z) - g.position.z) * k;
    let r = (c?.ry ?? ry) - g.rotation.y;
    r = Math.atan2(Math.sin(r), Math.cos(r));
    g.rotation.y += r * k;
  });
}

const removable = (item: Item): Interactable => ({
  carry: item.id,
  remove: () => removeItem(item.id),
});

const NOTE_Y = 1.5;

function Note3D({ item }: { item: Item & { kind: 'note' } }) {
  const selfId = useStore((s) => s.selfId);
  const selected = useStore((s) => s.selectedNote === item.id);
  const participants = useStore((s) => s.participants);
  const { canvas, tex } = useMemo(() => makeCanvasTexture(512, 384), []);
  useEffect(() => {
    const other = item.editingBy && item.editingBy !== selfId;
    drawText(canvas, [
      { text: item.text || '（空の付箋）', color: item.text ? '#1c1917' : '#78716c', size: 64 },
      ...(other ? [{ text: `✏ ${nameOf(item.editingBy)} が編集中`, size: 36, color: '#b91c1c' }] : []),
    ], { bg: item.color });
    tex.needsUpdate = true;
  }, [item.text, item.color, item.editingBy, participants, selfId, canvas, tex]);
  const ref = useRef<THREE.Group>(null);
  useFollow(ref, item.id, item.x, item.z, item.ry);
  const data: Interactable = {
    ...removable(item),
    hint: 'クリック: 編集',
    // 文字を打てるようにマウスのロックを外す
    use: () => { selectNote(item.id); document.exitPointerLock(); },
  };
  return (
    <group ref={ref} position={[item.x, 0, item.z]} rotation-y={item.ry} userData={data}>
      <mesh position-y={(NOTE_Y - 0.6) / 2}>
        <cylinderGeometry args={[0.03, 0.03, NOTE_Y - 0.6]} />
        <meshStandardMaterial color="#78716c" />
      </mesh>
      <group position-y={NOTE_Y}>
        <mesh>
          <boxGeometry args={[1.6, 1.2, 0.04]} />
          <meshStandardMaterial color={item.color} />
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

/** 柄が +Y、頭が Z 方向 */
export function HammerModel(props: ThreeElements['group']) {
  return (
    <group {...props}>
      <mesh position-y={0.28}>
        <cylinderGeometry args={[0.025, 0.03, 0.56, 10]} />
        <meshStandardMaterial color="#facc15" />
      </mesh>
      <group position-y={0.6} rotation-x={Math.PI / 2}>
        <mesh>
          <cylinderGeometry args={[0.1, 0.1, 0.22, 18]} />
          <meshStandardMaterial color="#ef4444" />
        </mesh>
        <mesh position-y={0.13}>
          <cylinderGeometry args={[0.11, 0.11, 0.05, 18]} />
          <meshStandardMaterial color="#fde047" />
        </mesh>
        <mesh position-y={-0.13}>
          <cylinderGeometry args={[0.11, 0.11, 0.05, 18]} />
          <meshStandardMaterial color="#fde047" />
        </mesh>
      </group>
    </group>
  );
}

function Hammer3D({ item }: { item: Item & { kind: 'hammer' } }) {
  const ref = useRef<THREE.Group>(null);
  useFollow(ref, item.id, item.x, item.z, item.ry);
  if (item.holder) return null;
  const data: Interactable = {
    ...removable(item),
    hint: 'クリック: ハンマーを拾う',
    use: () => itemAction(item.id, { a: 'pick' }),
  };
  return (
    <group ref={ref} position={[item.x, 0, item.z]} rotation-y={item.ry} userData={data}>
      <HammerModel position={[0, 0.12, 0.3]} rotation-x={-Math.PI / 2} />
      {/* 拾いやすいよう大きめの当たり判定 */}
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[0.5, 0.3, 0.9]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

const SQ = 0.2;
const TABLE_Y = 0.78;
const PIECE_H: Record<string, number> = { P: 0.13, R: 0.16, N: 0.18, B: 0.2, Q: 0.23, K: 0.26 };

function ChessPiece({ code }: { code: string }) {
  const color = code[0] === 'w' ? '#f5f5f4' : '#27272a';
  const t = code[1];
  const h = PIECE_H[t];
  const mat = <meshStandardMaterial color={color} roughness={0.4} />;
  return (
    <group>
      <mesh position-y={0.02}><cylinderGeometry args={[0.07, 0.075, 0.04, 16]} />{mat}</mesh>
      <mesh position-y={0.04 + (h - 0.06) / 2}><cylinderGeometry args={[0.035, 0.055, h - 0.06, 12]} />{mat}</mesh>
      {t === 'P' && <mesh position-y={h}><sphereGeometry args={[0.045, 12, 10]} />{mat}</mesh>}
      {t === 'R' && <mesh position-y={h}><cylinderGeometry args={[0.06, 0.055, 0.06, 8]} />{mat}</mesh>}
      {t === 'N' && <mesh position={[0, h, 0.02]} rotation-x={-0.5}><boxGeometry args={[0.05, 0.1, 0.09]} />{mat}</mesh>}
      {t === 'B' && <mesh position-y={h}><coneGeometry args={[0.045, 0.1, 12]} />{mat}</mesh>}
      {t === 'Q' && <mesh position-y={h}><sphereGeometry args={[0.06, 14, 10]} />{mat}</mesh>}
      {t === 'K' && (
        <group position-y={h}>
          <mesh><boxGeometry args={[0.025, 0.1, 0.025]} />{mat}</mesh>
          <mesh position-y={0.015}><boxGeometry args={[0.07, 0.025, 0.025]} />{mat}</mesh>
        </group>
      )}
    </group>
  );
}

function Chess3D({ item }: { item: Item & { kind: 'chess' } }) {
  const ref = useRef<THREE.Group>(null);
  useFollow(ref, item.id, item.x, item.z, item.ry);
  const sel = useStore((s) => s.itemUi[item.id]?.sel);
  const pick = (i: number) => () => {
    const it = get().items[item.id];
    if (it) chessSelect(it, get().itemUi[item.id] ?? {}, i);
  };
  const sqData = (i: number): Interactable => ({ use: pick(i), hint: 'クリック: 駒を選ぶ / 動かす' });
  return (
    <group ref={ref} position={[item.x, 0, item.z]} rotation-y={item.ry}>
      {/* 持ち運び・片付けは机に照準を合わせる */}
      <group userData={{ ...removable(item), hint: '♟ チェス' } satisfies Interactable}>
        <mesh position-y={TABLE_Y - 0.03}>
          <boxGeometry args={[1.9, 0.06, 1.9]} />
          <meshStandardMaterial color="#5b3a1e" />
        </mesh>
        {[[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]].map(([lx, lz]) => (
          <mesh key={`${lx},${lz}`} position={[lx, (TABLE_Y - 0.06) / 2, lz]}>
            <boxGeometry args={[0.08, TABLE_Y - 0.06, 0.08]} />
            <meshStandardMaterial color="#4a2f18" />
          </mesh>
        ))}
      </group>
      {item.board.map((code, i) => {
        const r = Math.floor(i / 8);
        const c = i % 8;
        const lx = (c - 3.5) * SQ;
        const lz = (r - 3.5) * SQ;
        const isLast = item.last && (item.last[0] === i || item.last[1] === i);
        const color = sel === i ? '#5865f2' : isLast ? ((r + c) % 2 ? '#aaa23a' : '#cdd26a') : (r + c) % 2 ? '#b58863' : '#f0d9b5';
        return (
          <group key={i} position={[lx, TABLE_Y, lz]} userData={sqData(i)}>
            <mesh position-y={0.01}>
              <boxGeometry args={[SQ, 0.02, SQ]} />
              <meshStandardMaterial color={color} />
            </mesh>
            {code && <group position-y={0.02}><ChessPiece code={code} /></group>}
          </group>
        );
      })}
    </group>
  );
}

const PANEL_H = 1.8;

function CompatPanel3D({ item }: { item: Item }) {
  const ref = useRef<THREE.Group>(null);
  useFollow(ref, item.id, item.x, item.z, item.ry);
  const panel = PANELS[item.kind]!;
  const ui = useStore((s) => s.itemUi[item.id]);
  const { canvas, tex } = useMemo(() => {
    const cv = document.createElement('canvas');
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: cv, tex: t };
  }, []);
  useEffect(() => {
    drawPanel(canvas, item, ui ?? {});
    tex.needsUpdate = true;
  }, [item, ui, canvas, tex]);
  const w = (PANEL_H * panel.w) / panel.h;
  const at = (hit: THREE.Intersection) => [hit.uv!.x * panel.w, (1 - hit.uv!.y) * panel.h] as const;
  const latest = () => [get().items[item.id] ?? item, get().itemUi[item.id] ?? {}] as const;
  const data: Interactable = {
    ...removable(item),
    ...(panel.drag
      ? {
        hint: 'クリックしたまま照準を動かす: 描く',
        drag: (phase, hit) => {
          if (hit?.uv) panel.drag!(phase, ...at(hit), ...latest());
          else if (phase === 'end') panel.drag!('end', 0, 0, ...latest());
        },
      } satisfies Interactable
      : {
        hint: 'クリック: 照準の位置を押す',
        use: (hit) => { if (hit.uv) panel.click(...at(hit), ...latest()); },
      } satisfies Interactable),
  };
  return (
    <group ref={ref} position={[item.x, 0, item.z]} rotation-y={item.ry}>
      <mesh position-y={(1.6 - PANEL_H / 2) / 2}>
        <cylinderGeometry args={[0.04, 0.04, 1.6 - PANEL_H / 2]} />
        <meshStandardMaterial color="#4e5058" />
      </mesh>
      <mesh position={[0, 1.6, -0.03]}>
        <boxGeometry args={[w + 0.08, PANEL_H + 0.08, 0.04]} />
        <meshStandardMaterial color="#1e1f22" />
      </mesh>
      <mesh position-y={1.6} userData={data}>
        <planeGeometry args={[w, PANEL_H]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <Label
        position={[0, 1.6 + PANEL_H / 2 + 0.18, 0]} height={0.16}
        text={`${ITEM_INFO[item.kind].icon} ${ITEM_INFO[item.kind].name}${COMPAT_ONLY[item.kind] ? ' ・ 互換モード' : ''}`}
        bg={COMPAT_ONLY[item.kind] ? 'rgba(88,101,242,0.95)' : 'rgba(0,0,0,0.75)'}
      />
    </group>
  );
}

export function Item3D({ item }: { item: Item }) {
  switch (item.kind) {
    case 'note': return <Note3D item={item} />;
    case 'hammer': return <Hammer3D item={item} />;
    case 'camera': return <Camera3D item={item} />;
    case 'chess': return <Chess3D item={item} />;
    default: return PANELS[item.kind] ? <CompatPanel3D item={item} /> : null;
  }
}
