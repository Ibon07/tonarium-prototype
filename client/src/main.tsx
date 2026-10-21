import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './style.css';

createRoot(document.getElementById('root')!).render(<App />);

// PWA としてインストールできるように（sw.js はキャッシュしない）
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
