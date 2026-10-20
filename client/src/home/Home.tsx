import { useEffect, useRef, useState } from 'react';
import { useStore, type HomePage, type Notice } from '../store.ts';
import { sortByFriends } from '../../../shared/home.ts';
import { friendAccept, markNoticesRead, removeNotice } from '../actions.ts';
import { ProfileDialog } from '../Profile.tsx';
import { Face } from '../world/common.tsx';
import { Icon, type IconName } from '../world/Icon.tsx';
import { acceptInvite, inviteTarget } from '../world/NoticeLog.tsx';
import { SessionCard } from './SessionCard.tsx';
import { CreateSessionDialog } from './dialogs.tsx';
import { EventsPage, FriendTile, FriendsPage, GroupsPage, ItemsPage, SessionsPage, WorldsPage, goHome } from './pages.tsx';
import { Empty, NameFace, WEEKDAYS, dateKey, timeLabel, useMyGroups, useOnlineFriends } from './common.tsx';

const NAV: { page: HomePage; name: string; icon: IconName }[] = [
  { page: 'home', name: 'ホーム', icon: 'home' },
  { page: 'friends', name: 'フレンド', icon: 'people' },
  { page: 'sessions', name: 'セッション', icon: 'headset' },
  { page: 'events', name: 'イベント', icon: 'calendar' },
  { page: 'groups', name: 'グループ', icon: 'flag' },
  { page: 'worlds', name: 'ワールド', icon: 'globe' },
  { page: 'items', name: 'アイテム', icon: 'box' },
];

const WEEK = 7 * 86_400_000;
const useUpcoming = () => useStore((s) => s.events).filter((e) => e.at > Date.now() - 3_600_000 && e.at < Date.now() + WEEK);

function Sidebar() {
  const page = useStore((s) => s.homePage);
  const selfId = useStore((s) => s.selfId);
  const selfName = useStore((s) => s.selfName);
  const onlineFriends = useOnlineFriends().length;
  const upcoming = useUpcoming().length;
  const myGroups = useMyGroups();
  const [profile, setProfile] = useState(false);
  const badge = { friends: onlineFriends, events: upcoming } as Partial<Record<HomePage, number>>;
  return (
    <nav className="hside">
      <div className="hbrand"><img src="/brand/mark.png" alt="" /><b>トナリウム</b></div>
      <ul className="hnav">
        {NAV.map((n) => (
          <li key={n.page}>
            <button className={`ib hnavbtn ${page === n.page ? 'on' : ''}`} onClick={() => goHome(n.page)}>
              <Icon name={n.icon} size={18} />{n.name}
              {!!badge[n.page] && <span className="hbadge">{badge[n.page]}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="hside-sec">
        <span className="hlabel">所属グループ</span>
        <div className="hgroups">
          {myGroups.length === 0 && <span className="sub">なし</span>}
          {myGroups.map((g) => <button key={g.id} className="gmark" style={{ background: g.color }} title={g.name} onClick={() => goHome('groups')}>{g.name.slice(0, 1)}</button>)}
        </div>
      </div>
      <span className="spacer" />
      <button className="ib hself" onClick={() => setProfile(true)} title="アイコン・3D アバター・自己紹介を設定">
        <span className="fface"><Face id={selfId} name={selfName} size={36} /><i className="fdot on" /></span>
        <span className="finfo"><b>{selfName}</b><span className="sub">オンライン</span></span>
        <Icon name="settings" size={18} />
      </button>
      {profile && <ProfileDialog name={selfName} onClose={() => setProfile(false)} />}
    </nav>
  );
}

function NoticeItem({ n }: { n: Notice }) {
  const target = useStore((s) => inviteTarget(s, n));
  const isGroup = n.key?.startsWith('group:');
  return (
    <div className="hnotice">
      <Face id={n.from} name={n.fromName} size={28} />
      <span className="ntext">
        <span><b>{n.fromName}</b>{n.kind === 'friend' ? ' からフレンド申請' : ` が${target ? `「${target.name}」` : '（もう無いもの）'}に誘っています`}</span>
        <span className="sub">{timeLabel(n.at)}</span>
      </span>
      {n.kind === 'friend'
        ? <button className="primary" onClick={() => friendAccept(n.from, n.id)}>承認</button>
        : <button className="primary" disabled={!target} onClick={() => acceptInvite(n)}>{isGroup ? '入る' : '参加'}</button>}
      <button className="ib" aria-label="消す" onClick={() => removeNotice(n.id)}><Icon name="close" size={14} /></button>
    </div>
  );
}

function Bell() {
  const notices = useStore((s) => s.notices).filter((n) => n.kind === 'friend' || n.kind === 'invite');
  const unread = notices.some((n) => n.unread);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    markNoticesRead();
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="hbell" ref={ref}>
      <button className={`hbellbtn ${open ? 'on' : ''}`} aria-label="通知" onClick={() => setOpen(!open)}><Icon name="bell" size={18} />{unread && <i className="hdot" />}</button>
      {open && (
        <div className="hpop">
          <h3>通知</h3>
          {notices.length === 0 && <Empty>新しい通知はありません</Empty>}
          {notices.map((n) => <NoticeItem key={n.id} n={n} />)}
        </div>
      )}
    </div>
  );
}

function EventsPanel() {
  const events = useStore((s) => s.events);
  const friends = useStore((s) => s.friends);
  const groups = useStore((s) => s.groups);
  const upcoming = useUpcoming().slice(0, 4);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // 月曜はじまりの今週
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const has = new Set(events.map((e) => dateKey(e.at)));
  return (
    <aside className="hevents">
      <button className="ib hevtitle" onClick={() => goHome('events')}><b>イベント</b><Icon name="right" size={14} /></button>
      <div className="hweek">
        {days.map((d) => (
          <span key={d.getDate()} className={`hday ${dateKey(d.getTime()) === dateKey(Date.now()) ? 'today' : ''}`}>
            <small>{WEEKDAYS[d.getDay()]}</small><b>{d.getDate()}</b>{has.has(dateKey(d.getTime())) && <i />}
          </span>
        ))}
      </div>
      {upcoming.length === 0 && <Empty>この 1 週間のイベントはありません</Empty>}
      {upcoming.map((ev) => {
        const g = groups.find((x) => x.id === ev.group);
        const nf = ev.attendees.filter((n) => friends.includes(n)).length;
        return (
          <button key={ev.id} className={`ib hevcard ${dateKey(ev.at) === dateKey(Date.now()) ? 'today' : ''}`} onClick={() => goHome('events')}>
            <span className="row"><span className="evtime">{timeLabel(ev.at)}</span><span className="spacer" />{g && <span className="sub">{g.name}</span>}</span>
            <b>{ev.title}</b>
            <span className="evfaces">
              {ev.attendees.slice(0, 4).map((n) => <NameFace key={n} name={n} size={20} />)}
              <span className="sub">{nf ? `フレンド ${nf} 人` : `${ev.attendees.length} 人`}</span>
            </span>
          </button>
        );
      })}
      <button className="ib hlink" onClick={() => goHome('events')}>カレンダーを開く</button>
    </aside>
  );
}

const match = (q: string, ...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q.toLowerCase()));

function HomePageView({ q }: { q: string }) {
  const sessions = useStore((s) => s.guild.sessions);
  const users = useStore((s) => s.users);
  const friends = useStore((s) => s.friends);
  const onlineFriends = useOnlineFriends();
  const sorted = sortByFriends(sessions.filter((d) => match(q, d.name, d.topic)), friends, users);
  // 参加できるセッションの中にいないフレンド
  const idle = onlineFriends.filter((u) => !sessions.some((d) => d.id === u.session) && match(q, u.name));
  return (
    <>
      <section className="hsec">
        <h2>フレンドの今 <span className="sub">参加できるセッションを、フレンドが多い順に</span></h2>
        {sorted.length === 0 && <Empty>参加できるセッションがありません</Empty>}
        <div className="scards">{sorted.map((d) => <SessionCard key={d.id} s={d} />)}</div>
      </section>
      <section className="hsec">
        <h2>オンラインのフレンド <span className="sub">参加できるセッションにいないフレンド</span><button className="ib hlink" onClick={() => goHome('friends')}>すべて</button></h2>
        {idle.length === 0 && <Empty>{onlineFriends.length ? 'みんなセッションにいます' : 'オンラインのフレンドはいません'}</Empty>}
        <div className="ftiles">{idle.map((u) => <FriendTile key={u.id} u={u} />)}</div>
      </section>
    </>
  );
}

export function Home() {
  const page = useStore((s) => s.homePage);
  const wsConnected = useStore((s) => s.wsConnected);
  const [q, setQ] = useState('');
  const [create, setCreate] = useState(false);
  const title = NAV.find((n) => n.page === page)!.name;
  return (
    <div className="home">
      <Sidebar />
      <main className="hmain">
        <header className="hhead">
          <h1>{title}</h1>
          {!wsConnected && <span className="reconn">接続中…</span>}
          <span className="spacer" />
          <label className="hsearch"><Icon name="search" size={16} /><input value={q} placeholder="フレンド・ワールド・グループを検索" onChange={(e) => setQ(e.target.value)} /></label>
          <Bell />
          <button className="dark hcreate" onClick={() => setCreate(true)}><Icon name="plus" size={16} />セッションを作る</button>
        </header>
        {page === 'home' && <HomePageView q={q} />}
        {page === 'friends' && <FriendsPage q={q} />}
        {page === 'sessions' && <SessionsPage q={q} />}
        {page === 'events' && <EventsPage q={q} />}
        {page === 'groups' && <GroupsPage q={q} />}
        {page === 'worlds' && <WorldsPage q={q} />}
        {page === 'items' && <ItemsPage q={q} />}
      </main>
      {page === 'home' && <EventsPanel />}
      {create && <CreateSessionDialog onClose={() => setCreate(false)} />}
    </div>
  );
}
