import { useState } from 'react';
import { useStore, set, colorOf } from '../store.ts';
import { follow, friendRequest, goNear, poke, report, toggleBlock } from '../actions.ts';
import { useDistanceLabel } from '../spatial.ts';
import { Icon } from './Icon.tsx';
import { Face } from './common.tsx';

function ProfileDistance({ id }: { id: string }) {
  return <>{useDistanceLabel('user', id)}</>;
}

export function ProfileCard() {
  const id = useStore((s) => s.profileOf);
  const u = useStore((s) => s.participants.find((x) => x.id === s.profileOf));
  const me = useStore((s) => s.participants.find((p) => p.id === s.selfId));
  const friends = useStore((s) => s.friends);
  const blocked = useStore((s) => s.blocked);
  const [requested, setRequested] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState('');
  if (!id || !u) return null;
  const close = () => { set({ profileOf: null }); setReporting(false); setDone(''); };
  const self = me?.id === u.id;
  const run = (f: () => void) => () => { f(); close(); };
  const canFollow = me?.mode === '2d' && u.mode === '3d' && !self;
  const following = me?.follow === u.id;
  const isFriend = friends.includes(u.name);
  const isBlocked = blocked.includes(u.name);
  const status = `${u.mode === '3d' ? '3D' : '2D'} で参加中${u.sharing ? ' · 画面共有中' : ''}${!u.micOn ? ' · ミュート' : ''}${isFriend ? ' · フレンド' : ''}`;
  const sendReport = async () => {
    const ok = await report(u.name, reason);
    setDone(ok ? '通報を送りました。ありがとうございます' : '通報を送れませんでした');
    setReporting(false);
    setReason('');
  };

  return (
    <div className="modalbg" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label={`${u.name} のプロフィール`} className="profilecard" onClick={(e) => e.stopPropagation()}>
        <div className="pcbanner" style={{ background: colorOf(u.id) }} />
        <button className="ib pcclose" onClick={close} aria-label="閉じる"><Icon name="close" /></button>
        <div className="pcbody">
          <Face id={u.id} name={u.name} size={80} ring="0 0 0 4px #FFFDF9" />
          <div className="pcname">
            <h2>{u.name}</h2>
            <span className="sub">{status} · <ProfileDistance id={u.id} /></span>
          </div>
          <p className="bio">{u.bio || '自己紹介はまだありません'}</p>
          {!self && (
            <div className="pcacts">
              <button className="primary" onClick={run(() => goNear(u.id))}><Icon name="near" />そばにいく</button>
              <button onClick={run(() => follow(following ? null : u.id))} disabled={!canFollow} title={canFollow ? undefined : '2D から 3D の人についていけます'}>
                <Icon name="follow" />{following ? 'やめる' : 'ついていく'}
              </button>
              <button onClick={run(() => poke(u.id))}><Icon name="poke" />つんつん</button>
            </div>
          )}
          {!self && (
            <div className="pcfoot">
              <button
                className="ib" disabled={isFriend || requested === u.id}
                onClick={() => { friendRequest(u.id); setRequested(u.id); }}
              >{isFriend ? 'フレンド' : requested === u.id ? '申請しました' : 'フレンド申請'}</button>
              <span className="spacer" />
              <button className="ib" onClick={() => toggleBlock(u.name)}>{isBlocked ? 'ブロック解除' : 'ブロック'}</button>
              <button className="ib danger" onClick={() => setReporting(!reporting)}>通報</button>
            </div>
          )}
          {isBlocked && <div className="sub">ブロック中：この人の声・チャット・通知はあなたに届きません</div>}
          {reporting && (
            <div className="reportbox">
              <label htmlFor="reportreason">通報の理由</label>
              <textarea id="reportreason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="何があったかを書いてください" />
              <button className="danger" onClick={() => void sendReport()}>通報を送る</button>
            </div>
          )}
          {done && <div className="sub ok">{done}</div>}
        </div>
      </div>
    </div>
  );
}
