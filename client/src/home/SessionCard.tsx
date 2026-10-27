import { useStore } from '../store.ts';
import type { SessionDef, SessionInfo } from '../../../shared/protocol.ts';
import { VISIBILITY_INFO } from '../../../shared/protocol.ts';
import { WORLDS, type WorldKind } from '../../../shared/worlds.ts';
import { deleteSession, joinSession } from '../actions.ts';
import { Face } from '../world/common.tsx';
import { Icon } from '../world/Icon.tsx';
import { Chip, ModeIcon, timeLabel, uniqueByName } from './common.tsx';

const WORLD_TINT: Record<WorldKind, string> = { room: '#DCE6F3', cafe: '#F3E6C6', game: '#E7DDF2', survivors: '#F2D5E2', city: '#D7EAD3', garden: '#DDEBCF', fantasy: '#DFD0A8' };

const VIS_ICON = { public: 'globe', friends: 'people', groupPlus: 'flag', group: 'flag', invite: 'send' } as const;
const NO_ITEMS: SessionInfo['items'] = [];

export function SessionCard({ s, showDelete }: { s: SessionDef; showDelete?: boolean }) {
  const users = useStore((st) => st.users);
  const friends = useStore((st) => st.friends);
  const selfName = useStore((st) => st.selfName);
  const group = useStore((st) => st.groups.find((g) => g.id === s.group));
  const world = useStore((st) => st.worldBy[s.id] ?? s.world ?? 'room');
  const here = uniqueByName(users.filter((u) => u.session === s.id));
  const left = useStore((st) => st.sessionInfo[s.id]?.items ?? NO_ITEMS).map((i) => i.summary);
  const nextEvent = useStore((st) => st.events.find((e) => e.session === s.id && e.at > Date.now() - 3_600_000));
  const friendsHere = here.filter((u) => friends.includes(u.name));
  const others = here.filter((u) => !friends.includes(u.name));
  // フレンドを先に並べ、いなければ中にいる人を見せる
  const shown = [...friendsHere, ...others].slice(0, 6);
  const sharing = here.some((u) => u.sharing);
  const vis = s.visibility ?? 'public';
  const invitedByOwner = s.owner && s.owner !== selfName && s.invited?.includes(selfName);
  const current = useStore((st) => st.session);
  return (
    <article className="scard">
      <div className="schead" style={{ background: WORLD_TINT[world] }}>
        <span className="pill dark">{here.length} 人</span>
        {sharing && <span className="livechip"><Icon name="screen" size={11} />画面共有</span>}
        <span className="spacer" />
        <span className="scworld"><Icon name="globe" size={13} />{WORLDS[world].name}</span>
        {current === s.id
          ? <span className="hhere"><i />参加中</span>
          : <button className="primary scjoin" onClick={() => joinSession(s.id)}>{current ? '移動する' : '参加する'}</button>}
      </div>
      <div className="scbody">
        <div className="sctitle">
          <h3 title={s.topic}>{s.name}</h3>
          <Chip kind={vis}><Icon name={VIS_ICON[vis]} size={11} />{(vis === 'group' || vis === 'groupPlus') && group ? `${group.name}${vis === 'groupPlus' ? '＋' : ''}` : VISIBILITY_INFO[vis].name}</Chip>
        </div>
        <span className="sub">{s.topic || `ワールド：${WORLDS[world].name}`}</span>
        {invitedByOwner && <span className="scinvited">{s.owner} から招待されています</span>}
        <div className="scpeople">
          <b className={friendsHere.length ? 'acc' : ''}>
            {friendsHere.length ? `フレンド ${friendsHere.length} 人` : here.length ? `${here.length} 人がいます` : 'だれもいません'}
          </b>
          {shown.length > 0 && (
            <div className="scfaces">
              {shown.map((u) => (
                <span key={u.id} className="scface">
                  <Face id={u.id} name={u.name} size={22} />
                  <span className="scname">{u.name}</span>
                  <ModeIcon mode={u.mode} sharing={u.sharing} />
                </span>
              ))}
              {here.length > shown.length && <span className="scmore">ほか {here.length - shown.length} 人</span>}
            </div>
          )}
        </div>
        {(left.length > 0 || nextEvent) && (
          <div className="scleft">
            {nextEvent && <span className="hchip friends">{timeLabel(nextEvent.at)} {nextEvent.title}</span>}
            {[...new Set(left)].slice(0, 3).map((t) => <span key={t} className="hchip">{t}</span>)}
          </div>
        )}
        {showDelete && s.owner === selfName && (
          <button className="ib scdel" disabled={here.length > 0} title={here.length ? 'だれかがいる間は消せません' : 'このセッションを消す'} onClick={() => deleteSession(s.id)}>
            <Icon name="trash" size={13} />消す
          </button>
        )}
      </div>
    </article>
  );
}
