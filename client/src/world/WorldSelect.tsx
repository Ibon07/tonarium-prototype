import { useState } from 'react';
import { useStore } from '../store.ts';
import { WORLDS } from '../../../shared/worlds.ts';
import { joinSession } from '../actions.ts';
import { ProfileDialog } from '../Profile.tsx';
import { Face } from './common.tsx';

export function WorldSelect() {
  const guild = useStore((s) => s.guild);
  const users = useStore((s) => s.users);
  const selfId = useStore((s) => s.selfId);
  const selfName = useStore((s) => s.selfName);
  const friends = useStore((s) => s.friends);
  const wsConnected = useStore((s) => s.wsConnected);
  const worldBy = useStore((s) => s.worldBy);
  const [profile, setProfile] = useState(false);
  return (
    <div className="worldselect">
      <header className="wshead">
        <img className="wmark" src="/brand/mark.png" alt="" />
        <h1>{guild.name}</h1>
        {!wsConnected && <span className="reconn">接続中…</span>}
        <span className="spacer" />
        <button className="selfbtn ib" onClick={() => setProfile(true)} title="アイコン・3D アバター・自己紹介を設定">
          <Face id={selfId} name={selfName} size={32} />
          <span><b>{selfName}</b><span className="sub">プロフィールを編集</span></span>
        </button>
      </header>
      <h2 className="wsh2">セッションを選ぶ</h2>
      <div className="worldcards">
        {guild.sessions.map((w) => {
          const here = users.filter((u) => u.session === w.id);
          const live = here.find((u) => u.sharing);
          const friendsHere = here.filter((u) => friends.includes(u.name));
          return (
            <button key={w.id} className="worldcard" onClick={() => joinSession(w.id)}>
              <div className="wctop">
                <h3>{w.name}</h3>
                <span className="wkind">{WORLDS[worldBy[w.id] ?? 'room'].name}</span>
                {live && <span className="livechip"><i />LIVE</span>}
              </div>
              {w.topic && <p>{w.topic}</p>}
              <div className="wcfoot">
                <span className="stack">{here.slice(0, 5).map((u) => <Face key={u.id} id={u.id} name={u.name} size={26} ring="0 0 0 2px #FFFDF9" />)}</span>
                <span className="sub">
                  {here.length ? `${here.length} 人` : 'だれもいません'}
                  {friendsHere.length > 0 && ` · フレンド ${friendsHere.map((u) => u.name).join('、')}`}
                  {live && ` · ${live.name} が画面共有中`}
                </span>
                <span className="spacer" />
                <span className="enter">入る</span>
              </div>
            </button>
          );
        })}
      </div>
      {profile && <ProfileDialog name={selfName} onClose={() => setProfile(false)} />}
    </div>
  );
}
