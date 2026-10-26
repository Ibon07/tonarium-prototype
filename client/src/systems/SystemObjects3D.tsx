import { useStore } from '../store.ts';
import { Label } from '../view3d/Label.tsx';
import { SystemObject } from './SystemObject.tsx';
import { demoModel } from './demo-models.tsx';
import { useSystems } from './state.ts';

export function SystemObjects3D({ sessionId }: { sessionId?: string } = {}) {
  const appSid = useStore(s => s.session), state = useSystems();
  const sid = sessionId ?? appSid;
  if (sid !== state.sid || !state.view) return null;
  const view = state.view;
  return <>{view.map.objects.filter(object => !object.itemId).map(object => {
    const size = object.size ?? [1, 1, 1];
    return <SystemObject key={object.id} objectId={object.id} sessionId={sid ?? undefined}>
      {text => <>{view.map.id === 'system-demo' ? demoModel(object, text) : <mesh position={[0, size[1] / 2, 0]}>
        <boxGeometry args={size} /><meshStandardMaterial color={object.color ?? '#7488a6'} />
      </mesh>}
      {!object.capabilities.includes('text') && <Label position={[0, size[1] + 0.25, 0]} text={object.text ?? object.id} height={0.2} />}
      </>}
    </SystemObject>;
  })}</>;
}
