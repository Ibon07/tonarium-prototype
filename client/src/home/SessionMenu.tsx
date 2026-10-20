import { useEffect, useRef, useState } from 'react';
import { useStore, set, sessionOf } from '../store.ts';
import { Icon } from '../world/Icon.tsx';
import { Home, Sidebar } from './Home.tsx';

/** セッション中に、背面を暗くぼかしてホームをシートで重ねる。Esc か背面のクリックで閉じる */
function HomeOverlay() {
  const sessionName = useStore((s) => sessionOf(s.session)?.name);
  const count = useStore((s) => s.participants.length);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ hubOpen: false }); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="hoverlay">
      <div className="hoverlaybg" onClick={() => set({ hubOpen: false })} />
      <div className="hnow"><i />参加中：<strong>{sessionName}</strong><span>· {count} 人</span></div>
      <button className="hoverlayclose" aria-label="閉じる" onClick={() => set({ hubOpen: false })}><Icon name="close" size={18} /></button>
      <Home sheet />
    </div>
  );
}

/** セッション中の左上のメニュー。ホバーで項目が左から出て、ボタンを押すと最後に開いたページを重ねて開く */
export function SessionMenu() {
  const hubOpen = useStore((s) => s.hubOpen);
  const [hover, setHover] = useState(false);
  // 項目へ動かす途中で一瞬外れても閉じないよう、少し待ってから閉じる
  const timer = useRef(0);
  const enter = () => { clearTimeout(timer.current); setHover(true); };
  const leave = () => { timer.current = window.setTimeout(() => setHover(false), 180); };
  const show = hover && !hubOpen;
  return (
    <>
      {hubOpen && <HomeOverlay />}
      <div className="smenu" onMouseEnter={enter} onMouseLeave={leave}>
        <button
          className={`smenubtn ${hubOpen ? 'on' : ''}`} aria-label="メニュー（最後に開いたページを開く）" title="メニュー" aria-expanded={hubOpen}
          onClick={() => { set({ hubOpen: !hubOpen }); setHover(false); }}
        ><Icon name="menu" size={20} /></button>
        <div className="smenubridge" aria-hidden="true" style={{ pointerEvents: show ? 'auto' : 'none' }} />
        <div className={`smenunav ${show ? 'show' : ''}`} aria-hidden={!show}>
          <Sidebar inSession onPick={() => { set({ hubOpen: true }); setHover(false); }} />
        </div>
      </div>
    </>
  );
}
