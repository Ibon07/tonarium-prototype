// oekaki-avatar の Avatar.tsx を元にしたもの
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useGraph } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { DEFAULT_PARAMS, sanitizeParams, type AvatarParams } from '../../../shared/avatar.ts';
import { avatarParamsUrl, avatarTextureUrl } from '../avatar.ts';

const MODEL = '/oekaki/avatar.glb';
useGLTF.preload(MODEL);

const TEXTURED = new Set([
  'Head_Front', 'Head_Back', 'Body_Front', 'Body_Back', 'LeftHand_Front', 'LeftHand_Back', 'RightHand_Front',
  'RightHand_Back', 'LeftFoot_Front', 'LeftFoot_Back', 'RightFoot_Front', 'RightFoot_Back', 'Tail_Front', 'Tail_Back',
]);
// 顔のテクスチャをずらして表情を切り替える
const FACE = { normal: 0, eyesClosed: 1 / 6, mouthOpen: -1 / 6 };

function baseAnimation(p: AvatarParams) {
  const v = (name: string, x: number, y: number, z: number) => new THREE.VectorKeyframeTrack(name, [0], [x, y, z]);
  const tail = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, p.tailRotation));
  const clip = new THREE.AnimationClip('BaseAnimation', 1, [
    v('Head_Front.scale', p.headSize, p.headSize, p.headSize),
    v('Head_Back.scale', p.headSize, p.headSize, p.headSize),
    v('Body.position', 0, -p.neckLength, p.headInFront ? -0.5 : 0.5),
    v('LeftHand.scale', p.handSize, p.handSize, p.handSize),
    v('RightHand.scale', p.handSize, p.handSize, p.handSize),
    v('Body_Front.scale', p.bodySize, p.bodySize, p.bodySize),
    v('Body_Back.scale', p.bodySize, p.bodySize, p.bodySize),
    v('Tail.scale', p.tailSize, p.tailSize, p.tailSize),
    v('Tail.position', 0, -p.tailPosition, 0),
    new THREE.QuaternionKeyframeTrack('Tail.quaternion', [0], tail.toArray()),
    v('Feet.scale', p.legsSize, p.legsSize, p.legsSize),
    v('LeftFoot.position', p.legsDistance, 0, 0),
    v('RightFoot.position', -p.legsDistance, 0, 0.001),
    v('Feet.position', 0, -p.legsDistanceFromBody, p.legsInFront ? 0.5 : -0.5),
  ]);
  clip.blendMode = THREE.AdditiveAnimationBlendMode;
  return clip;
}

/** モデルは +Z 向きなので、こちらの「前 = -Z」に合わせて回してある */
export function OekakiAvatar({ name, version, speaking }: { name: string; version: string | null; speaking: boolean }) {
  const { scene, animations } = useGLTF(MODEL);
  const clone = useMemo(() => scene.clone(), [scene]);
  const { nodes } = useGraph(clone);
  const [params, setParams] = useState<AvatarParams>(DEFAULT_PARAMS);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const mixer = useMemo(() => new THREE.AnimationMixer(clone), [clone]);
  const face = useRef<THREE.Texture | null>(null);
  const blink = useRef(0);

  useEffect(() => {
    let alive = true;
    void new THREE.TextureLoader().loadAsync(avatarTextureUrl(name, version)).then((t) => {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      if (alive) setTexture(t); else t.dispose();
    });
    setParams(DEFAULT_PARAMS);
    if (version) {
      void fetch(avatarParamsUrl(name, version))
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => { if (alive && p) setParams(sanitizeParams(p)); });
    }
    return () => { alive = false; };
  }, [name, version]);

  useEffect(() => {
    if (!texture) return;
    const faceMap = texture.clone();
    face.current = faceMap;
    const faceMat = new THREE.MeshBasicMaterial({ map: faceMap, alphaTest: 0.5 });
    const bodyMat = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 });
    for (const [key, obj] of Object.entries(nodes)) {
      if (TEXTURED.has(key) && (obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).material = key === 'Head_Front' ? faceMat : bodyMat;
    }
    return () => { faceMat.dispose(); bodyMat.dispose(); faceMap.dispose(); texture.dispose(); };
  }, [nodes, texture]);

  useEffect(() => {
    const actions = animations.map((clip) => mixer.clipAction(clip));
    actions.forEach((a) => a.play());
    return () => actions.forEach((a) => a.stop());
  }, [animations, mixer]);

  useEffect(() => {
    const action = mixer.clipAction(baseAnimation(params));
    action.blendMode = THREE.AdditiveAnimationBlendMode;
    action.play();
    if (nodes.Tail) nodes.Tail.visible = !params.disableTail;
    return () => { action.stop(); };
  }, [params, mixer, nodes]);

  useFrame((_, dt) => {
    mixer.update(dt);
    const f = face.current;
    if (!f) return;
    // 話している間は口を開け、それ以外はときどきまばたき
    if (blink.current > 0) blink.current -= dt;
    else if (Math.random() < 0.004) blink.current = 0.15;
    const mouth = speaking && Math.sin(performance.now() / 90) > 0;
    f.offset.x = mouth ? FACE.mouthOpen : blink.current > 0 ? FACE.eyesClosed : FACE.normal;
  });

  return <primitive object={clone} scale={0.012} rotation-y={Math.PI} />;
}
