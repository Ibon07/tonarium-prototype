import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Group } from 'three';
import type { SystemCommand, SystemView } from '../../../shared/system-types.ts';
import type { Item } from '../../../shared/items.ts';
import { systemSeat } from '../../../shared/system-presentation.ts';
import { useStore } from '../store.ts';
import { OekakiAvatar } from '../view3d/OekakiAvatar.tsx';
import { Label } from '../view3d/Label.tsx';
import { inputSystem, interactSystemObject, useSystemTransport } from './api.ts';
import { receiveSystems, useSystems } from './state.ts';
import { SystemObjects3D } from './SystemObjects3D.tsx';
import './playtest.css';
import { useSpaceToStand } from './useSpaceToStand.ts';
import { Item3D } from '../view3d/items3d.tsx';

interface Reply { sid: string; actor: string; token?: string; participants: string[]; view: SystemView; items?: Item[]; error?: string }
type InputCommand = Exclude<SystemCommand, { kind: 'map' }>;
const ACTORS = { alice: 'Alice', bob: 'Bob' };
const readableError = (message: string) => message.includes('seat occupied') ? '이미 다른 참가자가 앉아 있습니다.' : message.includes('user already seated') ? '선택한 참가자는 이미 다른 자리에 앉아 있습니다.' : message;

function TestAvatar({ actor, index }: { actor: string; index: number }) {
  const group = useRef<Group>(null);
  useFrame((_, dt) => {
    if (!group.current) return;
    const seat = systemSeat(useSystems.getState().view, actor);
    const x = seat?.x ?? -2 + index * 1.5, y = seat?.y ?? 0, z = seat?.z ?? 1;
    const blend = 1 - Math.exp(-dt * 12);
    group.current.position.x += (x - group.current.position.x) * blend;
    group.current.position.y += (y - group.current.position.y) * blend;
    group.current.position.z += (z - group.current.position.z) * blend;
    group.current.rotation.y = Math.PI;
  });
  return <group ref={group} position={[-2 + index * 1.5, 0, 1]}>
    <OekakiAvatar name={ACTORS[actor as keyof typeof ACTORS] ?? actor} version={null} textureUrl="/oekaki/system-playtest.svg" speaking={false} userId={actor} seated={() => !!systemSeat(useSystems.getState().view, actor)} />
    <Label text={ACTORS[actor as keyof typeof ACTORS] ?? actor} position={[0, 1.5, 0]} height={0.18} />
  </group>;
}

export default function SystemPlaytest() {
  useSpaceToStand();
  const slot = new URLSearchParams(location.search).get('actor') === 'bob' ? 'bob' : 'alice';
  const [ready, setReady] = useState(false), [participants, setParticipants] = useState<string[]>([]), [message, setMessage] = useState('연결 중…');
  const [target, setTarget] = useState(slot);
  const state = useSystems(), token = useRef('');
  const items = useStore(store => store.items);
  const view = state.sid === 'system-playtest' ? state.view : undefined;
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined, queue = Promise.resolve();
    const controller = new AbortController();
    const accept = (reply: Reply, snapshot = false) => {
      if (!active) return;
      if (!receiveSystems(reply.sid, reply.view, reply.error, snapshot)) return;
      if (reply.items) useStore.setState(current => {
        const items = Object.fromEntries(reply.items!.map(item => [item.id, item]));
        return { items, itemsBy: { ...current.itemsBy, [reply.sid]: items } };
      });
      setParticipants(reply.participants); setReady(true);
    };
    const request = async (method = 'GET', body?: unknown, endpoint = '') => {
      const response = await fetch(`/api/system-playtest${endpoint}`, { method, headers: { 'Content-Type': 'application/json', 'x-system-playtest-token': token.current }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      const reply = await response.json() as Reply;
      if (reply.view) accept(reply);
      return { response, reply };
    };
    const cleanupTransport = useSystemTransport({
      command(command) {
        queue = queue.then(async () => {
          const current = useSystems.getState().view;
          let result = await request('POST', { command: { ...command, revision: current?.revision ?? command.revision } });
          if (result.response.status === 409 && result.reply.error?.includes('revision') && result.reply.view) result = await request('POST', { command: { ...command, revision: result.reply.view.revision } });
          if (!result.response.ok) throw new Error(result.reply.error ?? '입력을 처리하지 못했습니다.');
          setMessage('동작이 반영됐습니다.');
        }).catch(reason => { if (active) setMessage(readableError(String(reason instanceof Error ? reason.message : reason))); });
      },
      load() { setMessage('이 화면은 코드로 작성된 시스템 예제를 사용합니다.'); },
    });
    const poll = async () => {
      try { const result = await request(); if (!result.response.ok) throw new Error(result.reply.error); }
      catch (reason) { if (active) setMessage(`연결 확인 필요: ${String(reason)}`); }
      if (active) timer = setTimeout(() => void poll(), 200);
    };
    void request('POST', { slot }, '/join').then(({ response, reply }) => {
      if (!response.ok || !reply.token) throw new Error(reply.error ?? '로컬 참가자로 연결하지 못했습니다.');
      token.current = reply.token;
      useStore.setState({ session: reply.sid, selfId: reply.actor, selfName: ACTORS[slot] });
      accept(reply, true); setMessage('준비됐습니다. 화면의 오브젝트나 아래 버튼을 눌러 보세요.');
      return poll();
    }).catch(reason => { if (active) setMessage(String(reason)); });
    return () => {
      active = false; controller.abort(); if (timer) clearTimeout(timer); cleanupTransport();
      if (token.current) void fetch('/api/system-playtest/leave', { method: 'POST', headers: { 'x-system-playtest-token': token.current }, keepalive: true }).catch(() => {});
    };
  }, [slot]);
  const run = (action: () => void) => { try { action(); } catch (reason) { setMessage(String(reason)); } };
  const timer = view?.systems.find(s => s.instanceId === 'countdown');
  return <main className="system-playtest">
    <header><div><span className="playtest-badge">LOCAL TEST</span><h1>공유 시스템 테스트</h1><p>모델 연결 · 버튼으로 타이머 제어 · 의자 앉기</p></div>
      <div className="playtest-identity"><strong>{ACTORS[slot]}</strong><span>{ready ? '연결됨' : '연결 중'}</span><a href="/?systemLibrary=1" target="_blank" rel="noreferrer">등록된 공유 시스템 보기</a><a href={`/?systemPlaytest=1&actor=${slot === 'alice' ? 'bob' : 'alice'}`} target="_blank" rel="noreferrer">다른 참가자 창 열기</a></div>
    </header>
    <div className="playtest-layout"><section className="playtest-scene" aria-label="시스템 3D 시험 장면">
      <Canvas camera={{ position: [5, 3.5, 6], fov: 45 }} shadows>
        <color attach="background" args={['#e9eef4']} /><ambientLight intensity={1.5} /><directionalLight position={[5, 8, 3]} intensity={2} />
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, -1]} receiveShadow><planeGeometry args={[22, 18]} /><meshStandardMaterial color="#d8e1eb" /></mesh>
        <gridHelper args={[20, 20, '#acbacb', '#cbd5e1']} position-y={0.005} />
        <Suspense fallback={null}><SystemObjects3D sessionId="system-playtest" />{Object.values(items).map(item => <Item3D key={item.id} item={item} />)}{participants.map((actor, index) => <TestAvatar key={actor} actor={actor} index={index} />)}</Suspense>
        <OrbitControls target={[0, 1, -1]} minDistance={3} maxDistance={22} maxPolarAngle={Math.PI / 2 - 0.04} />
      </Canvas><p className="playtest-camera-help">드래그: 시점 회전 · 휠: 확대/축소 · 클릭: 상호작용 · 스페이스바: 일어서기</p>
    </section>
    <aside className="playtest-controls"><h2>동작 확인</h2><div className="playtest-timer" aria-label="남은 시간">{view?.objects['timer-text']?.text ?? '00:10'}</div>
      <p>타이머: <strong>{timer?.state.running ? '진행 중' : timer?.state.remaining === 0 ? '완료' : '멈춤'}</strong></p>
      <div className="playtest-buttons"><button disabled={!ready} onClick={() => run(() => interactSystemObject('start-button'))}>시작</button><button disabled={!ready} onClick={() => run(() => interactSystemObject('pause-button'))}>일시정지</button><button disabled={!ready} onClick={() => run(() => interactSystemObject('reset-button'))}>초기화</button></div>
      <h2>의자 확인</h2><label>앉힐 참가자<select value={target} onChange={event => setTarget(event.target.value as typeof slot)}>{participants.map(actor => <option key={actor} value={actor}>{ACTORS[actor as keyof typeof ACTORS] ?? actor}</option>)}</select></label>
      <div className="playtest-buttons"><button disabled={!ready} onClick={() => run(() => inputSystem('seat', 'sit', { user: target }))}>선택한 참가자 앉히기</button><button disabled={!ready} onClick={() => run(() => inputSystem('seat', 'stand', { user: target }))}>일어서기</button></div>
      <p>의자 사용: <strong>{view?.seats['chair-object'] ? ACTORS[view.seats['chair-object'] as keyof typeof ACTORS] : '비어 있음'}</strong></p>
      <button disabled={!ready} onClick={() => useStore.setState(current => ({ emotes: { ...current.emotes, [target]: { id: 'wave', at: Date.now(), started: performance.now() } } }))}>손 흔들기 (이 창)</button>
      <p className="playtest-status" role="status">{state.error || message}</p>
      <details><summary>확인할 순서</summary><ol><li>시작 → 시간이 줄고 표시되는지 확인</li><li>일시정지 → 멈춤, 다시 시작 → 이어짐 확인</li><li>00:00 → 완료 표시, 초기화 → 00:10 복귀 확인</li><li>앉히기 → 자세 전환, 스페이스바 → 일어서기 확인</li><li>다른 창에서도 같은 상태인지 확인</li><li>다른 사람이 앉은 자리를 요청해 거부되는지 확인</li></ol></details>
      {view?.diagnostics.map((item, index) => <p role="alert" key={index}>{item}</p>)}
      <small>운영 서버와 분리된 로컬 데이터로 실행합니다.</small>
    </aside></div>
  </main>;
}
