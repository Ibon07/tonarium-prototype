import { db } from './index.ts';
import { stripNul } from './persist.ts';
import { accountImages } from './schema.ts';

export interface AccountImages { icon: string | null; avatarImage: string | null; avatarParams: unknown; avatarVersion: string | null }

export async function loadAccountImages() {
  const rows = await db().select().from(accountImages);
  return new Map(rows.map(({ accountId, ...rest }) => [accountId, rest as AccountImages]));
}

export async function saveAccountImages(accountId: string, rec: AccountImages) {
  const row = stripNul(rec);
  await db().insert(accountImages).values({ accountId, ...row }).onConflictDoUpdate({ target: accountImages.accountId, set: row });
}
