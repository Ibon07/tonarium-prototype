import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { t, useLanguage } from './i18n/index.ts';
import { App } from './App.tsx';
import './style.css';

const localPlaytest = import.meta.env.DEV && import.meta.env.VITE_SYSTEM_PLAYTEST === '1';
const systemLibrary = new URLSearchParams(location.search).get('systemLibrary') === '1';
const Playtest = lazy(() => import('./systems/SystemPlaytest.tsx'));
const Library = lazy(() => import('./systems/SystemLibraryPage.tsx'));
function SystemLoading({ playtest = false }: { playtest?: boolean }) {
  useLanguage();
  return <p>{t(playtest ? 'ssPlaytestLoading' : 'ssLibraryLoading')}</p>;
}
createRoot(document.getElementById('root')!).render(systemLibrary ? <Suspense fallback={<SystemLoading />}><Library /></Suspense> : localPlaytest ? <Suspense fallback={<SystemLoading playtest />}><Playtest /></Suspense> : <App />);

// PWA としてインストールできるように（sw.js はキャッシュしない）
if (!localPlaytest && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
