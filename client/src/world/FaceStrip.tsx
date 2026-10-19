import { useEffect, useState } from 'react';
import type { ChatMessage, User } from '../../../shared/protocol.ts';
import { useStore, set, save, heldHammer } from '../store.ts';
import { formatDistance } from '../spatial.ts';
import { recentlyHit } from '../items/effects.ts';
import { Icon } from './Icon.tsx';
import { Badge3D, Face, usePlayers, type PlayerEntry } from './common.tsx';
import { AvatarView } from './Portraits.tsx';
import { pickUser } from './NearList.tsx';
import { toggleFromList, useIsOpen } from './windows.ts';

const NEAR_MAX = 4;
const MID_MAX = 3;
const BUBBLE_MS = 30_000;
const NO_CHAT: ChatMessage[] = [];

function useLastSaid(id: string) {
  const chat = useStore((s) => (s.session ? s.chats[s.session] ?? NO_CHAT : NO_CHAT));
  const [, tick] = useState(0);
  const last = [...chat].reverse().find((m) => m.from === id && m.text);
  const fresh = last && Date.now() - last.at < BUBBLE_MS;
  useEffect(() => {
    if (!fresh || !last) return;
    const t = setTimeout(() => tick((n) => n + 1), BUBBLE_MS - (Date.now() - last.at) + 50);
    return () => clearTimeout(t);
  }, [fresh, last]);
  return fresh ? last.text : null;
}

const POKE_MS = 1100;

/** つんつんされた直後だけ true。終わったら描き直す */
function usePoked(id: string) {
  const at = useStore((s) => s.pokes[id]);
  const [, tick] = useState(0);
  const on = at !== undefined && performance.now() - at < POKE_MS;
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => tick((n) => n + 1), POKE_MS - (performance.now() - at!) + 30);
    return () => clearTimeout(t);
  }, [on, at]);
  return on ? at : null;
}

function PokeFx({ at, small = false }: { at: number; small?: boolean }) {
  return (
    <span key={at} className={`pokefx ${small ? 'small' : ''}`} aria-hidden="true">
      <span className="pokehand"><Icon name="poke" size={small ? 22 : 34} stroke={2.2} /></span>
      {!small && <span className="poketext">つんつん</span>}
    </span>
  );
}

function BigFace({ u, d, self = false }: { u: User; d: number; self?: boolean }) {
  const poked = usePoked(u.id);
  const speaking = useStore((s) => !!s.speaking[u.id]);
  const sharer = useStore((s) => s.sharer);
  const hammer = useStore((s) => s.mode === '2d' && !!heldHammer(s));
  useStore((s) => s.hits[u.id]);
  const open = useIsOpen('share');
  const said = useLastSaid(u.id);
  const live = u.sharing && sharer === u.id;
  const canHit = hammer && !self;
  return (
    <div
      className={`bigface ${poked ? 'poked' : ''} ${self ? 'self' : ''} ${speaking ? 'speaking' : ''} ${open && live ? 'watching' : ''} ${recentlyHit(u.id) ? 'hit' : ''} ${canHit ? 'hittable' : ''}`}
      data-uid={u.id}
    >
      <AvatarView u={u} speaking={speaking} />
      {poked && <PokeFx at={poked} />}
      <button className="faceclick" onClick={() => pickUser(u.id)} aria-label={canHit ? `${u.name} を叩く` : `${u.name} のプロフィール`} />
      <div className="facebadges">
        {u.mode === '3d' && <Badge3D />}
        {live && (
          <button className="livebtn small" onClick={() => toggleFromList('share')} title={open ? 'ライブを閲覧中（クリックで閉じる）' : 'クリックでライブを見る'}>
            <span className="lb"><Icon name="screen" size={11} stroke={2.4} />ライブ</span>
            {open && <span className="lbon"><Icon name="eye" size={12} stroke={2.4} /></span>}
          </button>
        )}
      </div>
      {said && <div className="bubble">{said}</div>}
      <div className="facelabel">
        <Face id={u.id} name={u.name} size={18} ring="0 0 0 1.5px #fff" />
        {speaking && <span className="spk"><Icon name="speaking" size={12} stroke={2.6} /></span>}
        {!u.micOn && <span className="spk off"><Icon name="micOff" size={12} /></span>}
        <b>{u.name}</b>
        <span className="d">{self ? 'あなた' : formatDistance(d)}</span>
      </div>
    </div>
  );
}

function MidFace({ p }: { p: PlayerEntry }) {
  const poked = usePoked(p.user.id);
  return (
    <button
      className={`midface ${poked ? 'poked' : ''}`} data-uid={p.user.id} onClick={() => pickUser(p.user.id)}
      title={`${p.user.name} · ${formatDistance(p.d)}`} aria-label={`${p.user.name} のプロフィール`}
    >
      <AvatarView u={p.user} speaking={false} small />
      <span className="mf"><Face id={p.user.id} name={p.user.name} size={16} ring="0 0 0 1.5px #fff" /></span>
      {p.user.mode === '3d' && <span className="mf3d">3D</span>}
      {poked && <PokeFx at={poked} small />}
    </button>
  );
}

export function FaceStrip() {
  const players = usePlayers();
  const folded = useStore((s) => s.folded.faces);
  const me = useStore((s) => s.participants.find((p) => p.id === s.selfId));
  const near = players.filter((p) => p.band === 'near');
  const mid = players.filter((p) => p.band === 'mid');
  const fold = (faces: boolean) => set((s) => { const f = { ...s.folded, faces }; save('tonarium.folded', f); return { folded: f }; });
  if (!me) return null;
  if (folded) {
    return (
      <div className="facestrip">
        <button className="facepill" onClick={() => fold(false)} aria-label="顔の表示を開く">
          <span className="stack">{near.slice(0, 4).map((p) => <Face key={p.user.id} id={p.user.id} name={p.user.name} size={24} ring="0 0 0 2px #FFFDF9" />)}</span>
          <b>すぐそば {near.length}</b><span className="sub">· 声が届く {mid.length}</span>
          <Icon name="down" size={14} stroke={2.4} />
        </button>
      </div>
    );
  }
  const rest = mid.slice(MID_MAX);
  return (
    <div className="facestrip">
      <div className="faces" aria-label="すぐそばの人">
        <BigFace u={me} d={0} self />
        {near.slice(0, NEAR_MAX).map((p) => <BigFace key={p.user.id} u={p.user} d={p.d} />)}
        {mid.length > 0 && (
          <div className="midfaces">
            {mid.slice(0, MID_MAX).map((p) => <MidFace key={p.user.id} p={p} />)}
            {rest.length > 0 && (
              <span className="midmore" title={rest.map((r) => r.user.name).join('、')} aria-label={`ほか ${rest.length} 人`}>+{rest.length}</span>
            )}
          </div>
        )}
      </div>
      <button className="facefold" onClick={() => fold(true)} aria-label="顔の表示を上にたたむ"><Icon name="up" size={14} stroke={2.4} /></button>
    </div>
  );
}
