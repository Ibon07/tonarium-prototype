import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type http from 'node:http';
import { and, eq, lt } from 'drizzle-orm';
import { db } from './db/index.ts';
import { accounts, authSessions, loginPending } from './db/schema.ts';

export type AccountKind = 'misskey' | 'guest' | 'dev';
export interface Account { id: string; kind: AccountKind; username: string | null; name: string }

const SESSION_COOKIE = 'tonarium_session';
const PENDING_COOKIE = 'tonarium_login';
const DAY = 86_400_000;
const SESSION_TTL: Record<AccountKind, number> = { misskey: 90 * DAY, dev: 90 * DAY, guest: 365 * DAY };
const PENDING_TTL = 10 * 60_000;
/** 期限の延長で毎回 DB に書かないよう、残りがこれを切ったときだけ延ばす */
const EXTEND_BELOW = 30 * DAY;
/** Cookie 自体はブラウザの上限（400 日）まで持たせ、期限は DB の側で決める。使うたびに延ばす期限を Cookie にも合わせ直さずに済む */
const COOKIE_MAX_AGE = 400 * DAY;
/** ゲストを作れるのは 1 つの接続元から 10 分に 20 人まで（DB を際限なく増やさせない） */
const GUEST_RATE = { max: 20, windowMs: 10 * 60_000 };

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export function normalizeName(name: string) {
  return name.trim().slice(0, 24) || 'ゲスト';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** 前段（Coolify）が付ける X-Forwarded-* を優先して、ブラウザから見た自分のオリジンを返す */
export function requestOrigin(req: http.IncomingMessage) {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0].trim();
  return /^[\w.:[\]-]+$/.test(host) ? `${proto === 'https' ? 'https' : 'http'}://${host}` : '';
}

function sameOrigin(req: http.IncomingMessage) {
  // fetch は同じオリジンでも Origin を付ける。付いていなければブラウザ以外なので、Cookie のセッションには使わせない
  const origin = req.headers.origin;
  return !!origin && origin === requestOrigin(req);
}

function cookie(req: http.IncomingMessage, name: string, value: string, maxAgeMs: number) {
  const secure = requestOrigin(req).startsWith('https:') ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

async function readJson(req: http.IncomingMessage, max = 4096): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

function json(res: http.ServerResponse, status: number, body: unknown, cookies: string[] = []) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(JSON.stringify(body));
}

interface MiAuthUser { id: string; username: string; name: string | null }

export interface AuthOptions {
  /** ログインに使う Misskey のオリジン（例: https://misskey.resonite.love）。テストでは手元の偽物を指す */
  misskeyOrigin: string;
  /** 開発とテストだけ。名前だけでログイン扱いのアカウントを作れる */
  devLogin: boolean;
  /** 表示名が変わったら、つないでいる画面へ知らせる */
  onRenamed: (account: Account) => void;
}

async function checkMiAuth(origin: string, session: string): Promise<MiAuthUser | null> {
  const res = await fetch(`${origin}/api/miauth/${encodeURIComponent(session)}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const body = await res.json() as { ok?: boolean; user?: { id?: unknown; username?: unknown; name?: unknown } };
  const u = body.user;
  if (!body.ok || !u || typeof u.id !== 'string' || typeof u.username !== 'string') return null;
  return { id: u.id, username: u.username, name: typeof u.name === 'string' ? u.name : null };
}

const toAccount = (r: typeof accounts.$inferSelect): Account => ({ id: r.id, kind: r.kind, username: r.username, name: r.displayName });

/**
 * ログインとゲスト。Cookie（HttpOnly）のセッションで本人を決める。
 * Misskey のトークンは本人確認のあと捨て、Misskey の API は呼ばない
 */
export class Auth {
  readonly misskeyHost: string;
  private readonly guestsBy = new Map<string, number[]>();
  constructor(private readonly o: AuthOptions) {
    this.misskeyHost = new URL(o.misskeyOrigin).host;
  }

  /**
   * リクエストの本人。セッションが無い・切れていれば null。
   * 開発時は X-Tonarium-Session（WebSocket は ?session=）を Cookie より先に読む。同じブラウザの別のタブで別人として入るため
   */
  async accountOf(req: http.IncomingMessage, query?: URLSearchParams): Promise<Account | null> {
    const dev = this.o.devLogin ? (req.headers['x-tonarium-session'] as string | undefined) ?? query?.get('session') ?? undefined : undefined;
    const token = dev ?? parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const rows = await db().select().from(authSessions).innerJoin(accounts, eq(authSessions.accountId, accounts.id))
      .where(eq(authSessions.tokenHash, hash(token))).limit(1);
    const row = rows[0];
    if (!row) return null;
    const now = Date.now();
    if (row.auth_sessions.expiresAt.getTime() <= now) return null;
    if (row.auth_sessions.expiresAt.getTime() - now < EXTEND_BELOW) {
      await db().update(authSessions).set({ expiresAt: new Date(now + SESSION_TTL[row.accounts.kind]) }).where(eq(authSessions.tokenHash, hash(token)));
    }
    return toAccount(row.accounts);
  }

  async touch(accountId: string) {
    await db().update(accounts).set({ lastSeenAt: new Date() }).where(eq(accounts.id, accountId));
  }

  async rename(account: Account, name: string): Promise<Account> {
    const next = normalizeName(name);
    await db().update(accounts).set({ displayName: next }).where(eq(accounts.id, account.id));
    const renamed = { ...account, name: next };
    this.o.onRenamed(renamed);
    return renamed;
  }

  /** 期限切れのセッションとログイン途中を消す */
  async sweep() {
    const now = new Date();
    for (const [ip, times] of this.guestsBy) if (times.every((t) => now.getTime() - t >= GUEST_RATE.windowMs)) this.guestsBy.delete(ip);
    await db().delete(authSessions).where(lt(authSessions.expiresAt, now));
    await db().delete(loginPending).where(lt(loginPending.expiresAt, now));
  }

  private async startSession(req: http.IncomingMessage, account: Account) {
    const token = newToken();
    const ttl = SESSION_TTL[account.kind];
    await db().insert(authSessions).values({ tokenHash: hash(token), accountId: account.id, expiresAt: new Date(Date.now() + ttl) });
    return { token, cookie: cookie(req, SESSION_COOKIE, token, COOKIE_MAX_AGE) };
  }

  /** MiAuth の結果をアカウントに結び付ける。表示名は初回だけ Misskey の名前にし、その後は Tonarium で変えたものを残す */
  private async completeMiAuth(session: string): Promise<Account | null> {
    const user = await checkMiAuth(this.o.misskeyOrigin, session);
    if (!user) return null;
    const [row] = await db().insert(accounts)
      .values({ kind: 'misskey', misskeyId: user.id, username: user.username, displayName: normalizeName(user.name || user.username) })
      .onConflictDoUpdate({ target: accounts.misskeyId, set: { username: user.username } })
      .returning();
    const account = toAccount(row);
    await db().update(loginPending).set({ accountId: account.id }).where(eq(loginPending.session, session));
    return account;
  }

  /** /auth/* を扱ったら true */
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/auth/')) return false;
    const route = `${req.method} ${url.pathname}`;
    // コールバックは Misskey からのリダイレクトなので Origin が付かない。ほかは同じオリジンの fetch だけ受ける
    if (req.method === 'POST' && !sameOrigin(req)) { json(res, 403, { error: 'origin' }); return true; }
    try {
      switch (route) {
        case 'GET /auth/me': {
          const account = await this.accountOf(req, url.searchParams);
          json(res, 200, { account, misskeyHost: this.misskeyHost, devLogin: this.o.devLogin });
          return true;
        }
        case 'POST /auth/guest': {
          const body = await readJson(req);
          const name = normalizeName(typeof body?.name === 'string' ? body.name : '');
          // 同じ端末のゲストは同じアカウントのまま（アイコンとアバターを残すため）
          const current = await this.accountOf(req, url.searchParams);
          if (current?.kind === 'guest') {
            json(res, 200, { account: current.name === name ? current : await this.rename(current, name) });
            return true;
          }
          if (!this.allowGuest(req)) { json(res, 429, {}); return true; }
          const [row] = await db().insert(accounts).values({ kind: 'guest', displayName: name }).returning();
          const account = toAccount(row);
          const s = await this.startSession(req, account);
          json(res, 200, { account, session: this.o.devLogin ? s.token : undefined }, [s.cookie]);
          return true;
        }
        case 'POST /auth/dev': {
          if (!this.o.devLogin) { json(res, 404, {}); return true; }
          const body = await readJson(req);
          const name = normalizeName(typeof body?.name === 'string' ? body.name : '');
          const found = await db().select().from(accounts).where(and(eq(accounts.kind, 'dev'), eq(accounts.username, name))).limit(1);
          const row = found[0] ?? (await db().insert(accounts).values({ kind: 'dev', username: name, displayName: name }).returning())[0];
          const account = toAccount(row);
          // Cookie は付けない。付けると同じブラウザのほかのタブまでこの人になる
          const s = await this.startSession(req, account);
          json(res, 200, { account, session: s.token });
          return true;
        }
        case 'POST /auth/miauth/start': {
          const session = randomUUID();
          const poll = newToken();
          await db().insert(loginPending).values({ session, pollHash: hash(poll), expiresAt: new Date(Date.now() + PENDING_TTL) });
          const origin = requestOrigin(req);
          const q = new URLSearchParams({ name: 'Tonarium', icon: `${origin}/brand/mark.png`, callback: `${origin}/auth/miauth/callback` });
          json(res, 200, { url: `${this.o.misskeyOrigin}/miauth/${session}?${q}` }, [cookie(req, PENDING_COOKIE, poll, PENDING_TTL)]);
          return true;
        }
        case 'GET /auth/miauth/callback': {
          const session = url.searchParams.get('session') ?? '';
          const pending = await this.pendingBySession(session);
          if (!pending) { this.page(res, 400, 'ログインの手続きが見つからないか、期限が切れました。もう一度お試しください。', 'The sign-in request was not found or has expired. Please try again.', '로그인 요청을 찾을 수 없거나 만료되었습니다. 다시 시도해 주세요.'); return true; }
          const account = pending.accountId ? await this.accountById(pending.accountId) : await this.completeMiAuth(session);
          if (!account) { this.page(res, 400, 'Misskey で許可されませんでした。もう一度お試しください。', 'Misskey did not grant access. Please try again.', 'Misskey에서 허용되지 않았습니다. 다시 시도해 주세요.'); return true; }
          // ログインを始めたブラウザならそのまま入れる。Electron から始めた（別のブラウザで開いた）ならアプリへ戻ってもらう
          const poll = parseCookies(req.headers.cookie)[PENDING_COOKIE];
          if (poll && hash(poll) === pending.pollHash) {
            const s = await this.startSession(req, account);
            await db().delete(loginPending).where(eq(loginPending.session, session));
            res.statusCode = 302;
            res.setHeader('Set-Cookie', [s.cookie, cookie(req, PENDING_COOKIE, '', 0)]);
            res.setHeader('Location', '/');
            res.end();
            return true;
          }
          this.page(res, 200, 'ログインしました。Tonarium のアプリに戻ってください。', 'Signed in. Please return to the Tonarium app.', '로그인했습니다. Tonarium 앱으로 돌아가 주세요.');
          return true;
        }
        case 'POST /auth/miauth/poll': {
          const poll = parseCookies(req.headers.cookie)[PENDING_COOKIE];
          const pending = poll ? (await db().select().from(loginPending).where(eq(loginPending.pollHash, hash(poll))).limit(1))[0] : undefined;
          if (!pending || pending.expiresAt.getTime() <= Date.now()) { json(res, 200, { status: 'expired' }, [cookie(req, PENDING_COOKIE, '', 0)]); return true; }
          // コールバックが届かない場合（Misskey 側で戻り先を開かなかったなど）に備えて、こちらからも確かめる
          const account = pending.accountId ? await this.accountById(pending.accountId) : await this.completeMiAuth(pending.session);
          if (!account) { json(res, 200, { status: 'pending' }); return true; }
          const s = await this.startSession(req, account);
          await db().delete(loginPending).where(eq(loginPending.session, pending.session));
          json(res, 200, { status: 'done', account }, [s.cookie, cookie(req, PENDING_COOKIE, '', 0)]);
          return true;
        }
        case 'POST /auth/name': {
          const account = await this.accountOf(req, url.searchParams);
          if (!account) { json(res, 401, {}); return true; }
          const body = await readJson(req);
          if (typeof body?.name !== 'string') { json(res, 400, {}); return true; }
          json(res, 200, { account: await this.rename(account, body.name) });
          return true;
        }
        case 'POST /auth/logout': {
          const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? (this.o.devLogin ? req.headers['x-tonarium-session'] as string | undefined : undefined);
          if (token) await db().delete(authSessions).where(eq(authSessions.tokenHash, hash(token)));
          json(res, 200, {}, [cookie(req, SESSION_COOKIE, '', 0)]);
          return true;
        }
      }
      json(res, 404, {});
      return true;
    } catch (e) {
      console.error('auth', route, e);
      json(res, 500, {});
      return true;
    }
  }

  private allowGuest(req: http.IncomingMessage) {
    // 前段（Coolify）を通ると接続元は前段になるので、付けてくれる X-Forwarded-For の先頭を使う
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    const now = Date.now();
    const recent = (this.guestsBy.get(ip) ?? []).filter((t) => now - t < GUEST_RATE.windowMs);
    if (recent.length >= GUEST_RATE.max) return false;
    recent.push(now);
    this.guestsBy.set(ip, recent);
    return true;
  }

  private async pendingBySession(session: string) {
    if (!/^[0-9a-f-]{36}$/.test(session)) return null;
    const row = (await db().select().from(loginPending).where(eq(loginPending.session, session)).limit(1))[0];
    return row && row.expiresAt.getTime() > Date.now() ? row : null;
  }

  private async accountById(id: string) {
    const row = (await db().select().from(accounts).where(eq(accounts.id, id)).limit(1))[0];
    return row ? toAccount(row) : null;
  }

  /** Misskey から戻ってきたときの小さな案内ページ。画面の言語が分からないので 3 言語とも出す */
  private page(res: http.ServerResponse, status: number, ja: string, en: string, ko: string) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    res.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tonarium</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#EAE5DB;color:#26262E;font-family:sans-serif;text-align:center;padding:16px;box-sizing:border-box}p{line-height:1.7}a{color:#2F5FC4}</style></head>
<body><div><img src="/brand/mark.png" alt="" width="56" height="56"><p>${esc(ja)}<br>${esc(en)}<br>${esc(ko)}</p><p><a href="/">Tonarium</a></p></div></body></html>`);
  }
}
