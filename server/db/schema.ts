import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true });

/** ログインした人（misskey）・端末ごとのゲスト・開発用（dev、ログイン扱い） */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: ['misskey', 'guest', 'dev'] }).notNull(),
  misskeyId: text('misskey_id').unique(),
  username: text('username'),
  displayName: text('display_name').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
  lastSeenAt: at('last_seen_at').notNull().defaultNow(),
});

/** Cookie のセッション。漏れても使えないようトークンはハッシュで持つ */
export const authSessions = pgTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: at('expires_at').notNull(),
}, (t) => [index('auth_sessions_account_idx').on(t.accountId)]);

/**
 * MiAuth の途中。ログインを始めた端末だけが結果を受け取れるよう、ポーリング用の秘密をハッシュで持つ。
 * 別のブラウザで許可したときは、始めた画面に出した確認コードが入力されるまでアカウントを結び付けない
 */
export const loginPending = pgTable('login_pending', {
  session: uuid('session').primaryKey(),
  pollHash: text('poll_hash').notNull(),
  // 導入前から残っている途中のログインは空になり、どのコードとも一致しない（確認できずに期限で消える）
  codeHash: text('code_hash').notNull().default(''),
  codeAttempts: integer('code_attempts').notNull().default(0),
  /** Misskey で許可された人。確認が済むまでは accountId に結び付けない */
  misskeyUser: jsonb('misskey_user').$type<{ id: string; username: string; name: string | null }>(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: at('expires_at').notNull(),
});

const ms = (name: string) => bigint(name, { mode: 'number' });
const ids = (name: string) => uuid(name).array().notNull().default(sql`'{}'::uuid[]`);

/** 人ごとの自己紹介とステータス。アイコンとアバターはファイル（あとでストレージへ） */
export const profiles = pgTable('profiles', {
  accountId: uuid('account_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  bio: text('bio').notNull().default(''),
  status: text('status').notNull().default('online'),
  statusText: text('status_text').notNull().default(''),
  recent: jsonb('recent').$type<string[]>().notNull().default([]),
  lastSeen: ms('last_seen'),
});

/** 「来たら知らせる」。target が来たら watcher に知らせて消える */
export const watches = pgTable('watches', {
  watcher: uuid('watcher').notNull(),
  target: uuid('target').notNull(),
}, (t) => [primaryKey({ columns: [t.watcher, t.target] })]);

/** フォロー（向き付き）。お互いにフォローしているとフレンド */
export const follows = pgTable('follows', {
  follower: uuid('follower').notNull(),
  followee: uuid('followee').notNull(),
}, (t) => [primaryKey({ columns: [t.follower, t.followee] })]);

/** 画面から作ったセッション。sessions.json のものは入らない。ord は並び順 */
export const userSessions = pgTable('user_sessions', {
  id: text('id').primaryKey(),
  ord: integer('ord').notNull(),
  name: text('name').notNull(),
  topic: text('topic'),
  world: text('world'),
  visibility: text('visibility'),
  owner: uuid('owner'),
  groupId: text('group_id'),
  invited: ids('invited'),
});

/** sessions.json のセッションを画面から改名したときの名前（sessions.json は書き換えない） */
export const sessionRenames = pgTable('session_renames', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  ord: integer('ord').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  owner: uuid('owner').notNull(),
  imageVersion: integer('image_version'),
  editors: ids('editors'),
  members: ids('members'),
  channels: jsonb('channels').$type<{ id: string; name: string }[]>().notNull(),
});

export const events = pgTable('events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  at: ms('at').notNull(),
  groupId: text('group_id'),
  sessionId: text('session_id'),
  owner: uuid('owner').notNull(),
  attendees: ids('attendees'),
  maybe: ids('maybe'),
  declined: ids('declined'),
});

/** DM とグループのチャンネルのメッセージ。中身（Message）は形が多いので jsonb のまま持つ */
export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  conv: text('conv').notNull(),
  at: ms('at').notNull(),
  data: jsonb('data').notNull(),
}, (t) => [index('messages_conv_at_idx').on(t.conv, t.at)]);

export const messageReads = pgTable('message_reads', {
  accountId: uuid('account_id').notNull(),
  conv: text('conv').notNull(),
  at: ms('at').notNull(),
}, (t) => [primaryKey({ columns: [t.accountId, t.conv] })]);
