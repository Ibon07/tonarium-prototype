import { useState } from 'react';
import { useStore } from '../store.ts';
import { interactSystemObject, loadSystemMap, standFromSystemSeat } from './api.ts';
import { useSystems } from './state.ts';
import '../shared-assets/shared-assets.css';
import { useSpaceToStand } from './useSpaceToStand.ts';
import { SystemCatalogBrowser } from './SystemCatalogBrowser.tsx';

export function SystemLibrary() {
  useSpaceToStand();
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const state = useSystems(), sid = useStore(s => s.session), self = useStore(s => s.selfId);
  const view = state.sid === sid ? state.view : undefined;
  const run = (action: () => void | Promise<void>) => { try { void Promise.resolve(action()).then(() => setError('')).catch(reason => setError(String(reason))); } catch (reason) { setError(String(reason)); } };
  return <div className="shared-assets-control">
    <button className="chipbtn" onClick={() => setOpen(!open)}>공유 시스템</button>
    {open && <section className="shared-assets-panel" aria-label="공유 시스템 라이브러리">
      <header><h2>공유 시스템</h2><button onClick={() => setOpen(false)}>닫기</button></header>
      <p><a href="/?systemLibrary=1" target="_blank" rel="noreferrer">라이브러리를 별도 화면으로 열기</a></p>
      <SystemCatalogBrowser />
      <button onClick={() => run(() => loadSystemMap('system-demo'))}>버튼·타이머·의자 코드 예제 실행</button>
      {view && <>
        <p>맵: {view.map.id} · 상태 {view.revision}</p>
        {Object.values(view.seats).includes(self) && <p>스페이스바: 일어서기</p>}
        {view.map.objects.filter(o => o.capabilities.includes('interact')).map(object => <button key={object.id} onClick={() => run(() => interactSystemObject(object.id))}>{object.text ?? object.id}</button>)}
        {Object.values(view.seats).includes(self) && <button onClick={() => run(standFromSystemSeat)}>일어나기</button>}
        {view.map.objects.filter(o => o.capabilities.includes('text')).map(object => <p key={object.id}>{view.objects[object.id]?.text ?? object.text}</p>)}
        {view.diagnostics.map((message, index) => <p key={index} role="alert">{message}</p>)}
      </>}
      <p role="status">{error || state.error}</p>
    </section>}
  </div>;
}
