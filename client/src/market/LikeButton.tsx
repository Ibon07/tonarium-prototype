import { useEffect, useState } from 'react';
import { useStore } from '../store.ts';
import { send } from '../net/ws.ts';

export function LikeButton({ product }: { product: string }) {
  const likes = useStore((s) => s.marketLikes);
  const connected = useStore((s) => s.wsConnected);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const liked = !!likes?.liked.includes(product);
  useEffect(() => { if (liked) { setPending(false); setError(false); } }, [liked]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => { setPending(false); setError(true); }, 5000);
    return () => clearTimeout(timer);
  }, [pending]);
  return <div className="market-like-wrap"><button className={`market-like ${liked ? 'liked' : ''}`} aria-pressed={liked} disabled={!connected || !likes || liked || pending} aria-busy={pending} title={liked ? 'この商品にいいねしています' : !connected ? '接続後にいいねできます' : '1ユーザーにつき1回いいねできます'} onClick={() => { setPending(true); setError(false); send({ t: 'marketLike', product }); }}><span aria-hidden="true">⭐</span>いいね<b>{likes ? (likes.counts[product] ?? 0).toLocaleString() : '…'}</b></button>{error && !liked && <small role="status">反映を確認できません。もう一度お試しください。</small>}</div>;
}
