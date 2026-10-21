import { useState } from 'react';
import { set, unreadOf, useStore } from '../store.ts';
import { VISIBILITY_INFO, channelKey, type Group } from '../../../shared/protocol.ts';
import { createChannel, deleteGroup, invite, joinGroup, leaveGroup } from '../actions.ts';
import { Face } from '../world/common.tsx';
import { Icon } from '../world/Icon.tsx';
import { SessionCard } from './SessionCard.tsx';
import { CreateSessionDialog, InviteToGroupDialog } from './dialogs.tsx';
import { Composer, Thread } from './messages.tsx';
import { StatusDot, StatusText, useStatusOf } from './status.tsx';
import { Chip, Empty, EventAnswer, EventHost, NameFace, timeLabel, uniqueByName } from './common.tsx';

function MemberRow({ name, where, guest, groupId }: { name: string; where?: string; guest?: boolean; groupId?: string }) {
  const st = useStatusOf(name);
  const u = useStore((s) => s.users.find((x) => x.name === name));
  return (
    <div className={`mrow ${st.online ? '' : 'off'}`}>
      <span className="fface">{u ? <Face id={u.id} name={name} size={32} /> : <NameFace name={name} size={32} />}<StatusDot st={st} /></span>
      <span className="finfo">
        <b>{name}{guest && <span className="pill">ゲスト</span>}</b>
        {where ? <span className="sub">{guest ? 'メンバーのフレンド · ' : ''}{where}</span> : <StatusText st={st} />}
      </span>
      {guest && u && groupId && <button className="small" onClick={() => invite('group', groupId, u.id)}>メンバーに誘う</button>}
    </div>
  );
}

function Members({ g }: { g: Group }) {
  const users = useStore((s) => s.users);
  const sessions = useStore((s) => s.guild.sessions).filter((d) => d.group === g.id);
  const online = uniqueByName(users);
  const inSession = online.filter((u) => sessions.some((d) => d.id === u.session));
  const here = inSession.filter((u) => g.members.includes(u.name));
  const guests = inSession.filter((u) => !g.members.includes(u.name));
  const onlineMembers = online.filter((u) => g.members.includes(u.name) && !here.includes(u));
  const offline = g.members.filter((n) => !online.some((u) => u.name === n));
  const sessionName = (sid: string | null) => sessions.find((d) => d.id === sid)?.name ?? '';
  return (
    <section className="gcard" aria-labelledby="g-members">
      <h2 id="g-members">メンバー <span className="sub">{g.members.length} 人{guests.length ? ` ＋ ゲスト ${guests.length}` : ''}</span></h2>
      {here.length > 0 && <span className="hlabel">セッションにいる</span>}
      {here.map((u) => <MemberRow key={u.id} name={u.name} where={sessionName(u.session)} />)}
      {guests.length > 0 && <span className="hlabel">ゲスト（セッションにだけ来ている）</span>}
      {guests.map((u) => <MemberRow key={u.id} name={u.name} where={sessionName(u.session)} guest groupId={g.id} />)}
      {onlineMembers.length > 0 && <span className="hlabel">オンライン</span>}
      {onlineMembers.map((u) => <MemberRow key={u.id} name={u.name} />)}
      {offline.length > 0 && <span className="hlabel">オフライン</span>}
      {offline.map((n) => <MemberRow key={n} name={n} />)}
    </section>
  );
}

function GroupEvents({ g }: { g: Group }) {
  const events = useStore((s) => s.events).filter((e) => e.group === g.id && e.at > Date.now() - 3_600_000);
  const sessions = useStore((s) => s.guild.sessions);
  return (
    <section className="gcard" aria-labelledby="g-events">
      <h2 id="g-events">イベント</h2>
      {events.length === 0 && <span className="sub wrap">予定はありません。チャンネルで日程の相談をすると、3 人そろったときにここに入ります</span>}
      {events.slice(0, 4).map((ev, i) => (
        <div key={ev.id} className={`gev ${i === 0 ? 'next' : ''}`}>
          <span className="evtime">{timeLabel(ev.at)}</span>
          <b>{ev.title}</b>
          <EventHost ev={ev} />
          <span className="sub">{sessions.find((d) => d.id === ev.session)?.name ? `会場：${sessions.find((d) => d.id === ev.session)!.name} · ` : ''}来る {ev.attendees.length} · たぶん {ev.maybe.length}</span>
          <EventAnswer ev={ev} />
        </div>
      ))}
    </section>
  );
}

function Channels({ g }: { g: Group }) {
  const selfName = useStore((s) => s.selfName);
  const active = useStore((s) => s.homeChannel[g.id]) ?? g.channels[0].id;
  const inbox = useStore((s) => s.inbox);
  const reads = useStore((s) => s.reads);
  const unread = Object.fromEntries(g.channels.map((c) => [c.id, unreadOf({ inbox, reads, selfName }, channelKey(g.id, c.id))]));
  const [adding, setAdding] = useState<string | null>(null);
  const ch = g.channels.find((c) => c.id === active) ?? g.channels[0];
  const conv = channelKey(g.id, ch.id);
  const pick = (id: string) => set((s) => ({ homeChannel: { ...s.homeChannel, [g.id]: id } }));
  const add = () => { if (adding?.trim()) createChannel(g.id, adding); setAdding(null); };
  return (
    <section className="gchat" aria-labelledby="g-chat">
      <div className="gtabs">
        <h2 id="g-chat">チャンネル</h2>
        <div role="tablist" aria-label="チャンネル" className="row wrap">
          {g.channels.map((c) => (
            <button key={c.id} role="tab" aria-selected={c.id === ch.id} className={`ib gtab ${c.id === ch.id ? 'on' : ''} ${unread[c.id] ? 'unread' : ''}`} onClick={() => pick(c.id)}>
              # {c.name}{unread[c.id] > 0 && c.id !== ch.id && <span className="badge">{unread[c.id]}</span>}
            </button>
          ))}
          {g.owner === selfName && g.channels.length < 8 && (adding === null
            ? <button className="ib gtab" aria-label="チャンネルを作る" title="チャンネルを作る" onClick={() => setAdding('')}><Icon name="plus" size={14} /></button>
            : <input className="gnewch" autoFocus value={adding} maxLength={20} placeholder="チャンネル名" onChange={(e) => setAdding(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); if (e.key === 'Escape') setAdding(null); }} />)}
        </div>
      </div>
      <Thread key={conv} conv={conv} empty={`# ${ch.name} にはまだ何もありません。セッションが終わると、ここにまとめが残ります`} />
      <Composer conv={conv} placeholder={`# ${ch.name} に送信`} allowPlan />
    </section>
  );
}

/** ホームの見出しの行に、グループ名と操作を出す（検索とベルはホームのものを使う） */
export function GroupTitle() {
  const g = useStore((s) => s.groups.find((x) => x.id === s.homeGroup));
  const n = useStore((s) => s.guild.sessions.filter((d) => d.group === s.homeGroup).length);
  if (!g) return null;
  return (
    <span className="gtitle">
      <span className="gmark big" style={{ background: g.color }}>{g.name.slice(0, 1)}</span>
      <span className="finfo">
        <h1>{g.name}</h1>
        <span className="sub">{g.members.length} 人 · セッション {n} 件 · {g.owner} が作成</span>
      </span>
    </span>
  );
}

export function GroupActions() {
  const g = useStore((s) => s.groups.find((x) => x.id === s.homeGroup));
  const selfName = useStore((s) => s.selfName);
  const [create, setCreate] = useState(false);
  const [inv, setInv] = useState(false);
  if (!g) return null;
  const member = g.members.includes(selfName);
  return (
    <>
      {member && <button className="hbtn" onClick={() => setInv(true)}>フレンドを誘う</button>}
      {member ? <button className="hbtn" onClick={() => leaveGroup(g.id)}>抜ける</button> : <button className="dark hbtn" onClick={() => joinGroup(g.id)}>入る</button>}
      {g.owner === selfName && <button className="ib hbtn" title="このグループを消す" aria-label="このグループを消す" onClick={() => { deleteGroup(g.id); set({ homePage: 'groups' }); }}><Icon name="trash" size={16} /></button>}
      {member && <button className="dark hcreate" onClick={() => setCreate(true)}><Icon name="plus" size={16} />セッションを作る</button>}
      {create && <CreateSessionDialog group={g.id} onClose={() => setCreate(false)} />}
      {inv && <InviteToGroupDialog group={g} onClose={() => setInv(false)} />}
    </>
  );
}

export function GroupPage() {
  const g = useStore((s) => s.groups.find((x) => x.id === s.homeGroup));
  const selfName = useStore((s) => s.selfName);
  const sessions = useStore((s) => s.guild.sessions).filter((d) => d.group === g?.id);
  if (!g) return <Empty>このグループはもうありません</Empty>;
  const member = g.members.includes(selfName);
  return (
    <>
      <section className="hsec">
        <h2>セッション <span className="sub">入れる範囲はセッションごとに選ぶ</span></h2>
        <div className="glegend">
          <span><Chip kind="group"><Icon name="flag" size={11} />{g.name}</Chip>{VISIBILITY_INFO.group.desc}</span>
          <span><Chip kind="groupPlus"><Icon name="flag" size={11} />{g.name}＋</Chip>{VISIBILITY_INFO.groupPlus.desc}</span>
        </div>
        {sessions.length === 0 && <Empty>このグループのセッションはまだありません</Empty>}
        <div className="scards">{sessions.map((d) => <SessionCard key={d.id} s={d} showDelete />)}</div>
      </section>

      <div className="grow2">
        {member ? <Channels g={g} /> : <section className="gchat"><Empty>メンバーになると、チャンネルが読めて書けるようになります</Empty></section>}
        <div className="gside">
          <GroupEvents g={g} />
          <Members g={g} />
        </div>
      </div>
    </>
  );
}
