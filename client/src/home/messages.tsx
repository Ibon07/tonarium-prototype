import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.ts';
import { PLAN_QUORUM, RSVP_LABEL, type Message, type Recap, type Rsvp } from '../../../shared/protocol.ts';
import { ITEM_INFO, type ItemKind } from '../../../shared/items.ts';
import { WORLDS } from '../../../shared/worlds.ts';
import { answerPlan, joinSession, markRead, sendMessage } from '../actions.ts';
import { uploadMedia } from '../media.ts';
import { ChatImage } from '../world/common.tsx';
import { Icon } from '../world/Icon.tsx';
import { Linkified } from '../world/Links.tsx';
import { openWindow } from '../world/windows.ts';
import { NameFace, timeLabel } from './common.tsx';

const NONE: Message[] = [];
const RSVPS = Object.keys(RSVP_LABEL) as Rsvp[];
const VOICE_MAX_SEC = 60;

function ItemTile({ kind, summary, image }: { kind: ItemKind; summary: string; image?: string }) {
  const info = ITEM_INFO[kind];
  if (image) return <img className="rtile img" src={image} alt={summary} />;
  return (
    <span className="rtile" style={{ background: info.tint, color: info.ink }}>
      <span className="rmark">{info.mark}</span>
      <span className="rsum">{summary}</span>
    </span>
  );
}

/** セッションに入って、そのアイテムのウィンドウを開く */
function continueWith(session: string, itemId: string | undefined) {
  joinSession(session);
  if (itemId) openWindow(`item:${itemId}`);
}

const CONTINUE_ORDER: ItemKind[] = ['chess', 'chessAi', 'g2048', 'canvas', 'note'];

function RecapCard({ r }: { r: Recap }) {
  const visible = useStore((s) => s.guild.sessions.some((d) => d.id === r.session));
  const world = useStore((s) => s.worldBy[r.session] ?? 'room');
  const [log, setLog] = useState(false);
  const target = CONTINUE_ORDER.map((k) => r.items.find((it) => it.kind === k)).find(Boolean);
  const min = Math.max(1, Math.round((r.to - r.from) / 60_000));
  const span = min >= 60 ? `${Math.floor(min / 60)} 時間 ${min % 60} 分` : `${min} 分`;
  return (
    <article className="recap" aria-label="セッションのまとめ">
      <div className="rhead" style={{ background: WORLD_TINT[world] }}>
        <Icon name="headset" size={14} />
        <b>{r.sessionName}でのできごと</b>
        <span className="spacer" />
        <span className="sub">{timeLabel(r.from)}〜{new Date(r.to).getHours()}:{String(new Date(r.to).getMinutes()).padStart(2, '0')}</span>
      </div>
      <div className="rbody">
        <div className="row">
          <span className="stack">{r.people.slice(0, 6).map((n) => <NameFace key={n} name={n} size={22} />)}</span>
          <span className="sub">{r.people.join('・')} · {span}</span>
        </div>
        {r.items.length > 0 && <div className="rtiles">{r.items.map((it) => <ItemTile key={it.id} kind={it.kind} summary={it.summary} image={it.image} />)}</div>}
        <div className="row wrap">
          {visible && (
            <button className="primary small" onClick={() => continueWith(r.session, target?.id)}>
              {target?.kind === 'chess' || target?.kind === 'chessAi' ? '盤面の続きをする' : '続きをする'}
            </button>
          )}
          {r.log.length > 0 && <button className="small" onClick={() => setLog(!log)}>{log ? 'ログを閉じる' : `ログを読む（${r.log.length} 件）`}</button>}
        </div>
        {log && (
          <div className="rlog">
            {r.log.map((l, i) => <div key={i}><b>{l.name}</b> <span className="sub">{timeLabel(l.at)}</span><div><Linkified text={l.text} /></div></div>)}
          </div>
        )}
      </div>
    </article>
  );
}

const WORLD_TINT: Record<string, string> = { room: '#DCE6F3', cafe: '#F3E6C6', game: '#E7DDF2' };

function PlanCard({ conv, m }: { conv: string; m: Message }) {
  const plan = m.plan!;
  const selfName = useStore((s) => s.selfName);
  const session = useStore((s) => s.guild.sessions.find((d) => d.id === plan.session));
  const mine = plan.answers[selfName];
  const count = (a: Rsvp) => Object.values(plan.answers).filter((x) => x === a).length;
  const yes = count('yes');
  return (
    <div className="plan">
      <div className="row">
        <Icon name="calendar" size={15} />
        <b>{timeLabel(plan.at)}{session ? ` · ${session.name}` : ''}</b>
        <span className="spacer" />
        {!plan.event && <span className="sub">{Math.max(0, PLAN_QUORUM - yes)} 人そろうとイベントに</span>}
      </div>
      <div className="planbtns" role="group" aria-label="返事">
        {RSVPS.map((a) => (
          <button key={a} className={mine === a ? 'on' : ''} aria-pressed={mine === a} onClick={() => answerPlan(conv, m.id, mine === a ? null : a)}>
            {RSVP_LABEL[a]} {count(a)}
          </button>
        ))}
      </div>
      {plan.event && <span className="sub ok">{PLAN_QUORUM} 人そろったので、イベントに追加しました</span>}
    </div>
  );
}

function InviteCard({ sid }: { sid: string }) {
  const s = useStore((st) => st.guild.sessions.find((d) => d.id === sid));
  const world = useStore((st) => st.worldBy[sid] ?? s?.world ?? 'room');
  const n = useStore((st) => st.users.filter((u) => u.session === sid).length);
  if (!s) return <div className="refcard"><span className="sub">（もう無いセッションへの誘い）</span></div>;
  return (
    <div className="refcard">
      <span className="refmark" style={{ background: WORLD_TINT[world] }}><Icon name="headset" size={16} /></span>
      <span className="finfo"><b>{s.name}</b><span className="sub">{WORLDS[world].name} · {n} 人</span></span>
      <button className="primary small" onClick={() => joinSession(sid)}>参加する</button>
    </div>
  );
}

function ItemRefCard({ item }: { item: NonNullable<Message['item']> }) {
  const s = useStore((st) => st.guild.sessions.find((d) => d.id === item.session));
  const live = useStore((st) => st.sessionInfo[item.session]?.items.some((i) => i.id === item.id));
  const info = ITEM_INFO[item.kind];
  return (
    <div className="refcard">
      <span className="refmark" style={{ background: info.tint, color: info.ink }}>{info.mark}</span>
      <span className="finfo"><b>{item.summary}</b><span className="sub">{s ? `${s.name} に置いてある` : '（もう無いセッション）'}{s && !live && '（片付けられました）'}</span></span>
      {s && live && <button className="small" onClick={() => continueWith(item.session, item.id)}>続きをする</button>}
    </div>
  );
}

export function MessageView({ conv, m }: { conv: string; m: Message }) {
  if (m.recap) return <div className="msg sys"><RecapCard r={m.recap} /></div>;
  return (
    <div className="msg">
      <NameFace name={m.from} size={32} />
      <div className="msgbody">
        <span className="mhead"><b>{m.from}</b><span className="sub">{timeLabel(m.at)}</span></span>
        {m.text && <p className="mtext"><Linkified text={m.text} /></p>}
        {m.voice && <audio className="mvoice" src={m.voice.url} controls preload="metadata" aria-label={`声のメッセージ ${m.voice.sec} 秒`} />}
        {m.media?.kind === 'image' && <ChatImage src={m.media.url} />}
        {m.media?.kind === 'video' && <video className="chatvideo" src={m.media.url} controls preload="metadata" playsInline />}
        {m.plan && <PlanCard conv={conv} m={m} />}
        {m.invite && <InviteCard sid={m.invite} />}
        {m.item && <ItemRefCard item={m.item} />}
      </div>
    </div>
  );
}

/** 会話。開いている間は読んだことにし、開いた時点の未読の頭に線を引く */
export function Thread({ conv, empty }: { conv: string; empty: string }) {
  const list = useStore((s) => s.inbox[conv]) ?? NONE;
  const selfName = useStore((s) => s.selfName);
  const [since] = useState(() => useStore.getState().reads[conv] ?? 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
    markRead(conv);
  }, [conv, list.length]);
  const firstUnread = list.find((m) => m.at > since && m.from !== selfName)?.id;
  return (
    <div className="thread" ref={ref}>
      {list.length === 0 && <p className="hempty">{empty}</p>}
      {list.map((m) => (
        <div key={m.id}>
          {m.id === firstUnread && since > 0 && <div className="unreadline"><span>ここから未読</span></div>}
          <MessageView conv={conv} m={m} />
        </div>
      ))}
    </div>
  );
}

function defaultPlanAt() {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(21, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function uploadVoice(blob: Blob) {
  try {
    const res = await fetch('/media', { method: 'POST', body: blob });
    const j = await res.json() as { url?: string };
    return res.ok && j.url ? j.url : null;
  } catch { return null; }
}

/** 押して録り始め、もう一度押すと送る。最長 60 秒 */
function useVoiceRecorder(onDone: (url: string, sec: number) => void) {
  const rec = useRef<{ r: MediaRecorder; started: number; timer: ReturnType<typeof setInterval> } | null>(null);
  const [sec, setSec] = useState<number | null>(null);
  const stop = () => rec.current?.r.state === 'recording' && rec.current.r.stop();
  const start = async () => {
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return; }
    const r = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : undefined);
    const chunks: Blob[] = [];
    const started = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSec(s);
      if (s >= VOICE_MAX_SEC) stop();
    }, 250);
    r.ondataavailable = (e) => chunks.push(e.data);
    r.onstop = async () => {
      clearInterval(timer);
      for (const t of stream.getTracks()) t.stop();
      rec.current = null;
      setSec(null);
      const total = Math.max(1, Math.round((Date.now() - started) / 1000));
      const url = await uploadVoice(new Blob(chunks, { type: 'audio/webm' }));
      if (url) onDone(url, total);
    };
    r.start();
    rec.current = { r, started, timer };
    setSec(0);
  };
  return { recording: sec !== null, sec: sec ?? 0, toggle: () => (rec.current ? stop() : void start()) };
}

export function Composer({ conv, placeholder, allowPlan, extra }: { conv: string; placeholder: string; allowPlan?: boolean; extra?: React.ReactNode }) {
  const sessions = useStore((s) => s.guild.sessions);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<{ at: string; session: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder((url, sec) => sendMessage(conv, { text: '', voice: { url, sec } }));
  const planAt = plan ? new Date(plan.at).getTime() : NaN;
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (plan) {
      if (!Number.isFinite(planAt)) return;
      sendMessage(conv, { text: text.trim(), plan: { at: planAt, session: plan.session || null } });
      setPlan(null);
    } else {
      if (!text.trim()) return;
      sendMessage(conv, { text });
    }
    setText('');
  };
  const attach = async (file: File | undefined) => {
    if (!file) return;
    const media = await uploadMedia(file);
    if (media) { sendMessage(conv, { text, media }); setText(''); }
  };
  return (
    <form className="mcomposer" onSubmit={submit}>
      {plan && (
        <div className="planform">
          <label className="hfield">日時<input type="datetime-local" value={plan.at} onChange={(e) => setPlan({ ...plan, at: e.target.value })} /></label>
          <label className="hfield">会場（任意）
            <select value={plan.session} onChange={(e) => setPlan({ ...plan, session: e.target.value })}>
              <option value="">なし</option>
              {sessions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <span className="sub wrap">{PLAN_QUORUM} 人が「来る」と答えるとイベントになります</span>
        </div>
      )}
      <div className="mbar">
        <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm" hidden onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }} />
        <label className="sr" htmlFor={`m-${conv}`}>メッセージ</label>
        <input
          id={`m-${conv}`} value={text} placeholder={voice.recording ? `録音中… ${voice.sec} 秒（もう一度押すと送信）` : plan ? '何の集まりか（例：土曜の対局）' : placeholder}
          disabled={voice.recording} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }}
        />
        {extra}
        {allowPlan && (
          <button type="button" className={`ib square ${plan ? 'on' : ''}`} aria-label="日程の相談をつける" aria-pressed={!!plan} title="日程の相談（来る／たぶん／むり）をつける" onClick={() => setPlan(plan ? null : { at: defaultPlanAt(), session: '' })}>
            <Icon name="calendar" size={17} />
          </button>
        )}
        <button type="button" className="ib square" aria-label="画像・動画を添付" onClick={() => fileRef.current?.click()}><Icon name="attach" size={17} /></button>
        <button type="button" className={`ib square ${voice.recording ? 'rec' : ''}`} aria-label={voice.recording ? '録音を止めて送る' : '声のメッセージを録る'} aria-pressed={voice.recording} onClick={voice.toggle}>
          <Icon name="mic" size={17} />
        </button>
        <button type="submit" className="primary square" aria-label="送信" disabled={voice.recording}><Icon name="send" size={17} /></button>
      </div>
    </form>
  );
}
