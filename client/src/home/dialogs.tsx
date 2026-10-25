import { contentAvailable, productFor } from '../../../shared/market.ts';
import { useOwnedContent } from '../market/store.ts';
import { OriginBadge } from '../market/OriginBadge.tsx';
import { useState } from 'react';
import { useStore } from '../store.ts';
import type { Group, Visibility } from '../../../shared/protocol.ts';
import { VISIBILITY_INFO, isGroupVisibility } from '../../../shared/protocol.ts';
import { GROUP_COLORS } from '../../../shared/home.ts';
import { WORLDS, WORLD_KINDS, type WorldKind } from '../../../shared/worlds.ts';
import { createEvent, createGroup, createSession, invite, updateGroup } from '../actions.ts';
import { pickGroupImage } from '../icon.ts';
import { GroupAvatar } from './GroupAvatar.tsx';
import { Face } from '../world/common.tsx';
import { useMyGroups, useOnlineFriends } from './common.tsx';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modalbg light" onClick={onClose}>
      <div className="modal hmodal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function GroupSettingsDialog({ group: g, onClose }: { group: Group; onClose: () => void }) {
  const selfName = useStore((s) => s.selfName);
  const [name, setName] = useState(g.name);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(false);
  const owner = g.owner === selfName;
  const editors = g.editors ?? [];
  const upload = async () => {
    setUploading(true);
    setError(false);
    const ok = await pickGroupImage(g.id, selfName);
    setUploading(false);
    setError(!ok);
  };
  return (
    <Modal title="グループ設定" onClose={onClose}>
      <label className="hfield">グループ名<input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
      <div className="hfield">グループ画像
        <div className="row"><GroupAvatar group={g} size="big" /><button disabled={uploading} onClick={upload}>{uploading ? '画像を選択・送信中…' : '端末から画像を選ぶ'}</button></div>
        <span className="sub">画像は選択後すぐに保存されます</span>
        {error && <span role="status">画像は変更されませんでした。もう一度選んでください。</span>}
      </div>
      {owner && <div className="hfield">編集者
        <select aria-label="編集者を追加" value="" onChange={(e) => { if (e.target.value) updateGroup(g.id, { editors: [...editors, e.target.value] }); }}>
          <option value="">メンバーから追加</option>
          {g.members.filter((n) => n !== g.owner && !editors.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {editors.map((n) => <div className="row" key={n}><span>{n}</span><button aria-label={`${n} を編集者から外す`} onClick={() => updateGroup(g.id, { editors: editors.filter((x) => x !== n) })}>×</button></div>)}
      </div>}
      <div className="row end"><button onClick={onClose}>閉じる</button><button className="primary" disabled={!name.trim()} onClick={() => { updateGroup(g.id, { name }); onClose(); }}>名前を保存</button></div>
    </Modal>
  );
}

/** group を渡すと、そのグループのセッションとして作る */
export function CreateSessionDialog({ world: initial = 'room', group: fixedGroup, onClose }: { world?: WorldKind; group?: string; onClose: () => void }) {
  const myGroups = useMyGroups();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const owned = useOwnedContent();
  const [world, setWorld] = useState<WorldKind>(initial);
  const [visibility, setVisibility] = useState<Visibility>(fixedGroup ? 'group' : 'public');
  const [group, setGroup] = useState(fixedGroup ?? myGroups[0]?.id ?? '');
  const groupVis = isGroupVisibility(visibility);
  const ok = !!name.trim() && (!groupVis || !!group);
  const submit = () => {
    if (!ok) return;
    createSession(name, topic, world, visibility, groupVis ? group : undefined);
    onClose();
  };
  return (
    <Modal title="セッションを作る" onClose={onClose}>
      <label className="hfield">セッション名<input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
      <label className="hfield">トピック（任意）<input value={topic} maxLength={100} placeholder="何をする場所か" onChange={(e) => setTopic(e.target.value)} /></label>
      <div className="hfield">ワールド
        <div className="hchoices">
          {WORLD_KINDS.filter((k) => contentAvailable(owned, 'worlds', k)).map((k) => (
            <div key={k} className="market-entry"><button className={`hchoice ${world === k ? 'on' : ''}`} onClick={() => setWorld(k)}><b>{WORLDS[k].name}</b><span className="sub wrap">{WORLDS[k].desc}</span></button><OriginBadge productId={productFor('worlds', k)?.id} onOpen={onClose} /></div>
          ))}
        </div>
      </div>
      <div className="hfield">公開範囲
        <div className="hchoices">
          {(Object.keys(VISIBILITY_INFO) as Visibility[]).map((v) => (
            <button key={v} className={`hchoice ${visibility === v ? 'on' : ''}`} disabled={isGroupVisibility(v) && !myGroups.length} onClick={() => setVisibility(v)}>
              <b>{VISIBILITY_INFO[v].name}</b><span className="sub wrap">{isGroupVisibility(v) && !myGroups.length ? 'グループに入ると選べます' : VISIBILITY_INFO[v].desc}</span>
            </button>
          ))}
        </div>
      </div>
      {groupVis && !fixedGroup && (
        <label className="hfield">グループ
          <select value={group} onChange={(e) => setGroup(e.target.value)}>{myGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        </label>
      )}
      <div className="row end"><button onClick={onClose}>やめる</button><button className="primary" disabled={!ok} onClick={submit}>作る</button></div>
    </Modal>
  );
}

export function CreateGroupDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_COLORS[0]);
  const submit = () => { if (name.trim()) { createGroup(name, color); onClose(); } };
  return (
    <Modal title="グループを作る" onClose={onClose}>
      <label className="hfield">グループ名<input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
      <div className="hfield">色
        <div className="row">
          {GROUP_COLORS.map((c) => <button key={c} className={`hcolor ${color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />)}
        </div>
      </div>
      <div className="row end"><button onClick={onClose}>やめる</button><button className="primary" disabled={!name.trim()} onClick={submit}>作る</button></div>
    </Modal>
  );
}

/** datetime-local の値（ローカル時刻）。既定は次の 00 分 */
function defaultAt() {
  const d = new Date(Date.now() + 3_600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreateEventDialog({ onClose }: { onClose: () => void }) {
  const myGroups = useMyGroups();
  const sessions = useStore((s) => s.guild.sessions);
  const [title, setTitle] = useState('');
  const [at, setAt] = useState(defaultAt);
  const [group, setGroup] = useState('');
  const [session, setSession] = useState('');
  const ok = !!title.trim() && Number.isFinite(new Date(at).getTime());
  const submit = () => {
    if (!ok) return;
    createEvent(title, new Date(at).getTime(), group || null, session || null);
    onClose();
  };
  return (
    <Modal title="イベントを作る" onClose={onClose}>
      <label className="hfield">イベント名<input autoFocus value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
      <label className="hfield">日時<input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
      <label className="hfield">グループ（任意）
        <select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">なし</option>{myGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      </label>
      <label className="hfield">会場のセッション（任意）
        <select value={session} onChange={(e) => setSession(e.target.value)}><option value="">なし</option>{sessions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </label>
      <div className="row end"><button onClick={onClose}>やめる</button><button className="primary" disabled={!ok} onClick={submit}>作る</button></div>
    </Modal>
  );
}

/** フレンドを、自分に見えているセッションかグループに誘う */
export function InviteFriendDialog({ to, onClose }: { to: { id: string; name: string }; onClose: () => void }) {
  const sessions = useStore((s) => s.guild.sessions);
  const myGroups = useMyGroups();
  const pick = (kind: 'session' | 'group', id: string) => { invite(kind, id, to.id); onClose(); };
  return (
    <Modal title={`${to.name} を誘う`} onClose={onClose}>
      <h3>セッション</h3>
      <div className="hlist">
        {sessions.map((d) => <button key={d.id} className="ib hpick" onClick={() => pick('session', d.id)}><b>{d.name}</b><span className="sub">{d.topic}</span></button>)}
      </div>
      {myGroups.length > 0 && <>
        <h3>グループ</h3>
        <div className="hlist">
          {myGroups.filter((g) => !g.members.includes(to.name)).map((g) => <button key={g.id} className="ib hpick" onClick={() => pick('group', g.id)}><i className="gdot" style={{ background: g.color }} /><b>{g.name}</b></button>)}
        </div>
      </>}
      <div className="row end"><button onClick={onClose}>やめる</button></div>
    </Modal>
  );
}

/** グループにオンラインのフレンドを誘う */
export function InviteToGroupDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const friends = useOnlineFriends().filter((u) => !group.members.includes(u.name));
  return (
    <Modal title={`${group.name} に誘う`} onClose={onClose}>
      <div className="hlist">
        {friends.length === 0 && <p className="hempty">誘えるオンラインのフレンドがいません</p>}
        {friends.map((u) => <button key={u.id} className="ib hpick" onClick={() => { invite('group', group.id, u.id); onClose(); }}><Face id={u.id} name={u.name} size={24} /><b>{u.name}</b></button>)}
      </div>
      <div className="row end"><button onClick={onClose}>やめる</button></div>
    </Modal>
  );
}
