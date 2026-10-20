import { useState } from 'react';
import { showToast, unreadOf, useStore } from '../store.ts';
import { channelKey, dmKey } from '../../../shared/protocol.ts';
import { sendMessage } from '../actions.ts';
import { Composer, Thread } from '../home/messages.tsx';
import { NameFace } from '../home/common.tsx';
import { Icon } from './Icon.tsx';
import { itemLabel } from './common.tsx';

interface Conv { key: string; title: string; mark: React.ReactNode }

/** 自分が入っている会話（DM はフレンド全員、チャンネルは所属グループの分） */
function useConvs(): Conv[] {
  const friends = useStore((s) => s.friends);
  const groups = useStore((s) => s.groups);
  const selfName = useStore((s) => s.selfName);
  const inbox = useStore((s) => s.inbox);
  const list: Conv[] = [
    ...groups.filter((g) => g.members.includes(selfName)).flatMap((g) => g.channels.map((c) => ({
      key: channelKey(g.id, c.id), title: `${g.name} #${c.name}`,
      mark: <span className="gmark tiny" style={{ background: g.color }}>{g.name.slice(0, 1)}</span>,
    }))),
    ...friends.map((n) => ({ key: dmKey(selfName, n), title: n, mark: <NameFace name={n} size={26} /> })),
  ];
  const last = (c: string) => inbox[c]?.at(-1)?.at ?? 0;
  return list.sort((a, b) => last(b.key) - last(a.key));
}

function ShareItem({ conv, onDone }: { conv: string; onDone: () => void }) {
  const items = useStore((s) => s.items);
  const sid = useStore((s) => s.session);
  const list = Object.values(items).filter((it) => it.kind !== 'hammer' && it.kind !== 'camera');
  return (
    <div className="mpick">
      {list.length === 0 && <span className="sub">このセッションに共有できるアイテムがありません</span>}
      {list.map((it) => (
        <button key={it.id} className="ib hpick" onClick={() => { if (sid) sendMessage(conv, { text: '', item: { session: sid, id: it.id } }); onDone(); }}>{itemLabel(it)}</button>
      ))}
    </div>
  );
}

function ConvView({ conv, title, onBack }: { conv: string; title: string; onBack: () => void }) {
  const sid = useStore((s) => s.session);
  const sessionName = useStore((s) => s.guild.sessions.find((d) => d.id === s.session)?.name);
  const [picking, setPicking] = useState(false);
  const callHere = () => {
    if (!sid) return;
    sendMessage(conv, { text: '', invite: sid });
    showToast(`${sessionName ?? 'このセッション'}への誘いを送りました`);
  };
  return (
    <>
      <div className="phead">
        <button className="ib" aria-label="会話の一覧に戻る" onClick={onBack}><Icon name="left" size={15} /></button>
        <h2 className="ellipsis">{title}</h2>
        <span className="spacer" />
        <button className="ib small" title="いまいるセッションへの誘いを送る" onClick={callHere}>ここに呼ぶ</button>
      </div>
      <Thread key={conv} conv={conv} empty="まだメッセージはありません" />
      {picking && <ShareItem conv={conv} onDone={() => setPicking(false)} />}
      <Composer
        conv={conv} placeholder="返信" allowPlan={conv.startsWith('ch:')}
        extra={<button type="button" className={`ib square ${picking ? 'on' : ''}`} aria-label="アイテムを共有" aria-pressed={picking} onClick={() => setPicking(!picking)}><Icon name="box" size={17} /></button>}
      />
    </>
  );
}

/** 右パネルのメッセージ。セッションの外のやりとりに、声や 3D を離れずに返す */
export function SessionMessages({ open, onOpen }: { open: string | null; onOpen: (conv: string | null) => void }) {
  const convs = useConvs();
  const inbox = useStore((st) => st.inbox);
  const reads = useStore((st) => st.reads);
  const selfName = useStore((st) => st.selfName);
  const s = { inbox, reads, selfName };
  const cur = convs.find((c) => c.key === open);
  if (cur) return <ConvView conv={cur.key} title={cur.title} onBack={() => onOpen(null)} />;
  return (
    <div className="convlist">
      <p className="sub wrap convhint">セッションの外のやりとり。セッションの中の会話は「ログ」に残る</p>
      {convs.length === 0 && <p className="empty">フレンドかグループができると、ここでやりとりできます</p>}
      {convs.map((c) => {
        const n = unreadOf(s, c.key);
        const last = s.inbox[c.key]?.at(-1);
        const preview = last ? (last.recap ? 'セッションのまとめ' : last.voice ? '声のメッセージ' : last.plan ? `日程の相談：${last.text}` : last.invite ? 'セッションへの誘い' : last.item ? last.item.summary : last.text) : '';
        return (
          <button key={c.key} className={`ib convrow ${n ? 'unread' : ''}`} onClick={() => onOpen(c.key)}>
            {c.mark}
            <span className="finfo"><b>{c.title}</b>{preview && <span className="sub">{last && last.from && !c.key.startsWith('dm:') ? `${last.from}：` : ''}{preview}</span>}</span>
            {n > 0 && <span className="badge">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 右パネルのタブに出す未読の合計 */
export function useMessageUnread() {
  const inbox = useStore((st) => st.inbox);
  const reads = useStore((st) => st.reads);
  const selfName = useStore((st) => st.selfName);
  return Object.keys(inbox).reduce((n, c) => n + unreadOf({ inbox, reads, selfName }, c), 0);
}
