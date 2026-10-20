import { useState } from 'react';
import { set, unreadOf, useStore, type HomePage } from '../store.ts';
import { dmKey, type EventDef, type Group } from '../../../shared/protocol.ts';
import { ITEM_INFO, type ItemKind } from '../../../shared/items.ts';
import { WORLDS, WORLD_KINDS, type WorldKind } from '../../../shared/worlds.ts';
import { askJoin, deleteEvent, deleteGroup, joinGroup, joinSession, leaveGroup, openDm, openGroup, watchFriend } from '../actions.ts';
import { Face } from '../world/common.tsx';
import { Icon } from '../world/Icon.tsx';
import { SessionCard } from './SessionCard.tsx';
import { CreateEventDialog, CreateGroupDialog, CreateSessionDialog, InviteFriendDialog, InviteToGroupDialog } from './dialogs.tsx';
import { Chip, Empty, EventAnswer, ModeIcon, NameFace, dateKey, timeLabel, uniqueByName, WEEKDAYS } from './common.tsx';
import { Composer, Thread } from './messages.tsx';
import { StatusDot, StatusText, useStatusOf } from './status.tsx';

const match = (q: string, ...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q.toLowerCase()));

type FriendLike = { id: string; name: string; session?: string | null; mode?: '2d' | '3d'; sharing?: boolean };

/** フレンドのステータスに合わせた「参加する」「行ってもいい？」 */
function JoinButton({ u }: { u: FriendLike }) {
  const st = useStatusOf(u.name);
  const sess = useStore((s) => (u.session ? s.guild.sessions.find((d) => d.id === u.session) : undefined));
  if (!st.online || !sess || st.status === 'busy') return null;
  if (st.status === 'askMe') return <button className="finvite" onClick={() => askJoin(u.id)}>行ってもいい？</button>;
  return <button className="finvite" onClick={() => joinSession(sess.id)}>参加する</button>;
}

export function FriendTile({ u, children }: { u: FriendLike; children?: React.ReactNode }) {
  const [inv, setInv] = useState(false);
  const st = useStatusOf(u.name);
  const sess = useStore((s) => (u.session ? s.guild.sessions.find((d) => d.id === u.session) : undefined));
  const where = u.session ? (sess ? `${sess.name} にいます` : '別のセッションにいます') : '';
  return (
    <div className="ftile">
      <span className="fface"><Face id={u.id} name={u.name} size={36} /><StatusDot st={st} /></span>
      <span className="finfo">
        <b>{u.name}</b>
        {where && <span className="sub">{where}</span>}
        <StatusText st={st} />
      </span>
      {st.online && u.mode && <ModeIcon mode={u.mode} sharing={!!u.sharing} />}
      {children}
      <JoinButton u={u} />
      {st.online && st.status !== 'busy' && <button className="finvite" onClick={() => setInv(true)}>誘う</button>}
      <button className="ib square" aria-label={`${u.name} にメッセージ`} title="メッセージ" onClick={() => openDm(u.name)}><Icon name="chat" size={16} /></button>
      {inv && <InviteFriendDialog to={u} onClose={() => setInv(false)} />}
    </div>
  );
}

function FriendRow({ u, on }: { u: FriendLike; on: boolean }) {
  const st = useStatusOf(u.name);
  const unread = useStore((s) => unreadOf(s, dmKey(s.selfName, u.name)));
  const sess = useStore((s) => (u.session ? s.guild.sessions.find((d) => d.id === u.session) : undefined));
  return (
    <button className={`ib frow ${on ? 'on' : ''}`} aria-current={on} onClick={() => set({ dmWith: u.name })}>
      <span className="fface"><Face id={u.id} name={u.name} size={36} /><StatusDot st={st} /></span>
      <span className="finfo">
        <b>{u.name}</b>
        {sess && <span className="sub">{sess.name} にいます</span>}
        <StatusText st={st} />
      </span>
      {unread > 0 && <span className="badge">{unread}</span>}
    </button>
  );
}

function DmPane({ u }: { u: FriendLike }) {
  const selfName = useStore((s) => s.selfName);
  const watching = useStore((s) => s.watching.includes(u.name));
  const st = useStatusOf(u.name);
  const groups = useStore((s) => s.groups).filter((g) => g.members.includes(u.name) && g.members.includes(selfName));
  const conv = dmKey(selfName, u.name);
  return (
    <aside className="dmpane" aria-label={`${u.name} とのやりとり`}>
      <div className="dmhead">
        <span className="fface"><Face id={u.id} name={u.name} size={48} /><StatusDot st={st} /></span>
        <span className="finfo">
          <b className="dmname">{u.name}</b>
          <StatusText st={st} />
          {groups.length > 0 && <span className="sub">同じグループ：{groups.map((g) => g.name).join('、')}</span>}
        </span>
        <span className="spacer" />
        <JoinButton u={u} />
        {!st.online && (
          <button className={watching ? 'on' : ''} aria-pressed={watching} title="オンラインになったら 1 回だけ通知します" onClick={() => watchFriend(u.name, !watching)}>
            <Icon name="bell" size={14} />{watching ? '知らせを待っています' : '来たら知らせる'}
          </button>
        )}
      </div>
      <Thread key={conv} conv={conv} empty={`${u.name} とのメッセージはまだありません。いなくても送っておけます`} />
      <Composer conv={conv} placeholder={`${u.name} にメッセージを送信`} />
    </aside>
  );
}

export function FriendsPage({ q }: { q: string }) {
  const users = useStore((s) => s.users);
  const friends = useStore((s) => s.friends);
  const dmWith = useStore((s) => s.dmWith);
  const online: FriendLike[] = uniqueByName(users.filter((u) => friends.includes(u.name))).map((u) => ({ id: u.id, name: u.name, session: u.session, mode: u.mode, sharing: u.sharing }));
  const offline: FriendLike[] = friends.filter((n) => !online.some((u) => u.name === n)).map((n) => ({ id: n, name: n }));
  const shown = (l: FriendLike[]) => l.filter((u) => match(q, u.name));
  const selected = [...online, ...offline].find((u) => u.name === dmWith) ?? online[0] ?? offline[0];
  if (friends.length === 0) return <Empty>まだフレンドがいません。セッションの中で相手のプロフィールからフレンド申請できます</Empty>;
  return (
    <div className="fpage">
      <section className="flist" aria-label="フレンド一覧">
        {shown(online).length > 0 && <span className="hlabel">オンライン</span>}
        {shown(online).map((u) => <FriendRow key={u.name} u={u} on={u.name === selected?.name} />)}
        {shown(offline).length > 0 && <span className="hlabel">オフライン</span>}
        {shown(offline).map((u) => <FriendRow key={u.name} u={u} on={u.name === selected?.name} />)}
        {shown(online).length + shown(offline).length === 0 && <Empty>見つかりません</Empty>}
      </section>
      {selected && <DmPane key={selected.name} u={selected} />}
    </div>
  );
}

export function SessionsPage({ q }: { q: string }) {
  const sessions = useStore((s) => s.guild.sessions);
  const worldBy = useStore((s) => s.worldBy);
  const [create, setCreate] = useState(false);
  const list = sessions.filter((d) => match(q, d.name, d.topic, WORLDS[worldBy[d.id] ?? d.world ?? 'room'].name));
  return (
    <section className="hsec">
      <h2>セッション <span className="sub">参加できる {sessions.length} 件</span><span className="spacer" /><button className="dark" onClick={() => setCreate(true)}><Icon name="plus" size={14} />セッションを作る</button></h2>
      {list.length === 0 && <Empty>見つかりません</Empty>}
      <div className="scards">{list.map((d) => <SessionCard key={d.id} s={d} showDelete />)}</div>
      {create && <CreateSessionDialog onClose={() => setCreate(false)} />}
    </section>
  );
}

function EventRow({ ev }: { ev: EventDef }) {
  const selfName = useStore((s) => s.selfName);
  const friends = useStore((s) => s.friends);
  const group = useStore((s) => s.groups.find((g) => g.id === ev.group));
  const session = useStore((s) => s.guild.sessions.find((d) => d.id === ev.session));
  const past = ev.at < Date.now() - 3_600_000 * 3;
  return (
    <div className={`evrow ${past ? 'past' : ''}`}>
      <span className="evtime">{timeLabel(ev.at)}</span>
      <span className="evinfo">
        <b>{ev.title}</b>
        <span className="sub">
          {group && <><i className="gdot" style={{ background: group.color }} />{group.name} · </>}
          {session ? `会場：${session.name}` : '会場なし'} · {ev.owner} が作成
        </span>
        <span className="evfaces">
          {ev.attendees.slice(0, 8).map((n) => <NameFace key={n} name={n} size={20} />)}
          <span className="sub">来る {ev.attendees.length} · たぶん {ev.maybe.length}{ev.attendees.some((n) => friends.includes(n)) && `（フレンド ${ev.attendees.filter((n) => friends.includes(n)).length} 人）`}</span>
        </span>
      </span>
      <span className="row">
        {session && !past && <button className="primary" onClick={() => joinSession(session.id)}>会場へ</button>}
        <EventAnswer ev={ev} />
        {ev.owner === selfName && <button className="ib" title="このイベントを消す" onClick={() => deleteEvent(ev.id)}><Icon name="trash" size={14} /></button>}
      </span>
    </div>
  );
}

export function EventsPage({ q }: { q: string }) {
  const events = useStore((s) => s.events);
  const groups = useStore((s) => s.groups);
  const [create, setCreate] = useState(false);
  const list = events.filter((ev) => match(q, ev.title, groups.find((g) => g.id === ev.group)?.name));
  const days = new Map<string, EventDef[]>();
  for (const ev of list) days.set(dateKey(ev.at), [...(days.get(dateKey(ev.at)) ?? []), ev]);
  return (
    <section className="hsec">
      <h2>イベント <span className="sub">{events.length} 件</span><span className="spacer" /><button className="dark" onClick={() => setCreate(true)}><Icon name="plus" size={14} />イベントを作る</button></h2>
      {list.length === 0 && <Empty>{events.length ? '見つかりません' : 'イベントはまだありません'}</Empty>}
      {[...days.values()].map((evs) => {
        const d = new Date(evs[0].at);
        return (
          <div key={dateKey(evs[0].at)} className="evday">
            <h3>{d.getMonth() + 1}月{d.getDate()}日（{WEEKDAYS[d.getDay()]}）</h3>
            {evs.map((ev) => <EventRow key={ev.id} ev={ev} />)}
          </div>
        );
      })}
      {create && <CreateEventDialog onClose={() => setCreate(false)} />}
    </section>
  );
}

function GroupRow({ g }: { g: Group }) {
  const selfName = useStore((s) => s.selfName);
  const sessions = useStore((s) => s.guild.sessions).filter((d) => d.group === g.id);
  const [inv, setInv] = useState(false);
  const member = g.members.includes(selfName);
  return (
    <div className="grow">
      <span className="gmark" style={{ background: g.color }}>{g.name.slice(0, 1)}</span>
      <span className="ginfo">
        <button className="ib glink" onClick={() => openGroup(g.id)}><b>{g.name}</b><Icon name="right" size={13} /></button>
        <span className="sub">{g.members.length} 人 · セッション {sessions.length} 件 · {g.owner} が作成</span>
        <span className="evfaces">{g.members.slice(0, 10).map((n) => <NameFace key={n} name={n} size={20} />)}{g.members.length > 10 && <span className="sub">ほか {g.members.length - 10} 人</span>}</span>
      </span>
      <span className="row">
        {member && <button onClick={() => setInv(true)}>フレンドを誘う</button>}
        {member ? <button onClick={() => leaveGroup(g.id)}>抜ける</button> : <button className="dark" onClick={() => joinGroup(g.id)}>入る</button>}
        {g.owner === selfName && <button className="ib" title="このグループを消す" onClick={() => deleteGroup(g.id)}><Icon name="trash" size={14} /></button>}
      </span>
      {inv && <InviteToGroupDialog group={g} onClose={() => setInv(false)} />}
    </div>
  );
}

export function GroupsPage({ q }: { q: string }) {
  const groups = useStore((s) => s.groups);
  const selfName = useStore((s) => s.selfName);
  const [create, setCreate] = useState(false);
  const mine = groups.filter((g) => g.members.includes(selfName) && match(q, g.name));
  const others = groups.filter((g) => !g.members.includes(selfName) && match(q, g.name));
  return (
    <section className="hsec">
      <h2>グループ <span className="sub">所属 {mine.length} / {groups.length}</span><span className="spacer" /><button className="dark" onClick={() => setCreate(true)}><Icon name="plus" size={14} />グループを作る</button></h2>
      {groups.length === 0 && <Empty>グループはまだありません</Empty>}
      {mine.length > 0 && <h3 className="hsub">所属しているグループ</h3>}
      {mine.map((g) => <GroupRow key={g.id} g={g} />)}
      {others.length > 0 && <h3 className="hsub">ほかのグループ</h3>}
      {others.map((g) => <GroupRow key={g.id} g={g} />)}
      {create && <CreateGroupDialog onClose={() => setCreate(false)} />}
    </section>
  );
}

const WORLD_FACE: Record<WorldKind, string> = { room: '#DCE6F3', cafe: '#F3E6C6', game: '#E7DDF2' };

export function WorldsPage({ q }: { q: string }) {
  const sessions = useStore((s) => s.guild.sessions);
  const worldBy = useStore((s) => s.worldBy);
  const [create, setCreate] = useState<WorldKind | null>(null);
  return (
    <section className="hsec">
      <h2>ワールド <span className="sub">セッションが読み込む 3D 空間</span></h2>
      <div className="wcards">
        {WORLD_KINDS.filter((k) => match(q, WORLDS[k].name, WORLDS[k].desc)).map((k) => {
          const n = sessions.filter((d) => (worldBy[d.id] ?? d.world ?? 'room') === k).length;
          return (
            <article key={k} className="wcard">
              <div className="wface" style={{ background: WORLD_FACE[k] }}><Icon name="globe" size={28} /></div>
              <h3>{WORLDS[k].name}</h3>
              <p className="sub wrap">{WORLDS[k].desc}</p>
              <span className="sub">このワールドのセッション {n} 件</span>
              <button className="dark" onClick={() => setCreate(k)}><Icon name="plus" size={14} />このワールドでセッションを作る</button>
            </article>
          );
        })}
      </div>
      {create && <CreateSessionDialog world={create} onClose={() => setCreate(null)} />}
    </section>
  );
}

export function ItemsPage({ q }: { q: string }) {
  const kinds = (Object.keys(ITEM_INFO) as ItemKind[]).filter((k) => !ITEM_INFO[k].media && match(q, ITEM_INFO[k].name, ITEM_INFO[k].desc, ITEM_INFO[k].genre));
  return (
    <section className="hsec">
      <h2>アイテム <span className="sub">セッションの中で「出す」と使える</span></h2>
      <div className="icards">
        {kinds.map((k) => {
          const info = ITEM_INFO[k];
          return (
            <article key={k} className="icard">
              <span className="itemmark" style={{ width: 44, height: 44, background: info.tint, color: info.ink, fontSize: info.mark.length > 2 ? 13 : 19, borderRadius: 13 }}>{info.mark}</span>
              <span className="iinfo">
                <b>{info.name} <Chip kind="genre">{info.genre}</Chip>{info.in2d && <Chip kind="mode">2D</Chip>}{info.in3d && <Chip kind="mode">3D</Chip>}</b>
                <span className="sub wrap">{info.desc}</span>
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export const goHome = (homePage: HomePage) => set({ homePage });
