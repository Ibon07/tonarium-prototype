import { useImperativeHandle, useRef, type Ref } from 'react';

/** マスコット。tona（紫）と rimu（オレンジ） */
export type MascotName = 'tona' | 'rimu';

export interface MascotHandle { hop: () => void }

/** 外側でのぞき込み、中でぴょんと跳ね、いちばん内側で息をするように揺れる。クリックでも跳ねる */
export function PeekMascot({ who, ref }: { who: MascotName; ref?: Ref<MascotHandle> }) {
  const hopRef = useRef<HTMLSpanElement>(null);
  const hop = () => {
    const el = hopRef.current;
    if (!el) return;
    el.classList.remove('hop');
    void el.offsetWidth; // reflow してアニメーションをやり直す
    el.classList.add('hop');
  };
  useImperativeHandle(ref, () => ({ hop }), []);
  return (
    <span className={`mpeek ${who}`} aria-hidden="true" onClick={hop}>
      <span ref={hopRef} className="mhop">
        <img className="mbody" src={`/brand/${who}.webp`} alt="" draggable={false} />
      </span>
    </span>
  );
}

/** 切り替え中の画面で交互に跳ねる 2 人。3D へは跳びながらくるっと回り、2D へは着地でぺたんとつぶれる */
export function HoppingMascots({ to }: { to: '2d' | '3d' }) {
  return (
    <div className={`mhopping to${to}`} aria-hidden="true">
      {(['tona', 'rimu'] as const).map((who) => (
        <span key={who} className={`mjump ${who}`}>
          <img src={`/brand/${who}.webp`} alt="" draggable={false} />
          <i className="mshadow" />
        </span>
      ))}
    </div>
  );
}
