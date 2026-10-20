import { useEffect, useState } from 'react';
import { WORLDS } from '../../../shared/worlds.ts';
import { ITEM_INFO } from '../../../shared/items.ts';
import { useStore, get, set, save, sessionOf, type HubPage, type SideWidget } from '../store.ts';
import { leaveSession, switchMode } from '../actions.ts';
import { spawnItem } from '../items/actions.ts';
import { ProfileDialog } from '../Profile.tsx';
import { Icon, type IconName } from '../world/Icon.tsx';
import { Face } from '../world/common.tsx';
import { Toast } from '../world/WorldScreen.tsx';
import {
  DUMMY_GROUPS, DUMMY_UPCOMING, OWNED_ITEMS, WORLD_CARDS, itemTags, openHubPage, soon, useFriendGroups, useHubSessions,
} from './data.ts';
import { AccessChip, JoinButton, ModeMark, Person, WorldThumb } from './parts.tsx';
import { HomePage } from './HomePage.tsx';
import { EventsPage, FriendsPage, GroupsPage, ItemsPage, SessionsPage, WorldsPage } from './pages.tsx';
import './hub.css';

export const HUB_PAGES: { id: HubPage; label: string; icon: IconName }[] = [
  { id: 'home', label: 'ホーム', icon: 'home' },
  { id: 'friends', label: 'フレンド', icon: 'people' },
  { id: 'sessions', label: 'セッション', icon: 'layers' },
  { id: 'events', label: 'イベント', icon: 'calendar' },
  { id: 'groups', label: 'グループ', icon: 'flag' },
  { id: 'worlds', label: 'ワールド', icon: 'globe' },
  { id: 'items', label: 'アイテム', icon: 'box' },
];

/** イベントはまだ無いので件数もダミー */
const DUMMY_EVENT_BADGE = 2;

function NavItems({ current, onPick, lastDot }: { current: HubPage | null; onPick: (p: HubPage) => void; lastDot?: HubPage }) {
  const { onlineCount } = useFriendGroups();
  return (
    <>
      {HUB_PAGES.map((p) => {
        const badge = p.id === 'friends' ? onlineCount : p.id === 'events' ? DUMMY_EVENT_BADGE : 0;
        return (
          <button key={p.id} className={`hnav ${current === p.id ? 'on' : ''}`} aria-current={current === p.id ? 'page' : 'false'} onClick={() => onPick(p.id)}>
            <Icon name={p.icon} size={19} /><span>{p.label}</span>
            {badge > 0 && <span className="hbadge">{badge}</span>}
            {lastDot === p.id && <span className="hlastdot" title="最後に開いたページ" />}
          </button>
        );
      })}
    </>
  );
}

/** セッション中は今の 2D/3D を切り替え、外では次に入るときのモードを選ぶ。VR はまだ無い */
function ClientMode() {
  const session = useStore((s) => s.session);
  const mode = useStore((s) => (s.session ? s.mode : s.joinMode));
  const switching = useStore((s) => !!s.switching);
  const pick = (m: '2d' | '3d') => {
    if (get().session) switchMode(m);
    else { save('tonarium.joinMode', m); set({ joinMode: m }); }
  };
  return (
    <div className="hclient">
      <span className="hlabel">クライアントモード</span>
      <div role="radiogroup" aria-label="クライアントモード" className="hseg">
        {(['2d', '3d'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} aria-label={`${m.toUpperCase()} モード`} className={mode === m ? 'on' : ''} disabled={switching}
            title={session ? undefined : '次にセッションへ入るときのモード'} onClick={() => pick(m)}>
            <Icon name={m === '2d' ? 'flat' : 'cube'} size={14} />{m.toUpperCase()}
          </button>
        ))}
        <button role="radio" aria-checked={false} aria-label="VR モード" onClick={soon}><Icon name="vr" size={14} />VR</button>
      </div>
    </div>
  );
}

function Groups() {
  return (
    <div className="hgroups">
      <span className="hlabel">所属グループ</span>
      <div>{DUMMY_GROUPS.map((g, i) => <button key={i} className="hgroup" style={{ background: g.color }} title={g.name} aria-label="グループ" onClick={soon}>G</button>)}</div>
    </div>
  );
}

/** 左のメニュー。セッション中のホバーメニューと、ハブの左列で同じものを使う */
export function HubMenu({ current, onPick, inSession, lastDot }: { current: HubPage | null; onPick: (p: HubPage) => void; inSession: boolean; lastDot?: HubPage }) {
  const selfId = useStore((s) => s.selfId);
  const selfName = useStore((s) => s.selfName);
  const [profile, setProfile] = useState(false);
  return (
    <>
      <NavItems current={current} onPick={onPick} lastDot={lastDot} />
      <ClientMode />
      <Groups />
      <span className="spacer" />
      {inSession
        ? (
          <>
            <button className="hnav" onClick={() => { set({ hubOpen: false }); leaveSession(); }}><Icon name="leave" size={19} /><span>セッションから離脱</span></button>
            <button className="hself ib" aria-label="プロフィール" onClick={() => setProfile(true)}>
              <Face id={selfId} name={selfName} size={34} /><span className="hselftext"><b>{selfName}</b><span className="sub">プロフィール</span></span>
            </button>
          </>
        )
        : (
          <div className="hself">
            <Face id={selfId} name={selfName} size={34} /><span className="hselftext"><b>{selfName}</b><span className="sub">オンライン</span></span>
            <button className="ib" aria-label="設定" title="アイコン・3D アバター・自己紹介" onClick={() => setProfile(true)}><Icon name="settings" size={18} /></button>
          </div>
        )}
      {profile && <ProfileDialog name={selfName} onClose={() => setProfile(false)} />}
    </>
  );
}

const WIDGETS: { id: SideWidget; label: string }[] = [
  { id: 'now', label: 'フレンドの今' },
  { id: 'event', label: 'イベント' },
  { id: 'sessions', label: '参加可能セッション' },
  { id: 'worlds', label: '新着ワールド' },
  { id: 'items', label: '新着アイテム' },
];

function SessionDetail({ id }: { id: string }) {
  const s = useHubSessions().find((x) => x.id === id);
  if (!s) return null;
  const others = s.users.length - s.friends.length;
  return (
    <div className="hdetail">
      <div className="hdetailhead"><span>セッションの詳細</span><button className="ib" aria-label="詳細を閉じる" onClick={() => set({ hubDetail: null })}><Icon name="close" size={16} /></button></div>
      <div className="hdetailthumb"><WorldThumb kind={s.world} h={120} /><span><AccessChip /></span></div>
      <div className="hdetailtitle"><strong>{s.name}</strong><span className="sub">ワールド：{WORLDS[s.world].name} · {s.users.length} 人</span></div>
      <p>{s.topic || '[セッションの説明]'}</p>
      {s.friends.length
        ? (
          <div className="hdetailfriends">
            <span className="hfcount">フレンド {s.friends.length} 人</span>
            {s.friends.map((u) => <div key={u.id}><Person name={u.name} user={u} /><span>{u.name}</span>{u.sharing && <Icon name="screen" size={12} />}<ModeMark mode={u.mode} /></div>)}
            {others > 0 && <span className="sub">そのほかの参加者 {others} 人</span>}
          </div>
        )
        : <div className="hdetailfriends"><span className="sub">参加者 {s.users.length} 人 · フレンドはいません</span></div>}
      <span className="spacer" />
      <JoinButton s={s} />
    </div>
  );
}

function ItemDetail({ kind }: { kind: keyof typeof ITEM_INFO }) {
  const info = ITEM_INFO[kind];
  const s = useStore();
  const disabled = kind === 'camera' && s.mode !== '3d';
  return (
    <div className="hdetail">
      <div className="hdetailhead"><span>アイテムの詳細</span><button className="ib" aria-label="詳細を閉じる" onClick={() => set({ hubDetail: null })}><Icon name="close" size={16} /></button></div>
      <div className="hitemhero" style={{ background: info.tint, color: info.ink }}>{info.mark}</div>
      <div className="hdetailtitle"><strong>{info.name}</strong><span className="sub">制作：[制作者名]</span></div>
      <p>{info.desc}</p>
      <div className="htags">{itemTags(kind).map((t) => <span key={t}>{t}</span>)}</div>
      <span className="spacer" />
      {s.session
        ? <button className="hprimary" disabled={disabled} title={disabled ? '3D でのみ出せます' : undefined} onClick={() => { spawnItem(kind); set({ hubOpen: false }); }}><Icon name="plus" size={14} />目の前に出す</button>
        : <span className="sub">セッションに入ると出せます</span>}
    </div>
  );
}

function Widget({ id }: { id: SideWidget }) {
  const sessions = useHubSessions();
  const open = (sid: string) => set({ hubDetail: { kind: 'session', id: sid } });
  if (id === 'now' || id === 'sessions') {
    const list = id === 'now' ? sessions.filter((s) => s.friends.length).sort((a, b) => b.friends.length - a.friends.length) : sessions;
    if (!list.length) return <div className="hempty small">{id === 'now' ? 'フレンドがいるセッションはありません' : 'セッションがありません'}</div>;
    return (
      <div className="hwlist">
        {list.map((s) => (
          <button key={s.id} className="hwrow ib" onClick={() => open(s.id)}>
            <span className="hwthumb"><WorldThumb kind={s.world} h={40} label={false} /></span>
            <span className="hwtext"><strong>{s.name}</strong><span className="sub">{s.users.length} 人{id === 'now' ? ` · フレンド ${s.friends.length} 人` : ''}</span></span>
            {s.here && <span className="hhere"><i />参加中</span>}
          </button>
        ))}
      </div>
    );
  }
  if (id === 'event') {
    const days = ['月', '火', '水', '木', '金', '土', '日'];
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return (
      <div className="hwlist">
        <div className="hweek">
          {days.map((d, i) => {
            const day = new Date(monday);
            day.setDate(monday.getDate() + i);
            return <span key={d} className={day.toDateString() === today.toDateString() ? 'today' : ''}><span>{d}</span><b>{day.getDate()}</b></span>;
          })}
        </div>
        {DUMMY_UPCOMING.map((e, i) => (
          <button key={i} className="hwrow ib col" onClick={soon}><span className="sub">{e.when} · {e.group}</span><strong>{e.name}</strong></button>
        ))}
        <button className="ib hmore" onClick={() => openHubPage('events')}>カレンダーを開く</button>
      </div>
    );
  }
  if (id === 'worlds') {
    return (
      <div className="hwlist">
        {WORLD_CARDS.map((w) => (
          <div key={w.kind} className="hwrow">
            <span className="hwthumb"><WorldThumb kind={w.kind} h={40} label={false} /></span>
            <span className="hwtext"><strong>{w.name}</strong><span className="sub">制作：Tonarium</span></span>
            <span className="htags">{w.in2d && <span>2D</span>}{w.in3d && <span>3D</span>}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="hwlist">
      {OWNED_ITEMS.map((k) => (
        <button key={k} className="hwrow ib" onClick={() => set({ hubDetail: { kind: 'item', item: k } })}>
          <span className="hwmark" style={{ background: ITEM_INFO[k].tint, color: ITEM_INFO[k].ink }}>{ITEM_INFO[k].mark}</span>
          <span className="hwtext"><strong>{ITEM_INFO[k].name}</strong><span className="sub">{ITEM_INFO[k].genre}</span></span>
        </button>
      ))}
    </div>
  );
}

/** 右エリア：ウィジェットをタイトルのドロップダウンで選ぶ。中央で選んだものの詳細はここを上書きする */
function SideArea() {
  const widget = useStore((s) => s.sideWidget);
  const detail = useStore((s) => s.hubDetail);
  const [dd, setDd] = useState(false);
  return (
    <aside className="hside" aria-label="サイドエリア">
      {detail?.kind === 'session' ? <SessionDetail id={detail.id} />
        : detail?.kind === 'item' ? <ItemDetail kind={detail.item} />
        : (
          <>
            <div className="hwhead">
              <button className="hwtitle" aria-haspopup="menu" aria-expanded={dd} onClick={() => setDd(!dd)}>
                {WIDGETS.find((w) => w.id === widget)?.label}<Icon name="down" size={16} />
              </button>
              {dd && (
                <div role="menu" aria-label="表示する内容" className="hwmenu">
                  {WIDGETS.map((w) => (
                    <button key={w.id} role="menuitem" className="ib" onClick={() => { save('tonarium.sideWidget', w.id); set({ sideWidget: w.id }); setDd(false); }}>
                      <span>{w.label}</span>{w.id === widget && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Widget id={widget} />
          </>
        )}
    </aside>
  );
}

function PageBody({ page }: { page: HubPage }) {
  switch (page) {
    case 'home': return <HomePage />;
    case 'friends': return <FriendsPage />;
    case 'sessions': return <SessionsPage />;
    case 'events': return <EventsPage />;
    case 'groups': return <GroupsPage />;
    case 'worlds': return <WorldsPage />;
    case 'items': return <ItemsPage />;
  }
}

/** セッションの外の画面。左にメニュー、中央にページ、右にウィジェットか詳細 */
export function Hub() {
  const page = useStore((s) => s.hubPage);
  return (
    <div className="hub">
      <nav className="hmenu" aria-label="メイン">
        <div className="hbrand"><img src="/brand/mark.png" alt="" /><span>トナリウム</span></div>
        <HubMenu current={page} onPick={openHubPage} inSession={false} />
      </nav>
      <main className="hmain"><PageBody page={page} /></main>
      <SideArea />
      <Toast />
    </div>
  );
}

/** セッション中にメニューから開く。背面のセッションを暗くぼかし、上にいまいるセッション、その下にハブと同じシート */
export function HubOverlay() {
  const page = useStore((s) => s.hubPage);
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
      <div role="dialog" aria-label={HUB_PAGES.find((p) => p.id === page)?.label} className="hub sheet">
        <nav className="hmenu" aria-label="メニュー">
          <HubMenu current={page} onPick={openHubPage} inSession />
        </nav>
        <main className="hmain"><PageBody page={page} /></main>
        <SideArea />
      </div>
    </div>
  );
}
