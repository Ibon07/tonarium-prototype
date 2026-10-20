import { ITEM_INFO } from '../../../shared/items.ts';
import { useStore, set } from '../store.ts';
import { Icon } from '../world/Icon.tsx';
import {
  DUMMY_EVENTS, DUMMY_GROUP_SESSIONS, OWNED_ITEMS, WORLD_CARDS, openHubPage, soon, useFriendGroups, useHubSessions, type DummyEvent,
} from './data.ts';
import { AccessChip, NowCard, PageHeader, Person, Section, SessionTile, WorldThumb } from './parts.tsx';

export function EventCard({ e }: { e: DummyEvent }) {
  const inSession = useStore((s) => !!s.session);
  return (
    <article className={`hcard event ${e.registered ? 'reg' : ''}`}>
      <div className="hevtop">
        <span className="hlive"><i />開催中</span><span className="htime">{e.time}</span><span className="spacer" />
        {e.registered && <span className="hregd">参加登録済み</span>}
      </div>
      <div><h3>{e.name}</h3><span className="sub">{e.group}</span></div>
      <div className="hevfoot"><span className="sub">[参加者数] 人</span><span className="spacer" /><button className="hprimary small" onClick={soon}>{inSession ? '移動する' : '参加する'}</button></div>
    </article>
  );
}

/** カテゴリは 1 列ずつ横に並べ、続きは「もっと見る」から各ページへ。0 件のカテゴリは出さない */
export function HomePage() {
  const sessions = useHubSessions();
  const { online } = useFriendGroups();
  const withFriends = sessions.filter((s) => s.friends.length).sort((a, b) => b.friends.length - a.friends.length);
  const open = (id: string) => set({ hubDetail: { kind: 'session', id } });
  const inSession = useStore((s) => !!s.session);
  return (
    <>
      <PageHeader title="ホーム" search="フレンド・ワールド・グループを検索" action={inSession ? undefined : { label: 'セッションを作る', icon: 'plus', onClick: soon }}>
        <button className="hiconbtn ib" aria-label="通知" onClick={soon}><Icon name="bell" size={18} /></button>
      </PageHeader>
      <div className="hscroll">
        <Section title="参加登録している開催中のイベント" onMore={() => openHubPage('events')}>
          {DUMMY_EVENTS.filter((e) => e.registered).map((e, i) => <EventCard key={i} e={e} />)}
        </Section>
        {withFriends.length > 0 && (
          <Section title="フレンドの今" sub="フレンドが多い順" onMore={() => openHubPage('friends')}>
            {withFriends.map((s) => <NowCard key={s.id} s={s} onOpen={() => open(s.id)} />)}
          </Section>
        )}
        {online.length > 0 && (
          <Section title="オンラインのフレンド" sub="セッションにいないフレンド" onMore={() => openHubPage('friends')}>
            {online.map((f) => (
              <div key={f.name} className="hcard person">
                <Person name={f.name} user={f.user} size={36} />
                <span className="hptext"><b>{f.name}</b><span className="sub">オンライン</span></span>
                <button className="hsecondary small" onClick={soon}>誘う</button>
              </div>
            ))}
          </Section>
        )}
        <Section title="グループのセッション" sub="所属グループのセッション" onMore={() => openHubPage('groups')}>
          {DUMMY_GROUP_SESSIONS.map((g, i) => (
            <article key={i} className="hcard tile">
              <button className="hcover" onClick={soon} aria-label={`${g.name} の詳細を見る`} />
              <div className="hcardtop"><WorldThumb h={84} /><span className="hbadges right"><AccessChip label={g.access} /></span></div>
              <div className="hcardbody"><h3>{g.name}</h3><span className="sub">{g.group} · {g.count} 人</span></div>
            </article>
          ))}
        </Section>
        <Section title="開催中のイベント" onMore={() => openHubPage('events')}>
          {DUMMY_EVENTS.filter((e) => !e.registered).map((e, i) => <EventCard key={i} e={e} />)}
        </Section>
        {sessions.length > 0 && (
          <Section title="参加可能なセッション" onMore={() => openHubPage('sessions')}>
            {sessions.map((s) => <SessionTile key={s.id} s={s} onOpen={() => open(s.id)} />)}
          </Section>
        )}
        <Section title="新着ワールド" onMore={() => openHubPage('worlds')}>
          {WORLD_CARDS.map((w) => (
            <article key={w.kind} className="hcard tile">
              <div className="hcardtop"><WorldThumb kind={w.kind} h={84} /></div>
              <div className="hcardbody"><h3>{w.name}</h3><span className="sub">Tonarium</span><span className="htags">{w.in2d && <span>2D</span>}{w.in3d && <span>3D</span>}</span></div>
            </article>
          ))}
        </Section>
        <Section title="新着アイテム" onMore={() => openHubPage('items')}>
          {OWNED_ITEMS.map((k) => (
            <button key={k} className="hcard item ib" onClick={() => set({ hubDetail: { kind: 'item', item: k } })}>
              <span className="hitemmark" style={{ background: ITEM_INFO[k].tint, color: ITEM_INFO[k].ink }}>{ITEM_INFO[k].mark}</span>
              <span className="hptext"><strong>{ITEM_INFO[k].name}</strong><span className="sub">{ITEM_INFO[k].genre} · Tonarium</span></span>
            </button>
          ))}
        </Section>
      </div>
    </>
  );
}
