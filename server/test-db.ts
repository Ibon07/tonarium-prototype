import { randomBytes } from 'node:crypto';
import type { TestContext } from 'node:test';
import postgres from 'postgres';

/** 使い捨て DB を作るための管理用接続。手元は npm run services の Postgres、CI は services の Postgres */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://tonarium:tonarium@localhost:5432/tonarium';

/**
 * テストごとに空の DB を作り、終わったら消す。起動するサーバーの env に混ぜて使う。
 * .env の DATABASE_URL や S3_* を引き継ぐと開発用のデータに書き込んでしまうので、ここで上書きする
 */
export async function testServerEnv(t: TestContext): Promise<Record<string, string>> {
  const name = `tonarium_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try { await admin.unsafe(`CREATE DATABASE ${name}`); }
  catch (e) { throw new Error(`テスト用の DB を作れませんでした（${ADMIN_URL.replace(/:[^:@/]*@/, ':***@')}）。npm run services で PostgreSQL を起動してください: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`); }
  finally { await admin.end(); }
  t.after(async () => {
    const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    // サーバーの終了を待たずに消せるよう、残った接続は切る
    try { await sql.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); }
    finally { await sql.end(); }
  });
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  // 開発用ログイン（名前だけで入れる）を開けて、テストから本人を作れるようにする
  return { DATABASE_URL: url.toString(), S3_ENDPOINT: '', AUTH_DEV_LOGIN: '1' };
}
