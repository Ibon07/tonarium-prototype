import { useEffect, useState } from 'react';
import { iconUrl, pickIcon } from './icon.ts';
import { avatarTextureUrl, uploadAvatarImage, uploadAvatarManifest } from './avatar.ts';
import { send } from './net/ws.ts';
import { useStore } from './store.ts';
import { setLoadScale } from './actions.ts';

const LOAD_SCALES = [0, 0.5, 1, 2, 3];

const OEKAKI_SITE = 'https://oekaki-avatar.anthrotech.dev/';

/** 名前ごとに保存されるアイコンと 3D アバターの設定 */
export function ProfileDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const n = name.trim();
  const [icon, setIcon] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [bio, setBio] = useState('');
  const loadScale = useStore((s) => s.loadScale);
  useEffect(() => {
    let alive = true;
    void fetch(`/profile?name=${encodeURIComponent(n)}`).then((r) => r.json()).then((p: { bio: string }) => { if (alive) setBio(p.bio); });
    void fetch(iconUrl(n)).then((r) => { if (alive && r.ok) setIcon(iconUrl(n)); });
    void fetch(`/avatar?name=${encodeURIComponent(n)}&t=${Date.now()}`).then((r) => {
      if (alive && r.ok) setAvatar(String(Date.now()));
    });
    return () => { alive = false; };
  }, [n]);
  const saveBio = async () => {
    const r = await fetch(`/profile?name=${encodeURIComponent(n)}`, { method: 'POST', body: JSON.stringify({ bio }) });
    if (r.ok) send({ t: 'profileUpdated' });
    setMessage(r.ok ? '自己紹介を保存しました' : '自己紹介を保存できませんでした');
  };
  const run = async (f: () => Promise<string | null>, ok: (v: string) => void, label: string) => {
    const v = await f();
    if (v) { ok(v); setMessage(`${label}を保存しました`); } else setMessage(`${label}を保存できませんでした`);
  };

  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal profile" onClick={(e) => e.stopPropagation()}>
        <h2>{n} のプロフィール</h2>
        <div className="sub">名前ごとにサーバーへ保存され、同じ名前で入ると使われます</div>
        <section>
          <h3>自己紹介</h3>
          <textarea className="biofield" value={bio} maxLength={300} onChange={(e) => setBio(e.target.value)} placeholder="プロフィールに表示されます" aria-label="自己紹介" />
          <div className="row end"><button onClick={() => void saveBio()}>自己紹介を保存</button></div>
        </section>
        <section>
          <h3>アイコン（2D）</h3>
          <div className="row">
            {icon ? <img className="av big" src={icon} alt="" /> : <div className="av big noicon">{n.slice(0, 1)}</div>}
            <button onClick={() => void run(() => pickIcon(n), (v) => setIcon(iconUrl(n, v)), 'アイコン')}>画像を選ぶ</button>
          </div>
        </section>
        <section>
          <h3>3D アバター（お絵描きアバター）</h3>
          <img className="avatartex" src={avatarTextureUrl(n, avatar)} alt="" />
          {!avatar && <div className="sub">未設定の間は、名前から決まるサンプルが使われます</div>}
          <div className="row wrap">
            <button className="primary" onClick={() => void run(() => uploadAvatarImage(n), setAvatar, 'アバター画像')}>画像を選ぶ</button>
            <button onClick={() => void run(() => uploadAvatarManifest(n), setAvatar, '調整値')}>manifest.json を選ぶ（任意）</button>
            <a className="btnlink" href="/oekaki/template.png" download="oekaki-template.png">テンプレートをダウンロード</a>
            <a className="btnlink" href={OEKAKI_SITE} target="_blank" rel="noreferrer">oekaki-avatar で描く ↗</a>
          </div>
          <div className="sub">テンプレート（2048×1024）に描いた画像を 1 枚アップロードします。oekaki-avatar で書き出した zip の texture.png と manifest.json も使えます</div>
        </section>
        <section>
          <h3>2D / 3D 切り替えの読み込み時間</h3>
          <div className="seg" role="radiogroup" aria-label="読み込み時間の倍率">
            {LOAD_SCALES.map((k) => (
              <button key={k} role="radio" aria-checked={loadScale === k} className={loadScale === k ? 'on' : 'ib'} onClick={() => setLoadScale(k)}>
                {k === 0 ? 'なし' : `×${k}`}
              </button>
            ))}
          </div>
          <div className="sub">標準（×1）で 1〜2 秒。この端末にだけ保存されます</div>
        </section>
        {message && <div className="msgline">{message}</div>}
        <div className="row end"><button onClick={onClose}>閉じる</button></div>
      </div>
    </div>
  );
}
