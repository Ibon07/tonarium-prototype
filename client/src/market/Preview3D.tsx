import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { MarketProduct } from '../../../shared/market.ts';
import { EMOTES, type ActiveEmote } from '../../../shared/emotes.ts';
import { OekakiAvatar } from '../view3d/OekakiAvatar.tsx';
import { useStore } from '../store.ts';
import { Icon } from '../world/Icon.tsx';
import { WorldMesh, WORLD_BG } from '../view3d/worlds3d.tsx';
import { BikeModel } from '../view3d/BikeModel.tsx';

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="market-3d-error">3D プレビューを読み込めませんでした。ページを再読み込みしてください。</p> : this.props.children; }
}

/** Same dimensions and stand as the in-world note, without session interactions. */
function NotePreview({ text }: { text: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 768;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fde68a'; ctx.fillRect(0, 0, 1024, 768);
    ctx.fillStyle = '#1c1917'; ctx.font = '48px sans-serif';
    let y = 105;
    for (const line of text.split('\n')) {
      let row = '';
      for (const char of line) {
        if (ctx.measureText(row + char).width > 900) { ctx.fillText(row, 60, y); y += 75; row = ''; }
        row += char;
      }
      ctx.fillText(row, 60, y); y += 80;
    }
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace;
    return map;
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group>
    <mesh position-y={.45}><cylinderGeometry args={[.03, .03, .9]} /><meshStandardMaterial color="#78716c" /></mesh>
    <group position-y={1.5}>
      <mesh><boxGeometry args={[1.6, 1.2, .04]} /><meshStandardMaterial color="#fde68a" /></mesh>
      {[1, -1].map((side) => <mesh key={side} position-z={side * .021} rotation-y={side === 1 ? 0 : Math.PI}><planeGeometry args={[1.6, 1.2]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>)}
    </group>
  </group>;
}

export default function Preview3D({ product }: { product: MarketProduct }) {
  const name = useStore((s) => s.selfName);
  const avatar = useStore((s) => s.users.find((u) => u.id === s.selfId)?.avatar ?? null);
  const [emote, setEmote] = useState<ActiveEmote | null>(null);
  const controls = useRef<OrbitControlsImpl>(null);
  useEffect(() => {
    if (!emote) return;
    const timer = setTimeout(() => setEmote(null), EMOTES[emote.id].duration);
    return () => clearTimeout(timer);
  }, [emote]);
  const item = product.category === 'items';
  const world = product.category === 'worlds';
  return <div className="market-3d-preview">
    <div className="market-3d-stage" role="img" aria-label={`${product.name}の3Dプレビュー`}>
      <PreviewBoundary>
        <Canvas camera={{ position: world ? [24, 26, 24] : item ? [2.4, 2, 3.7] : [0, 1.05, -4.6], fov: world ? 45 : 35 }} dpr={[1, 1.5]} fallback={<p>このブラウザでは3D表示を利用できません。</p>}>
          <color attach="background" args={[product.category === 'worlds' ? WORLD_BG[product.content] : product.color]} />
          {!world && <><ambientLight intensity={1.8} /><directionalLight position={[3, 5, 4]} intensity={2} /></>}
          <Suspense fallback={null}>
            {product.category === 'worlds' ? <WorldMesh kind={product.content} /> : product.category === 'items' ? product.kind === 'bike' ? <BikeModel /> : <NotePreview text={product.text} /> : <OekakiAvatar name={name} version={avatar} speaking={false} previewEmote={emote} />}
          </Suspense>
          {!world && <mesh rotation-x={-Math.PI / 2} position-y={-.03}><circleGeometry args={[1.45, 48]} /><meshStandardMaterial color="#fffdf9" /></mesh>}
          <OrbitControls ref={controls} target={[0, world ? 0 : item ? 1.1 : .85, 0]} enablePan={false} minDistance={world ? 10 : 2.5} maxDistance={world ? 60 : 7} maxPolarAngle={world ? Math.PI / 2.6 : Math.PI / 2} />
        </Canvas>
      </PreviewBoundary>
      <span className="market-3d-label">3D プレビュー</span>
    </div>
    <div className="market-preview-controls">
      {product.category === 'emotes' && <button className="primary" disabled={!!emote} onClick={() => setEmote({ id: product.content, at: Date.now(), started: performance.now() })}><Icon name="play" />{emote ? 'プレビュー中…' : '動きを見る'}</button>}
      <button onClick={() => controls.current?.reset()}><Icon name="eye" />視点を戻す</button>
    </div>
    <p className="sub wrap" role="status">{emote ? EMOTES[emote.id].caption : 'ドラッグで回転・スクロールで拡大。プレビューは自分だけに表示されます。'}</p>
  </div>;
}
