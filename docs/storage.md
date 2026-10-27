# 保存の仕組み

`data/` の JSON とファイルから、PostgreSQL（データ）と S3 互換のストレージ（画像・動画）へ移している途中。移し終えるまでの段取りは次のとおりで、`feature/storage-auth` にまとめてから `develop` へ入れる。

1. DB とストレージの土台（この文書の内容。入っている）
2. Misskey（misskey.resonite.love）でのログインとゲスト（[login.md](login.md)。入っている）
3. ユーザーのデータを DB へ移し、名前ではなくアカウント ID で持つ（今の `data/*.json` は引き継がない）
4. 画像・動画をストレージへ移す

## PostgreSQL

- 接続先は `DATABASE_URL`。サーバーは起動時につなぎ、`drizzle/` のマイグレーションのうちまだ流していないものを流してから待ち受けを始める。つながらない・流せないときは理由を出して止まる（`server/index.ts` の末尾、`server/db/index.ts`）
- テーブルは `server/db/schema.ts`（Drizzle ORM）。いまはログイン用の `accounts`・`auth_sessions`・`login_pending` だけ
- テーブルを変えるときは `schema.ts` を直し、`npm run db:generate` で `drizzle/` に SQL を作って一緒にコミットする。作った SQL とメタデータは手で直さない
- 手元：`npm run services` で `docker-compose.dev.yml` の PostgreSQL が立つ（ユーザー・パスワードとも `tonarium`、ポート 5432）。DB は `tonarium` と、dev-isolated 用の `tonarium_isolated`。中を見るときは `docker compose -f docker-compose.dev.yml exec postgres psql -U tonarium -d tonarium`。消して作り直すときは `npm run services:stop` のあと、ボリューム `tonarium-prototype_tonarium-dev-db` を消す
- 本番：`docker-compose.yml` の `postgres` サービス（ボリューム `tonarium-db`）。`db-backup` が 1 日 1 回 R2 へ `pg_dump` を送る。準備と戻し方は [deploy.md](deploy.md)

## ストレージ（S3 互換）

- `server/storage.ts` の `openStorage` が環境変数で置き場を決める。`S3_ENDPOINT` があれば S3（本番は Cloudflare R2、手元は `npm run services` の SeaweedFS）、無ければ `DATA_DIR/objects` に書く（テスト用）
- 口は `put(キー, 中身, 種類)`・`delete(キー)`・`url(キー)` の 3 つ。キーは推測できない ID で作る前提で、英小文字・数字・`-` と `/` 区切り、拡張子付きのものだけ受け付ける（ストレージの外を指すキーを作らせないため）
- 中身ごとにキーを変えるので、書くときに `Cache-Control: public, max-age=31536000, immutable` を付ける。ブラウザは `url()` の URL（R2 の公開ドメイン）から直接読む
- 手元の SeaweedFS は認証の設定を置いていないので、だれでも読み書きできる。`S3_CREATE_BUCKET=1` のとき起動時にバケットを作る。本番の R2 はバケットを先に作っておく
- まだ誰も使っていない。画像・動画を移すときに使い始める

## テスト

- サーバーを起動する integration test は、`server/test-db.ts` の `testServerEnv(t)` でテストごとに `tonarium_test_<乱数>` という DB を作り、終わったら消す。`.env` の `DATABASE_URL` と `S3_*` は引き継がない（開発用のデータに書き込まないため）
- 使い捨ての DB を作る管理用の接続先は `TEST_DATABASE_URL`（既定は開発用の PostgreSQL）。CI（Web checks）は `services` で PostgreSQL を立ててそこを使う
- `npm run test:integration`（空のセッションの片付け・グループ・セッションのリンク・翻訳）と `npm run test:storage`（`S3_TEST_ENDPOINT=http://localhost:8333` を付けると SeaweedFS でも試す）
