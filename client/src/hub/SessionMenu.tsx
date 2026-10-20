import { useRef, useState } from 'react';
import { useStore, set } from '../store.ts';
import { Icon } from '../world/Icon.tsx';
import { HubMenu, HubOverlay } from './Hub.tsx';
import { openHubPage } from './data.ts';

/** セッション中の左上のメニュー。ホバーで項目が左から出て、ボタンを押すと最後に開いたページを重ねて開く */
export function SessionMenu() {
  const hubOpen = useStore((s) => s.hubOpen);
  const last = useStore((s) => s.hubPage);
  const [hover, setHover] = useState(false);
  // 項目へ動かす途中で一瞬外れても閉じないよう、少し待ってから閉じる
  const timer = useRef(0);
  const enter = () => { clearTimeout(timer.current); setHover(true); };
  const leave = () => { timer.current = window.setTimeout(() => setHover(false), 180); };
  const show = hover && !hubOpen;
  return (
    <>
      {hubOpen && <HubOverlay />}
      <div className="smenu" onMouseEnter={enter} onMouseLeave={leave}>
        <button
          className={`smenubtn ${hubOpen ? 'on' : ''}`} aria-label="メニュー（最後に開いたページを開く）" title="メニュー" aria-expanded={hubOpen}
          onClick={() => { set({ hubOpen: !hubOpen }); setHover(false); }}
        ><Icon name="menu" size={20} /></button>
        <div className="smenubridge" aria-hidden="true" style={{ pointerEvents: show ? 'auto' : 'none' }} />
        <nav className={`smenunav ${show ? 'show' : ''}`} aria-label="メニュー" aria-hidden={!show}>
          <HubMenu current={null} inSession lastDot={last} onPick={(p) => { openHubPage(p); set({ hubOpen: true }); setHover(false); }} />
        </nav>
      </div>
    </>
  );
}
