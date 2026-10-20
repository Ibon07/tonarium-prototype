import type { User } from '../../../shared/protocol.ts';
import type { WorldKind } from '../../../shared/worlds.ts';
import { WORLDS } from '../../../shared/worlds.ts';
import { useStore, get, set, colorOf } from '../store.ts';
import { joinSession, switchMode } from '../actions.ts';
import { Icon, type IconName } from '../world/Icon.tsx';
import { Face } from '../world/common.tsx';
import type { HubSession } from './data.ts';

/** オンラインの人はアイコン、いない人（オフラインのフレンドなど）は名前の頭文字 */
export function Person({ name, user, size = 22, ring }: { name: string; user?: User | null; size?: number; ring?: string }) {
  if (user) return <Face id={user.id} name={user.name} size={size} ring={ring} />;
  return <span className="face" style={{ width: size, height: size, background: colorOf(name), fontSize: size * 0.44, boxShadow: ring }}>{name.slice(0, 1)}</span>;
}

export function ModeMark({ mode }: { mode: '2d' | '3d' }) {
  return <span className="hmode" title={mode === '2d' ? '2D で参加中' : '3D で参加中'} aria-label={mode.toUpperCase()}><Icon name={mode === '2d' ? 'flat' : 'cube'} size={12} /></span>;
}

/** アクセス種別はまだ無い。いまのセッションは誰でも入れるのでパブリックと出しておく */
export const AccessChip = ({ label = 'パブリック' }: { label?: string }) => (
  <span className="haccess" title={`アクセス：${label}`}><Icon name="globe" size={12} />{label}</span>
);

const WORLD_TINT: Record<WorldKind, string> = { room: '#5E6475', cafe: '#8A5A3B', game: '#4A57B5' };
export function WorldThumb({ kind, h = 64, label = true }: { kind?: WorldKind; h?: number; label?: boolean }) {
  return (
    <div className="hthumb" style={{ height: h, background: kind ? WORLD_TINT[kind] : '#B9B2A5' }}>
      <Icon name="globe" size={18} />{label && <span>{kind ? WORLDS[kind].name : 'ワールド'}</span>}
    </div>
  );
}

/** 同じセッションなら「参加中」、別のセッションにいるなら「移動する」、外からは「参加する」 */
export function JoinButton({ s, small }: { s: HubSession; small?: boolean }) {
  const inSession = useStore((st) => !!st.session);
  if (s.here) return <span className="hhere"><i />参加中</span>;
  const go = () => {
    set({ hubOpen: false, hubDetail: null });
    joinSession(s.id);
    // 外で 3D を選んでいたら、入った後に 3D へ
    if (get().joinMode === '3d') setTimeout(() => switchMode('3d'), 400);
  };
  return <button className={`hprimary ${small ? 'small' : ''}`} onClick={(e) => { e.stopPropagation(); go(); }}>{inSession ? '移動する' : '参加する'}</button>;
}

export function Section({ title, sub, onMore, children }: { title: string; sub?: string; onMore?: () => void; children: React.ReactNode }) {
  return (
    <section className="hsection" aria-label={title}>
      <div className="hsechead">
        <h2>{title}</h2>
        {sub && <span className="sub">{sub}</span>}
        <span className="spacer" />
        {onMore && <button className="ib hmore" onClick={onMore}>もっと見る<Icon name="right" size={14} /></button>}
      </div>
      <div className="hrow">{children}</div>
    </section>
  );
}

export function FriendStack({ users, max = 5 }: { users: User[]; max?: number }) {
  return <span className="hstack">{users.slice(0, max).map((u) => <Person key={u.id} name={u.name} user={u} ring="0 0 0 2px #fff" />)}</span>;
}

/** 「フレンドの今」の大きいカード：上にサムネイルと参加ボタン、下にフレンドの一覧 */
export function NowCard({ s, onOpen }: { s: HubSession; onOpen: () => void }) {
  return (
    <article className="hcard now">
      <button className="hcover" onClick={onOpen} aria-label={`${s.name} の詳細を見る`} />
      <div className="hcardtop">
        <WorldThumb kind={s.world} />
        <span className="hbadges"><span>{s.users.length} 人</span>{s.sharing && <span className="live"><Icon name="screen" size={11} />画面共有</span>}</span>
        <span className="hjoin"><JoinButton s={s} /></span>
      </div>
      <div className="hcardbody">
        <div className="hcardtitle"><span><h3>{s.name}</h3><span className="sub">ワールド：{WORLDS[s.world].name}</span></span><AccessChip /></div>
        <div className="hfriends">
          <span className="hfcount">フレンド {s.friends.length} 人</span>
          <div className="hfgrid">
            {s.friends.slice(0, 5).map((u) => (
              <div key={u.id}><Person name={u.name} user={u} /><span>{u.name}</span>{u.sharing && <Icon name="screen" size={12} />}<ModeMark mode={u.mode} /></div>
            ))}
            {s.friends.length > 5 && <span className="sub">ほか {s.friends.length - 5} 人</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

/** 小さいセッションカード（参加可能なセッションなど） */
export function SessionTile({ s, onOpen }: { s: HubSession; onOpen: () => void }) {
  return (
    <article className="hcard tile">
      <button className="hcover" onClick={onOpen} aria-label={`${s.name} の詳細を見る`} />
      <div className="hcardtop"><WorldThumb kind={s.world} h={84} /><span className="hbadges right"><AccessChip /></span></div>
      <div className="hcardbody"><h3>{s.name}</h3><span className="sub">{WORLDS[s.world].name} · {s.users.length} 人</span></div>
    </article>
  );
}

export function PageHeader({ title, sub, search, action, children }: {
  title: string; sub?: string; search?: string; action?: { label: string; icon?: IconName; onClick: () => void }; children?: React.ReactNode;
}) {
  return (
    <header className="hheader">
      <div className="htitle"><h1>{title}</h1>{sub && <span className="sub">{sub}</span>}</div>
      <span className="spacer" />
      {children}
      {search && <label className="hsearch"><Icon name="search" size={16} /><input placeholder={search} aria-label="検索" /></label>}
      {action && <button className="hprimary big" onClick={action.onClick}>{action.icon && <Icon name={action.icon} size={16} />}{action.label}</button>}
    </header>
  );
}

/** 見た目だけのフィルターやタブ。押すと選択だけ切り替わる */
export function Chips({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="hchips">
      {items.map((x) => <button key={x} className={x === value ? 'on' : ''} aria-pressed={x === value} onClick={() => onChange(x)}>{x}</button>)}
    </div>
  );
}

export function Tabs<T extends string>({ items, value, onChange }: { items: { id: T; label: string; badge?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="htabs" role="tablist">
      {items.map((x) => (
        <button key={x.id} role="tab" aria-selected={x.id === value} onClick={() => onChange(x.id)}>
          {x.label}{!!x.badge && <span className="hbadge">{x.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export const Empty = ({ children }: { children: React.ReactNode }) => <div className="hempty">{children}</div>;
