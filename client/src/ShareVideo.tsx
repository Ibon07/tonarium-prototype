import { useEffect, useRef } from 'react';
import { shareVideoEl } from './net/livekit.ts';

// 配信用 <video> は1つだけ。表示側はこの要素を自分のコンテナに移すだけで、
// 外れたら常駐ホルダーへ戻す（同一タスク内の移動なので再生は止まらない）。
const holder = document.createElement('div');
Object.assign(holder.style, {
  position: 'fixed', left: '0', bottom: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none',
});
document.body.appendChild(holder);
holder.appendChild(shareVideoEl);

export function ShareVideoHost({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    host.appendChild(shareVideoEl);
    void shareVideoEl.play().catch(() => {});
    return () => {
      holder.appendChild(shareVideoEl);
      void shareVideoEl.play().catch(() => {});
    };
  }, []);
  return <div ref={ref} className={className} />;
}
