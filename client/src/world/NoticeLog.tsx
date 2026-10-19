import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatScope } from '../../../shared/protocol.ts';
import { VOICE_RANGE } from '../../../shared/places.ts';
import { useStore, set, save, colorOf, isBroadcast, type Notice } from '../store.ts';
import { friendAccept, goNear, markNoticesRead, poke, sendChat, setViewLive } from '../actions.ts';
import { Icon } from './Icon.tsx';
import { ChatImage, Face, itemLabel } from './common.tsx';
import { openWindow } from './windows.ts';
import { canItemize, itemizeMessage, uploadMedia } from '../media.ts';
import { Linkified, OgpCard, firstUrl } from './Links.tsx';

const NO_CHAT: ChatMessage[] = [];
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const SCOPES: { scope: ChatScope; label: string; title: string; placeholder: string }[] = [
  { scope: 'near', label: '声の範囲', title: `声の届く範囲（〜${VOICE_RANGE}m）に送信`, placeholder: `声の届く範囲（〜${VOICE_RANGE}m）に送信` },
  { scope: 'all', label: '全体', title: 'ワールド全体に送信', placeholder: 'ワールド全体に送信' },
  { scope: 'announce', label: 'アナウンス', title: '通知の上に固定されるお知らせとして送信', placeholder: 'アナウンスを送信（全員の通知に固定されます）' },
];

function useVisibleChat() {
  const chat = useStore((s) => (s.session ? s.chats[s.session] ?? NO_CHAT : NO_CHAT));
  const blocked = useStore((s) => s.blocked);
  return chat.filter((m) => !(m.from && blocked.includes(m.fromName)));
}

const NOTICE_TEXT: Record<Notice['kind'], string> = {
  poke: ' があなたをつんつんしました',
  hit: ' にピコピコハンマーで叩かれました',
  friend: ' からフレンド申請が届きました',
  live: ' が視点のライブをリクエストしました',
  attention: ' が注目を集めています',
};

function NoticeRow({ n }: { n: Notice }) {
  const target = useStore((s) => (n.key ? s.items[n.key.slice(n.key.indexOf(':') + 1)] : undefined));
  const text = n.kind === 'attention' ? (target ? ` が「${itemLabel(target)}」に注目を集めています` : ' が注目を集めていたもの（片付けられました）') : NOTICE_TEXT[n.kind];
  const reply = n.kind === 'attention'
    ? <button className="ib reply" disabled={!target} onClick={() => n.key && openWindow(n.key)}>開く</button>
    : n.kind === 'poke'
    ? <button className="ib reply" onClick={() => poke(n.from)}>つんつん返す</button>
    : n.kind === 'hit'
      ? <button className="ib reply" onClick={() => goNear(n.from)}>そばにいく</button>
      : n.kind === 'live'
        ? <button className="ib reply" onClick={() => setViewLive(true, n.id)}>ライブを始める</button>
        : <button className="ib reply" onClick={() => friendAccept(n.from, n.id)}>承認する</button>;
  return (
    <div className={`notice ${n.unread ? 'unread' : ''}`}>
      <Face id={n.from} name={n.fromName} size={28} />
      <div className="ntext">
        <span><b>{n.fromName}</b>{text}</span>
        <span className="sub">{time(n.at)}</span>
      </div>
      {n.unread && <span className="unreaddot" aria-label="未読" />}
      {reply}
    </div>
  );
}

function Composer() {
  const [text, setText] = useState('');
  const [scope, setScope] = useState<ChatScope>('near');
  const fileRef = useRef<HTMLInputElement>(null);
  const cur = SCOPES.find((x) => x.scope === scope)!;
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    sendChat(text, scope);
    setText('');
  };
  const broadcast = useStore((s) => isBroadcast(s));
  const placeholder = scope === 'near' && broadcast ? 'ブロードキャスト中：全員に届きます' : cur.placeholder;
  const attach = async (file: File | undefined) => {
    if (!file) return;
    const media = await uploadMedia(file);
    if (!media) return;
    sendChat(text, scope, undefined, media);
    setText('');
  };
  return (
    <>
      <div className="scopes" role="radiogroup" aria-label="送信範囲">
        {SCOPES.map((x) => (
          <button
            key={x.scope} role="radio" aria-checked={scope === x.scope} title={x.title}
            className={`scope ${scope === x.scope ? 'on' : 'ib'}`} onClick={() => setScope(x.scope)}
          >
            {x.scope === 'announce' ? <Icon name="megaphone" size={13} /> : <span className={`dot ${x.scope}`} />}
            {x.label}
          </button>
        ))}
      </div>
      <form className="composer" onSubmit={submit}>
        <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm" hidden onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="ib square" aria-label="画像・動画を添付" title="画像（10MB まで）・動画（50MB まで）を添付" onClick={() => fileRef.current?.click()}><Icon name="attach" size={18} /></button>
        <label htmlFor="chatinput" className="sr">メッセージ</label>
        <input
          id="chatinput" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }}
        />
        <button type="submit" className="primary square" aria-label="送信"><Icon name="send" size={18} /></button>
      </form>
    </>
  );
}

function LogLine({ m, selfId }: { m: ChatMessage; selfId: string }) {
  if (m.from === null) return <div className={`logevent ${m.about === selfId ? 'hi' : ''}`}>{m.text}</div>;
  return (
    <div className={`logchat ${m.scope}`}>
      <Face id={m.from} name={m.fromName} size={22} />
      <div className="lbody">
        <div className="lwho">
          <b style={{ color: colorOf(m.from) }}>{m.fromName}</b>
          {m.scope === 'all' && <span className="scopebadge all">全体</span>}
          {m.scope === 'announce' && <span className="scopebadge announce">アナウンス</span>}
          <span className="sub">{time(m.at)}</span>
        </div>
        {m.text && <span className="ltext"><Linkified text={m.text} /></span>}
        {firstUrl(m.text) && <OgpCard url={firstUrl(m.text)!} />}
        <ChatImage src={m.image} />
        {m.media?.kind === 'image' && <ChatImage src={m.media.url} />}
        {m.media?.kind === 'video' && <video className="chatvideo" src={m.media.url} controls preload="metadata" playsInline />}
        {canItemize(m) && (
          <button className="ib itemize" onClick={() => void itemizeMessage(m)} title="目の前にアイテムとして出す">
            <Icon name="box" size={12} />アイテムにする
          </button>
        )}
      </div>
    </div>
  );
}

export function NoticeLog() {
  const folded = useStore((s) => s.folded.right);
  const notices = useStore((s) => s.notices);
  const selfId = useStore((s) => s.selfId);
  const chat = useVisibleChat();
  const [tab, setTab] = useState<'all' | 'chat'>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const announce = [...chat].reverse().find((m) => m.scope === 'announce');
  const unread = notices.filter((n) => n.unread).length;
  const logs = tab === 'chat' ? chat.filter((m) => m.from !== null) : chat;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, tab, folded]);
  const fold = (right: boolean) => set((s) => { const f = { ...s.folded, right }; save('tonarium.folded', f); return { folded: f }; });

  if (folded) {
    return (
      <button className="foldedpanel right" onClick={() => fold(false)} aria-label="通知とログを開く">
        <Icon name="left" size={14} stroke={2.4} />
        <span className="fp bell"><Icon name="bell" size={18} />{unread > 0 && <span className="badge">{unread}</span>}</span>
        <span className="fpline" />
        <span className="fp"><Icon name="chat" size={18} /></span>
      </button>
    );
  }
  return (
    <aside className="panel noticelog" aria-label="通知とログ">
      <div className="phead">
        <h2>通知</h2>
        {unread > 0 && <span className="badge">{unread}</span>}
        <span className="spacer" />
        <button className="ib small" onClick={markNoticesRead} disabled={!unread}>すべて既読</button>
        <button className="ib" onClick={() => fold(true)} aria-label="パネルをたたむ"><Icon name="right" size={15} /></button>
      </div>
      <div className="notices">
        {announce && (
          <div className="announce">
            <span className="aicon"><Icon name="megaphone" /></span>
            <div>
              <div className="ahead"><strong>アナウンス</strong>{announce.fromName} · {time(announce.at)}</div>
              <span><Linkified text={announce.text} /></span>
            </div>
          </div>
        )}
        {notices.map((n) => <NoticeRow key={n.id} n={n} />)}
        {!announce && !notices.length && <div className="empty">通知はありません</div>}
      </div>
      <div className="psplit" aria-hidden="true"><span /></div>
      <div className="phead">
        <h2>ログ</h2>
        <span className="spacer" />
        <button className={`tab ${tab === 'all' ? 'on' : 'ib'}`} onClick={() => setTab('all')}>すべて</button>
        <button className={`tab ${tab === 'chat' ? 'on' : 'ib'}`} onClick={() => setTab('chat')}>チャット</button>
      </div>
      <div className="logs" ref={listRef}>
        {logs.map((m) => <LogLine key={m.id} m={m} selfId={selfId} />)}
      </div>
      <Composer />
    </aside>
  );
}
