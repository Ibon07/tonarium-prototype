import { lookup } from 'node:dns/promises';
import net from 'node:net';

export interface Ogp { url: string; title: string; description: string; image: string | null; site: string }

const cache = new Map<string, { at: number; ogp: Ogp | null }>();
const TTL = 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024;

/** サーバーから内部ネットワークを覗けないよう、ローカル・プライベートなアドレスには取りに行かない */
function isPrivate(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function safeUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) return null;
  return u;
}

const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

function meta(html: string, key: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (name !== key) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decode(content.trim());
  }
  return '';
}

async function fetchOgp(raw: string): Promise<Ogp | null> {
  let u = await safeUrl(raw);
  // リダイレクト先も毎回確かめる
  for (let hop = 0; u && hop < 4; hop++) {
    const res = await fetch(u, {
      redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TonariumBot/0.1)', accept: 'text/html' },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      u = next ? await safeUrl(new URL(next, u).toString()) : null;
      continue;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html') || !res.body) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(c);
      size += c.length;
      if (size > MAX_BYTES) break;
    }
    const html = Buffer.concat(chunks).toString('utf-8');
    const head = html.slice(0, html.search(/<\/head>/i) + 7 || html.length);
    const title = meta(head, 'og:title') || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1]?.trim() ?? '');
    if (!title) return null;
    const image = meta(head, 'og:image') || meta(head, 'twitter:image');
    let imageUrl: string | null = null;
    try { imageUrl = image ? new URL(image, u).toString() : null; } catch { /* 壊れた URL は出さない */ }
    if (imageUrl && !/^https?:/.test(imageUrl)) imageUrl = null;
    return {
      url: u.toString(),
      title: title.slice(0, 200),
      description: (meta(head, 'og:description') || meta(head, 'description')).slice(0, 300),
      image: imageUrl,
      site: (meta(head, 'og:site_name') || u.hostname).slice(0, 80),
    };
  }
  return null;
}

export async function getOgp(raw: string) {
  const hit = cache.get(raw);
  if (hit && Date.now() - hit.at < TTL) return hit.ogp;
  const ogp = await fetchOgp(raw).catch(() => null);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(raw, { at: Date.now(), ogp });
  return ogp;
}
