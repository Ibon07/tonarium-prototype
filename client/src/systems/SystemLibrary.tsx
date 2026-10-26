import { useState } from 'react';
import { useStore } from '../store.ts';
import { interactSystemObject, loadSystemMap, standFromSystemSeat } from './api.ts';
import { useSystems } from './state.ts';
import '../shared-assets/shared-assets.css';
import { useSpaceToStand } from './useSpaceToStand.ts';
import { SystemCatalogBrowser } from './SystemCatalogBrowser.tsx';
import { t, useLanguage } from '../i18n/index.ts';
import { systemObjectLabel } from './catalog-labels.ts';
import { systemErrorText } from './messages.ts';

export function SystemLibrary() {
  useLanguage();
  useSpaceToStand();
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const state = useSystems(), sid = useStore(s => s.session), self = useStore(s => s.selfId);
  const view = state.sid === sid ? state.view : undefined;
  const run = (action: () => void | Promise<void>) => { try { void Promise.resolve(action()).then(() => setError('')).catch(reason => setError(String(reason))); } catch (reason) { setError(String(reason)); } };
  return <div className="shared-assets-control">
    <button className="chipbtn" onClick={() => setOpen(!open)}>{t('sharedSystems')}</button>
    {open && <section className="shared-assets-panel" aria-label={t('ssCatalogLibraryTitle')}>
      <header><h2>{t('sharedSystems')}</h2><button onClick={() => setOpen(false)}>{t('ssCatalogClose')}</button></header>
      <p><a href="/?systemLibrary=1" target="_blank" rel="noreferrer">{t('ssCatalogSeparateLibrary')}</a></p>
      <SystemCatalogBrowser />
      <button onClick={() => run(() => loadSystemMap('system-demo'))}>{t('ssCatalogRunDemo')}</button>
      {view && <>
        <p>{t('ssCatalogMapRevision', view.map.id, view.revision)}</p>
        {Object.values(view.seats).includes(self) && <p>{t('ssCatalogSpaceStand')}</p>}
        {view.map.objects.filter(o => o.capabilities.includes('interact')).map(object => <button key={object.id} onClick={() => run(() => interactSystemObject(object.id))}>{systemObjectLabel(view, object)}</button>)}
        {Object.values(view.seats).includes(self) && <button onClick={() => run(standFromSystemSeat)}>{t('ssCatalogStand')}</button>}
        {view.map.objects.filter(o => o.capabilities.includes('text')).map(object => <p key={object.id}>{view.objects[object.id]?.text ?? object.text}</p>)}
        {view.diagnostics.map((message, index) => <p key={index} role="alert">{systemErrorText(message)}</p>)}
      </>}
      <p role="status">{systemErrorText(error || state.error || '')}</p>
    </section>}
  </div>;
}
