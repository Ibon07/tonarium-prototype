import { useState } from 'react';
import { ITEM_INFO, type ItemKind } from '../../../shared/items.ts';
import { spawnItem } from './actions.ts';

/** アイテムを出すメニュー（2D の操作バーと 3D のオーバーレイで共用） */
export function ItemMenu({ className = '', up = false }: { className?: string; up?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`itemmenu ${className}`}>
      <button className="round" title="アイテムを出す" onClick={() => setOpen(!open)}>🧩</button>
      {open && (
        <div className={`itemlist ${up ? 'up' : ''}`}>
          <div className="cat">アイテムを出す</div>
          {(Object.keys(ITEM_INFO) as ItemKind[]).map((k) => (
            <div key={k} className="itemrow" onClick={() => { spawnItem(k); setOpen(false); }}>
              <span className="itemicon">{ITEM_INFO[k].icon}</span>
              <div>
                <div className="itemname">{ITEM_INFO[k].name}</div>
                <div className="sub">{ITEM_INFO[k].desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
