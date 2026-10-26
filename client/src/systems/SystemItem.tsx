import type { ReactNode } from 'react';
import type { Item } from '../../../shared/items.ts';
import { useStore } from '../store.ts';
import type { Interactable } from '../view3d/interact.ts';
import { interactSystemObject } from './api.ts';
import { controlledItemObject } from './map-item-control.ts';
import { useSystems } from './state.ts';
import { Label } from '../view3d/Label.tsx';

function useSystemItem(item: Item) {
  const state = useSystems(), session = useStore(store => store.session);
  const object = controlledItemObject(item, session, state);
  const interactive = !!object?.capabilities.includes('interact');
  const use = () => {
    const current = useStore.getState(), latest = current.items[item.id];
    const target = latest && controlledItemObject(latest, current.session, useSystems.getState());
    if (target?.capabilities.includes('interact')) {
      try { interactSystemObject(target.id); } catch (error) { useSystems.setState({ error: String(error) }); }
    }
  };
  return { interactive, use, label: object?.text };
}

export function SystemItemBoundary({ item, children }: { item: Item; children: ReactNode }) {
  const action = useSystemItem(item);
  const data: Interactable = { interactionBoundary: true, hint: action.interactive ? '공유 시스템 실행' : '공유 시스템이 제어하는 오브젝트', ...(action.interactive ? { use: action.use } : {}) };
  // 既存モデルが絶対座標を持つため、この境界では座標を変更しない。
  return <group userData={data} onClick={event => { if (!document.pointerLockElement) { event.stopPropagation(); if (action.interactive) action.use(); } }}>{children}{item.kind !== 'note' && action.label && <Label text={action.label} position={[item.x, 1.5, item.z]} height={0.17} />}</group>;
}

export function SystemItemPanel({ item }: { item: Item }) {
  const action = useSystemItem(item);
  return <div style={{ padding: 18 }}><p>공유 시스템에 연결된 오브젝트입니다.</p>{item.kind === 'note' && <p style={{ whiteSpace: 'pre-wrap', fontSize: 24 }}>{item.text}</p>}{action.interactive && <button type="button" onClick={action.use}>{action.label ?? '공유 시스템 실행'}</button>}</div>;
}
