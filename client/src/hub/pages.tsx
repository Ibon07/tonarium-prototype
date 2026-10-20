import { useState } from 'react';
import { ITEM_INFO } from '../../../shared/items.ts';
import { WORLDS } from '../../../shared/worlds.ts';
import { useStore, set, sessionOf, worldKindOf } from '../store.ts';
import { friendAccept, poke, toggleBlock } from '../actions.ts';
import { Icon } from '../world/Icon.tsx';
import {
  DUMMY_EVENTS, DUMMY_GROUP_SESSIONS, DUMMY_UPCOMING, OWNED_ITEMS, WORLD_CARDS, itemTags, openHubPage, soon, useFriendGroups, useHubSessions,
  type FriendState,
} from './data.ts';
import { AccessChip, Chips, Empty, JoinButton, NowCard, PageHeader, Person, Tabs, WorldThumb } from './parts.tsx';
import { EventCard } from './HomePage.tsx';

const openSession = (id: string) => set({ hubDetail: { kind: 'session', id } });

function FriendRow({ f, kind }: { f: FriendState; kind: 'same' | 'other' | 'online' | 'offline' }) {
  const status = kind === 'offline' ? 'オフライン'
    : f.session ? `${f.session.name}${f.user?.sharing ? ' · ライブ中' : ''}${kind === 'other' ? ` · ${f.session.users.length} 人` : ''}`
    : f.user?.mode === '3d' ? '3D で参加中' : 'オンライン';
  return (
    <div className={`hfriend ${kind === 'offline' ? 'off' : ''}`}>
      <span className="hdot"><Person name={f.name} user={f.user} size={36} />{kind !== 'offline' && <i />}</span>
      <span className="hftext"><b>{f.name}</b><span className="sub">{status}</span></span>
      {kind === 'same' && <><span className="hsame">同じセッション</span><button className="hsecondary small" onClick={() => f.user && poke(f.user.id)}>つんつん</button></>}
      {kind === 'other' && f.session && <JoinButton s={f.session} small />}
      {kind === 'online' && <button className="hsecondary small" onClick={soon}>誘う</button>}
    </div>
  );
}

function FriendSection({ title, list, kind }: { title: string; list: FriendState[]; kind: 'same' | 'other' | 'online' | 'offline' }) {
  if (!list.length) return null;
  return (
    <section className="hfsection">
      <span className="hlabel">{title}<span> · {list.length}</span></span>
      {list.map((f) => <FriendRow key={f.name} f={f} kind={kind} />)}
    </section>
  );
}

export function FriendsPage() {
  const g = useFriendGroups();
  const sessions = useHubSessions();
  const notices = useStore((s) => s.notices);
  const requests = notices.filter((n) => n.kind === 'friend');
  const blocked = useStore((s) => s.blocked);
  const inSession = useStore((s) => !!s.session);
  const [tab, setTab] = useState<'all' | 'now' | 'req' | 'block'>('all');
  const withFriends = sessions.filter((s) => s.friends.length).sort((a, b) => b.friends.length - a.friends.length);
  return (
    <>
      <PageHeader title="フレンド" sub={`オンライン ${g.onlineCount} 人`} search="フレンドを検索" action={{ label: 'フレンドを追加', icon: 'plus', onClick: soon }} />
      <div className="hpad">
        <Tabs value={tab} onChange={setTab} items={[
          { id: 'all', label: 'すべて' }, { id: 'now', label: 'フレンドの今' }, { id: 'req', label: 'リクエスト', badge: requests.length }, { id: 'block', label: 'ブロック中' },
        ]} />
      </div>
      <div className="hscroll">
        {tab === 'all' && (
          g.onlineCount + g.offline.length === 0
            ? <Empty>まだフレンドがいません。セッションで会った人のプロフィールから申請できます</Empty>
            : (
              <div className="hfcols">
                {inSession && <FriendSection title="このセッションにいる" list={g.sameSession} kind="same" />}
                <FriendSection title="ほかのセッションにいる" list={g.otherSession} kind="other" />
                <FriendSection title="オンライン（セッション外）" list={g.online} kind="online" />
                <FriendSection title="オフライン" list={g.offline} kind="offline" />
              </div>
            )
        )}
        {tab === 'now' && (
          withFriends.length
            ? <div className="hgrid">{withFriends.map((s) => <NowCard key={s.id} s={s} onOpen={() => openSession(s.id)} />)}</div>
            : <Empty>フレンドがいるセッションはありません</Empty>
        )}
        {tab === 'req' && (
          <section className="hfsection">
            <span className="hlabel">届いたリクエスト<span> · {requests.length}</span></span>
            {requests.length === 0 && <Empty>届いているリクエストはありません</Empty>}
            {requests.map((n) => (
              <div key={n.id} className="hfriend">
                <Person name={n.fromName} size={36} />
                <span className="hftext"><b>{n.fromName}</b><span className="sub">フレンド申請</span></span>
                <button className="hsecondary small" onClick={() => set((s) => ({ notices: s.notices.filter((x) => x.id !== n.id) }))}>拒否</button>
                <button className="hprimary small" onClick={() => friendAccept(n.from, n.id)}>承認する</button>
              </div>
            ))}
            <span className="hlabel">送ったリクエスト</span>
            <Empty>[送ったリクエストの一覧]（準備中）</Empty>
          </section>
        )}
        {tab === 'block' && (
          <section className="hfsection">
            <span className="hlabel">ブロック中のユーザー<span> · {blocked.length}</span></span>
            <p className="sub wrap">ブロックした人の声・チャット・通知・効果音は、あなたに届かなくなります（このブラウザだけに保存）。</p>
            {blocked.length === 0 && <Empty>ブロックしている人はいません</Empty>}
            {blocked.map((name) => (
              <div key={name} className="hfriend">
                <Person name={name} size={36} />
                <span className="hftext"><b>{name}</b></span>
                <button className="hsecondary small" onClick={() => toggleBlock(name)}>ブロックを解除</button>
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}

export function SessionsPage() {
  const sessions = useHubSessions();
  const current = sessions.find((s) => s.here);
  const [filter, setFilter] = useState('おすすめ');
  return (
    <>
      <PageHeader title="セッション" sub="新しい出会いを探す" search="セッション・ワールドを検索" action={{ label: 'セッションを作る', icon: 'plus', onClick: soon }} />
      <div className="hscroll">
        {current && (
          <div className="hcurrent">
            <span className="hcthumb"><WorldThumb kind={current.world} h={52} label={false} /></span>
            <span className="hctext">
              <span><span className="hhere"><i />参加中</span><strong>{current.name}</strong></span>
              <span className="sub">ワールド：{WORLDS[current.world].name} · {current.users.length} 人{current.has2d && current.has3d ? ' · 2D・3D 混在' : ''}</span>
            </span>
            <span className="hstack">{current.users.slice(0, 4).map((u) => <Person key={u.id} name={u.name} user={u} ring="0 0 0 2px #fff" />)}</span>
            <button className="hsecondary" onClick={soon}><Icon name="link" size={14} />招待リンクをコピー</button>
            <button className="hsecondary" onClick={() => openHubPage('worlds')}><Icon name="globe" size={14} />ワールドを切り替える</button>
          </div>
        )}
        <div className="hfilterbar">
          <Chips items={['おすすめ', 'パブリック', 'グループパブリック', '初心者歓迎', '2D で参加できる']} value={filter} onChange={setFilter} />
          <span className="spacer" />
          <span className="sub">並び順：おすすめ</span>
        </div>
        <div className="hgrid">
          {sessions.map((s) => (
            <article key={s.id} className="hcard tile wide">
              <button className="hcover" onClick={() => openSession(s.id)} aria-label={`${s.name} の詳細を見る`} />
              <div className="hcardtop">
                <WorldThumb kind={s.world} h={96} />
                <span className="hbadges"><span>{s.users.length} 人</span>{(s.has2d || s.has3d) && <span>{[s.has2d && '2D', s.has3d && '3D'].filter(Boolean).join('・')}</span>}</span>
                {s.friends.length > 0 && <span className="hfbadge" title={`フレンドが ${s.friends.length} 人いる`}>フレンド {s.friends.length}</span>}
                <span className="hjoin"><JoinButton s={s} small /></span>
              </div>
              <div className="hcardbody">
                <div className="hcardtitle"><span><h3>{s.name}</h3><span className="sub">ワールド：{WORLDS[s.world].name}</span></span><AccessChip /></div>
                {s.topic && <div className="htags"><span>#{s.topic}</span></div>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

const WEEK = ['月', '火', '水', '木', '金', '土', '日'];
export function EventsPage() {
  const [filter, setFilter] = useState('すべて');
  const [view, setView] = useState<'month' | 'week' | 'list'>('month');
  const [offset, setOffset] = useState(0);
  const base = new Date();
  const month = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const lead = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = offset === 0 ? base.getDate() : -1;
  return (
    <>
      <PageHeader title="イベント" action={{ label: 'イベントを作る', icon: 'plus', onClick: soon }}>
        <Chips items={['すべて', '参加予定', 'フレンド', 'グループ']} value={filter} onChange={setFilter} />
      </PageHeader>
      <div className="hscroll">
        <div className="hcalhead">
          <button className="ib hiconbtn" aria-label="前の月" onClick={() => setOffset(offset - 1)}><Icon name="left" size={16} /></button>
          <h2>{month.getFullYear()}年 {month.getMonth() + 1}月</h2>
          <button className="ib hiconbtn" aria-label="次の月" onClick={() => setOffset(offset + 1)}><Icon name="right" size={16} /></button>
          <span className="spacer" />
          <Tabs value={view} onChange={setView} items={[{ id: 'month', label: '月' }, { id: 'week', label: '週' }, { id: 'list', label: 'リスト' }]} />
        </div>
        {view === 'list'
          ? <div className="hfsection">{DUMMY_UPCOMING.map((e, i) => <div key={i} className="hfriend"><span className="htime">{e.when}</span><span className="hftext"><b>{e.name}</b><span className="sub">{e.group}</span></span><button className="hsecondary small" onClick={soon}>参加登録</button></div>)}</div>
          : (
            <div className="hcal">
              {WEEK.map((d) => <span key={d} className="hcalwd">{d}</span>)}
              {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: days }, (_, i) => (
                <button key={i} className={`hcalday ${i + 1 === today ? 'today' : ''}`} onClick={soon}>
                  <span>{i + 1}</span>
                  {/* イベントはまだ無いので、いくつかの日にダミーの印を置く */}
                  {(i + 1) % 6 === 2 && <span className="hcalev">[イベント名]</span>}
                </button>
              ))}
            </div>
          )}
        <div className="hrow">{DUMMY_EVENTS.map((e, i) => <EventCard key={i} e={e} />)}</div>
      </div>
    </>
  );
}

export function GroupsPage() {
  const [tab, setTab] = useState<'about' | 'sessions' | 'events' | 'members' | 'news'>('about');
  return (
    <>
      <div className="hgrouphero">
        <WorldThumb h={140} label={false} />
        <div className="hgroupbar">
          <span className="hgroup" style={{ background: '#3E7FB0' }}>G</span>
          <span><strong>[グループ名]</strong><span className="sub">メンバー [人数] · オンライン [人数]</span></span>
          <span className="spacer" />
          <button className="hsecondary" onClick={soon}>参加済み</button>
        </div>
      </div>
      <div className="hpad">
        <Tabs value={tab} onChange={setTab} items={[
          { id: 'about', label: '概要' }, { id: 'sessions', label: 'セッション' }, { id: 'events', label: 'イベント' }, { id: 'members', label: 'メンバー' }, { id: 'news', label: 'お知らせ' },
        ]} />
      </div>
      <div className="hscroll hcols2">
        <section className="hfsection">
          <span className="hlabel">グループのセッション<span> · いま開いている</span></span>
          {DUMMY_GROUP_SESSIONS.map((g, i) => (
            <div key={i} className="hfriend"><span className="hgroup small" style={{ background: '#3E7FB0' }}>G</span><span className="hftext"><b>{g.name}</b><span className="sub">{g.count} 人 · 3D</span></span><button className="hprimary small" onClick={soon}>移動する</button></div>
          ))}
          <button className="hsecondary" onClick={soon}><Icon name="plus" size={14} />グループでセッションを作る</button>
        </section>
        <section className="hfsection">
          <span className="hlabel">次のイベント</span>
          <div className="hfriend"><span className="htime">金 20:00</span><span className="hftext"><b>[イベント名]</b><span className="sub">参加予定 [人数]</span></span></div>
          <span className="hlabel">お知らせ</span>
          <div className="hnews"><span className="sub">管理者 · [日付]</span><span>[お知らせ本文]</span></div>
        </section>
      </div>
    </>
  );
}

export function WorldsPage() {
  const session = useStore((s) => s.session);
  const sessionName = useStore((s) => sessionOf(s.session)?.name);
  const current = useStore((s) => worldKindOf(s));
  const [tab, setTab] = useState<'find' | 'fav' | 'recent' | 'mine'>('find');
  const [filter, setFilter] = useState('すべて');
  const list = WORLD_CARDS.filter((w) => filter === 'すべて' || (filter === '2D 対応' ? w.in2d : !w.in2d));
  const pick = (k: typeof current) => {
    if (!session) { soon(); return; }
    if (k !== current) set({ confirmWorld: k });
  };
  return (
    <>
      <PageHeader title="ワールド" search="ワールドを検索" />
      <div className="hpad hfilterbar">
        <Tabs value={tab} onChange={setTab} items={[{ id: 'find', label: 'さがす' }, { id: 'fav', label: 'お気に入り' }, { id: 'recent', label: '最近行った' }, { id: 'mine', label: '自分のワールド' }]} />
        <span className="spacer" />
        <Chips items={['すべて', '2D 対応', '3D のみ']} value={filter} onChange={setFilter} />
      </div>
      <div className="hscroll">
        {session && <div className="hinfo"><Icon name="globe" size={16} />セッション中です。ワールドを選ぶと、いまのセッション（{sessionName}）のワールドを切り替えられます。</div>}
        {tab !== 'find'
          ? <Empty>[{tab === 'fav' ? 'お気に入りのワールド' : tab === 'recent' ? '最近行ったワールド' : '自分が作ったワールド'}]（準備中）</Empty>
          : (
            <div className="hgrid">
              {list.map((w) => (
                <article key={w.kind} className={`hcard tile wide ${session && w.kind === current ? 'current' : ''}`}>
                  <button className="hcover" onClick={() => pick(w.kind)} aria-label={`${w.name} を選ぶ`} />
                  <div className="hcardtop">
                    <WorldThumb kind={w.kind} h={110} />
                    <button className="hfav ib" aria-label="お気に入り" onClick={(e) => { e.stopPropagation(); soon(); }}><Icon name="heart" size={16} /></button>
                    {session && w.kind === current && <span className="hbadges"><span className="hhere"><i />いまのワールド</span></span>}
                  </div>
                  <div className="hcardbody">
                    <strong>{w.name}</strong>
                    <span className="sub">制作：Tonarium</span>
                    <span className="sub wrap">{w.desc}</span>
                    <div className="htags">{w.in2d && <span>2D</span>}{w.in3d && <span>3D</span>}</div>
                  </div>
                </article>
              ))}
            </div>
          )}
      </div>
    </>
  );
}

export function ItemsPage() {
  const [tab, setTab] = useState<'owned' | 'find' | 'public'>('owned');
  const [filter, setFilter] = useState('すべて');
  const list = OWNED_ITEMS.filter((k) => filter === 'すべて'
    || (filter === 'ゲーム' && ITEM_INFO[k].genre === 'ゲーム')
    || (filter === '装備' && (k === 'hammer' || k === 'camera'))
    || (filter === '2D で使える' && ITEM_INFO[k].in2d));
  return (
    <>
      <PageHeader title="アイテム" search="アイテムを検索" />
      <div className="hpad hfilterbar">
        <Tabs value={tab} onChange={setTab} items={[{ id: 'owned', label: '持っているアイテム' }, { id: 'find', label: 'さがす' }, { id: 'public', label: '公開しているアイテム' }]} />
        <span className="spacer" />
        <Chips items={['すべて', 'ゲーム', '装備', '2D で使える']} value={filter} onChange={setFilter} />
      </div>
      <div className="hscroll">
        {tab !== 'owned'
          ? <Empty>[{tab === 'find' ? 'みんなが公開しているアイテム' : 'あなたが公開しているアイテム'}]（準備中）</Empty>
          : (
            <div className="hitemgrid">
              {list.map((k) => (
                <button key={k} className="hcard itembig ib" onClick={() => set({ hubDetail: { kind: 'item', item: k } })}>
                  <span className="hitemmark big" style={{ background: ITEM_INFO[k].tint, color: ITEM_INFO[k].ink }}>{ITEM_INFO[k].mark}</span>
                  <strong>{ITEM_INFO[k].name}</strong>
                  <span className="htags">{itemTags(k).map((t) => <span key={t}>{t}</span>)}</span>
                </button>
              ))}
            </div>
          )}
        <section className="hsection">
          <div className="hsechead"><h2>さがす：注目のアイテム</h2><span className="spacer" /><button className="ib hmore" onClick={soon}>もっと見る</button></div>
          <div className="hrow">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="hcard item"><span className="hitemmark" style={{ background: '#E7E1D6', color: '#6A6875' }}>？</span><span className="hptext"><strong>[アイテム名]</strong><span className="sub">制作：[制作者名]</span></span></div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
