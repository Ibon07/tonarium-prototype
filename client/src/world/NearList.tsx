import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Participant } from '../../../shared/protocol.ts';
import { ITEM_INFO, ONLY_3D, type Item, type ItemKind } from '../../../shared/items.ts';
import { useStore, get, set, save, nameOf, heldHammer } from '../store.ts';
import { follow, goNear, poke } from '../actions.ts';
import { dropHammer, hitAndMove, itemAction, removeItem, spawnItem } from '../items/actions.ts';
import { formatDistance, useTrend } from '../spatial.ts';
import { Icon } from './Icon.tsx';
import {
  BANDS, Badge3D, Face, ItemMark, Popover, glowStyle, itemLabel, useItemsNear, usePlayers, windowKeyOf,
  type Band, type PlayerEntry,
} from './common.tsx';
import { openWindow, toggleFromList, useIsOpen } from './windows.ts';

type Menu = { kind: 'user'; id: string; rect: DOMRect } | { kind: 'item'; id: string; rect: DOMRect };

/** 行クリック：ハンマーを持っていれば叩く、それ以外はプロフィール */
export function pickUser(id: string) {
  const s = get();
  if (s.mode === '2d' && heldHammer(s) && id !== s.selfId) hitAndMove(id);
  else set({ profileOf: id });
}

function LiveButton({ u, small = false }: { u: Participant; small?: boolean }) {
  const open = useIsOpen('share');
  const sharer = useStore((s) => s.sharer);
  if (!u.sharing || sharer !== u.id) return null;
  return (
    <button
      className={`livebtn ${small ? 'small' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFromList('share'); }}
      title={open ? 'ライブを閲覧中（クリックで閉じる）' : 'クリックでライブを見る'}
    >
      <span className="lb"><Icon name="screen" size={11} stroke={2.4} />ライブ</span>
      {open && <span className="lbon"><Icon name="eye" size={12} stroke={2.4} /></span>}
    </button>
  );
}

function Equip({ id }: { id: string }) {
  const held = useStore((s) => Object.values(s.items).find((i) => (i.kind === 'hammer' || i.kind === 'camera') && i.holder === id));
  if (!held) return null;
  const info = ITEM_INFO[held.kind];
  return (
    <span className="equip" title={`装備中：${info.name}`} style={{ background: info.tint, color: info.ink }}>
      <span className="em">{info.mark}</span>装備
    </span>
  );
}

function statusOf(u: Participant, friends: string[]) {
  const parts: string[] = [];
  if (friends.includes(u.name)) parts.push('フレンド');
  if (!u.micOn) parts.push('ミュート');
  if (u.follow) parts.push(`${nameOf(u.follow)} についていく`);
  return parts.join(' · ');
}

function PlayerRow({ e, onMenu, menuOpen }: { e: PlayerEntry; onMenu: (r: DOMRect) => void; menuOpen: boolean }) {
  const speaking = useStore((s) => !!s.speaking[e.user.id]);
  const friends = useStore((s) => s.friends);
  const hammer = useStore((s) => s.mode === '2d' && !!heldHammer(s));
  const trend = useTrend(e.user.id);
  const u = e.user;
  const status = statusOf(u, friends);
  const ring = speaking ? '0 0 0 2px #fff, 0 0 0 4px var(--speak)' : undefined;
  const menuBtn = (
    <button
      className={`ib more ${menuOpen ? 'on' : ''}`} aria-label={`${u.name} のアクション`} aria-haspopup="menu" aria-expanded={menuOpen}
      data-popanchor onClick={(ev) => onMenu(ev.currentTarget.getBoundingClientRect())}
    ><Icon name="more" /></button>
  );
  if (e.band === 'far') {
    return (
      <button className="farchip ib" data-uid={u.id} title={formatDistance(e.d)} onClick={() => pickUser(u.id)} style={glowStyle(trend)}>
        <Face id={u.id} name={u.name} size={20} />{u.name}{u.mode === '3d' && <Badge3D />}
      </button>
    );
  }
  const big = e.band === 'near';
  return (
    <div className={`prow ${big ? 'big' : ''} ${e.child ? 'child' : ''} ${menuOpen ? 'menuon' : ''} ${hammer ? 'hittable' : ''}`} data-uid={u.id} style={glowStyle(trend)}>
      {e.child && <span className="branch" aria-hidden="true" />}
      <button className="pmain" onClick={() => pickUser(u.id)} aria-label={hammer ? `${u.name} を叩く` : `${u.name} のプロフィール`}>
        <Face id={u.id} name={u.name} size={big ? 32 : 22} ring={ring} />
        <span className="ptext">
          <span className="pname">{u.name}{u.mode === '3d' && <Badge3D />}{!big && status && <span className="pstat">{status}</span>}</span>
          {big && status && <span className="pstat">{status}</span>}
        </span>
        <Equip id={u.id} />
      </button>
      <LiveButton u={u} small={!big} />
      <span className="dist">{formatDistance(e.d)}</span>
      {menuBtn}
    </div>
  );
}

function ItemRow({ item, d, band, heldBy, onMenu, menuOpen }: {
  item: Item; d: number; band: Band; heldBy: string | null; onMenu: (r: DOMRect) => void; menuOpen: boolean;
}) {
  const camFeeds = useStore((s) => s.camFeeds);
  const selfId = useStore((s) => s.selfId);
  useStore((s) => s.participants);
  const key = windowKeyOf(item, camFeeds);
  const attn = useStore((s) => (s.attention[item.id] ?? 0) > performance.now());
  const open = useIsOpen(key ?? '');
  const label = itemLabel(item);
  if (band === 'far') {
    return (
      <button className="farchip ib" title={formatDistance(d)} onClick={() => key && openWindow(key)}>
        <ItemMark item={item} size={20} />{label}
      </button>
    );
  }
  const big = band === 'near';
  const status = heldBy ? (heldBy === selfId ? 'あなたが持っています' : `${nameOf(heldBy)} が持っています`) : '';
  return (
    <div className={`prow item ${big ? 'big' : ''} ${open ? 'winon' : ''} ${menuOpen ? 'menuon' : ''} ${attn ? 'attn' : ''}`}>
      <button className="pmain" data-popanchor onClick={(ev) => (key ? openWindow(key) : onMenu(ev.currentTarget.getBoundingClientRect()))}>
        <ItemMark item={item} size={big ? 32 : 22} />
        <span className="ptext">
          <span className="pname">{label}{!big && status && <span className="pstat">{status}</span>}</span>
          {big && status && <span className="pstat">{status}</span>}
        </span>
      </button>
      {item.kind === 'camera' && item.live && (
        <span className="livechip" title={`${nameOf(item.operator)} がライブ配信中`}><i />LIVE</span>
      )}
      {key && (open
        ? <button className="showing" onClick={() => toggleFromList(key)} title="クリックでウィンドウを閉じる"><Icon name="window" size={11} stroke={2.4} />表示中</button>
        : <button className="openbtn" onClick={() => openWindow(key)}>開く</button>)}
      <span className="dist">{heldBy === selfId ? '手元' : formatDistance(d)}</span>
      <button
        className={`ib more ${menuOpen ? 'on' : ''}`} aria-label={`${label} のアクション`} aria-haspopup="menu" data-popanchor
        onClick={(ev) => onMenu(ev.currentTarget.getBoundingClientRect())}
      ><Icon name="more" /></button>
    </div>
  );
}

function BandHead({ band }: { band: Band }) {
  const b = BANDS.find((x) => x.band === band)!;
  return <h3 className="bandhead"><span className="dot" style={{ background: b.dot }} />{b.label}<span className="range">{b.range}</span></h3>;
}

function Bands<T extends { band: Band }>({ list, render }: { list: T[]; render: (x: T) => React.ReactNode }) {
  return (
    <>
      {BANDS.map(({ band }) => {
        const rows = list.filter((x) => x.band === band);
        if (!rows.length) return null;
        return (
          <section key={band} className="band">
            <BandHead band={band} />
            {band === 'far' ? <div className="farchips">{rows.map(render)}</div> : rows.map(render)}
          </section>
        );
      })}
    </>
  );
}

function MenuItem({ icon, label, onClick, disabled }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void; disabled?: boolean }) {
  return <button role="menuitem" className="ib menuitem" disabled={disabled} onClick={onClick}><Icon name={icon} />{label}</button>;
}

function ActionMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const s = useStore(useShallow((st) => ({
    participants: st.participants, selfId: st.selfId, items: st.items, camFeeds: st.camFeeds,
  })));
  const me = s.participants.find((p) => p.id === s.selfId);
  const run = (f: () => void) => () => { f(); onClose(); };
  if (menu.kind === 'user') {
    const u = s.participants.find((p) => p.id === menu.id);
    if (!u) return null;
    const canFollow = me?.mode === '2d' && u.mode === '3d';
    const following = me?.follow === u.id;
    return (
      <Popover anchor={menu.rect} onClose={onClose} className="menu">
        <span className="menutitle">{u.name}</span>
        <MenuItem icon="near" label="そばにいく" onClick={run(() => goNear(u.id))} />
        {canFollow && <MenuItem icon="follow" label={following ? 'ついていくのをやめる' : 'ついていく'} onClick={run(() => follow(following ? null : u.id))} />}
        <MenuItem icon="poke" label="つんつん" onClick={run(() => poke(u.id))} />
        <MenuItem icon="user" label="プロフィール" onClick={run(() => pickProfile(u.id))} />
      </Popover>
    );
  }
  const it = s.items[menu.id];
  if (!it) return null;
  const key = windowKeyOf(it, s.camFeeds);
  const holder = 'holder' in it ? it.holder : null;
  const iHold = !!heldHammer(s);
  return (
    <Popover anchor={menu.rect} onClose={onClose} className="menu">
      <span className="menutitle">{itemLabel(it)}</span>
      <MenuItem icon="near" label="そばにいく" onClick={run(() => goNear(`item:${it.id}`))} />
      {it.kind === 'hammer' && !holder && <MenuItem icon="hand" label="手に持つ" disabled={iHold} onClick={run(() => itemAction(it.id, { a: 'pick' }))} />}
      {it.kind === 'hammer' && holder === s.selfId && <MenuItem icon="hand" label="手放す" onClick={run(dropHammer)} />}
      {key && <MenuItem icon="window" label={it.kind === 'camera' ? 'ライブを見る' : 'ウィンドウを開く'} onClick={run(() => openWindow(key))} />}
      {!holder && <MenuItem icon="trash" label="しまう" onClick={run(() => removeItem(it.id))} />}
    </Popover>
  );
}

export const pickProfile = (id: string) => set({ profileOf: id });

function ItemPicker({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const mode = useStore((s) => s.mode);
  const kinds = (Object.keys(ITEM_INFO) as ItemKind[]).filter((k) => !ITEM_INFO[k].media);
  const [sel, setSel] = useState<ItemKind>('chess');
  const info = ITEM_INFO[sel];
  const disabledOf = (k: ItemKind) => !!ONLY_3D[k] && mode !== '3d';
  return (
    <Popover anchor={anchor} onClose={onClose} className="picker">
      <div className="pickgrid">
        <div className="pickhead"><b>所持アイテム</b><span>{kinds.length}</span></div>
        <div className="grid3">
          {kinds.map((k) => {
            const i = ITEM_INFO[k];
            const disabled = disabledOf(k);
            return (
              <button
                key={k} className={`owned ${sel === k ? 'sel' : ''} ${disabled ? 'dis' : ''}`} aria-pressed={sel === k}
                title={disabled ? '3D モードでのみ出せます' : undefined} onClick={() => setSel(k)}
              >
                <span className="itemmark" style={{ width: 34, height: 34, background: i.tint, color: i.ink, fontSize: i.mark.length > 2 ? 10 : 15, borderRadius: 10 }}>{i.mark}</span>
                <span className="oname">{i.name}</span>
                {!i.in2d && <span className="only3d">3Dのみ</span>}
              </button>
            );
          })}
        </div>
      </div>
      <section className="pickdetail" aria-label={`${info.name} の詳細`}>
        <div className="thumb" style={{ background: info.tint, color: info.ink }}><span>{info.mark}</span></div>
        <h3>{info.name}</h3>
        <span className="sub">制作：Tonarium</span>
        <p>{info.desc}</p>
        <div className="tags">
          {info.in2d && <span>2D 対応</span>}
          {info.in3d && <span>3D 対応</span>}
          <span className="genre" style={{ background: info.tint, color: info.ink }}>{info.genre}</span>
        </div>
        <span className="spacer" />
        <button
          className="primary big" disabled={disabledOf(sel)}
          onClick={() => { spawnItem(sel); onClose(); }}
        ><Icon name="plus" size={14} stroke={2.4} />{disabledOf(sel) ? '3D モードで出せます' : '目の前に出す'}</button>
      </section>
    </Popover>
  );
}

export function NearList() {
  const folded = useStore((s) => s.folded.left);
  const selfId = useStore((s) => s.selfId);
  const selfName = useStore((s) => s.selfName);
  const mode = useStore((s) => s.mode);
  const me = useStore((s) => s.participants.find((p) => p.id === s.selfId));
  const players = usePlayers();
  // 自分についてきている人は、ほかの人と同じく自分の行の子として並べる
  const followers = players.filter((e) => e.user.follow === selfId).map((e) => ({ ...e, band: 'mid' as const, child: true }));
  const others = players.filter((e) => e.user.follow !== selfId);
  const items = useItemsNear();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const playerRow = (e: PlayerEntry) => (
    <PlayerRow
      key={e.user.id} e={e} menuOpen={menu?.kind === 'user' && menu.id === e.user.id}
      onMenu={(rect) => setMenu(menu?.id === e.user.id ? null : { kind: 'user', id: e.user.id, rect })}
    />
  );
  const fold = (left: boolean) => set((s) => { const f = { ...s.folded, left }; save('tonarium.folded', f); return { folded: f }; });

  if (folded) {
    return (
      <button className="foldedpanel left" onClick={() => fold(false)} aria-label="プレイヤーとアイテムを開く">
        <Icon name="right" size={14} stroke={2.4} />
        <span className="fp"><Icon name="people" size={18} /><b>{players.length + 1}</b></span>
        <span className="fpline" />
        <span className="fp"><Icon name="box" size={18} /><b>{items.length}</b></span>
      </button>
    );
  }
  return (
    <aside className="panel nearlist" aria-label="プレイヤーとアイテム">
      <div className="phead">
        <h2>プレイヤー</h2><span className="count">{players.length + 1}</span>
        <button className="ib" onClick={() => fold(true)} aria-label="パネルをたたむ"><Icon name="left" size={15} /></button>
      </div>
      <div className="pscroll">
        <div className="selfrow" data-uid={selfId}>
          <Face id={selfId} name={selfName} size={32} />
          <span className="pname">{selfName}</span>
          {me && <LiveButton u={me} />}
          <span className="pill dark">あなた</span>
          <span className="pill">{mode.toUpperCase()}</span>
        </div>
        {followers.map(playerRow)}
        <Bands list={others} render={playerRow} />
        {!players.length && <div className="empty">まだ誰もいません</div>}
      </div>
      <div className="psplit" aria-hidden="true"><span /></div>
      <div className="phead">
        <h2>アイテム</h2><span className="count">{items.length}</span>
        <button className="dark small" data-popanchor aria-haspopup="dialog" aria-expanded={!!picker}
          onClick={(e) => setPicker(picker ? null : e.currentTarget.getBoundingClientRect())}
        ><Icon name="plus" size={14} stroke={2.4} />出す</button>
      </div>
      <div className="iscroll">
        <Bands
          list={items}
          render={(x) => (
            <ItemRow
              key={x.item.id} {...x} menuOpen={menu?.kind === 'item' && menu.id === x.item.id}
              onMenu={(rect) => setMenu(menu?.id === x.item.id ? null : { kind: 'item', id: x.item.id, rect })}
            />
          )}
        />
        {!items.length && <div className="empty">「出す」からアイテムを置けます</div>}
      </div>
      {menu && <ActionMenu menu={menu} onClose={() => setMenu(null)} />}
      {picker && <ItemPicker anchor={picker} onClose={() => setPicker(null)} />}
    </aside>
  );
}
