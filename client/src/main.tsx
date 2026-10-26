import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { App } from './App.tsx';
import './style.css';

const localPlaytest = import.meta.env.DEV && import.meta.env.VITE_SYSTEM_PLAYTEST === '1';
const systemLibrary = new URLSearchParams(location.search).get('systemLibrary') === '1';
const Playtest = lazy(() => import('./systems/SystemPlaytest.tsx'));
const Library = lazy(() => import('./systems/SystemLibraryPage.tsx'));
createRoot(document.getElementById('root')!).render(systemLibrary ? <Suspense fallback={<p>공유 시스템 목록을 준비하고 있습니다…</p>}><Library /></Suspense> : localPlaytest ? <Suspense fallback={<p>로컬 테스트를 준비하고 있습니다…</p>}><Playtest /></Suspense> : <App />);

// PWA としてインストールできるように（sw.js はキャッシュしない）
if (!localPlaytest && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
