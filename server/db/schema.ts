import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

/** MiAuth の途中。ログインを始めた端末だけが結果を受け取れるよう、ポーリング用の秘密をハッシュで持つ */
export const loginPending = pgTable('login_pending', {
  session: uuid('session').primaryKey(),
  pollHash: text('poll_hash').notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: at('expires_at').notNull(),
});
