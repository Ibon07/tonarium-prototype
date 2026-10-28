# 保存の仕組み

`data/` の JSON とファイルから、PostgreSQL（データ）と S3 互換のストレージ（画像・動画）へ移している途中。移し終えるまでの段取りは次のとおりで、`feature/storage-auth` にまとめてから `develop` へ入れる。

1. DB とストレージの土台（この文書の内容。入っている）
2. Misskey（misskey.resonite.love）でのログインとゲスト（[login.md](login.md)。入っている）
3. 人を名前ではなくアカウント ID で持つ（3a。入っている）。人とホームのデータを DB へ移す（3b。入っている）。残り（タイムライン・アイテム・ゲームの進み具合・いいね・通報）を DB へ移す（3c）
4. 画像・動画をストレージへ移す

## 人はアカウント ID で持つ

- フォロー・DM の会話キー（`dm:<ID>:<ID>`）・既読・グループ（作った人・編集者・メンバー）・イベント（主催・参加表明）・作ったセッション（作った人・誘われた人）・タイムライン（作者・リアクション・リポスト）・ステータスと「来たら知らせる」・セッションのまとめ（いた人）・アイコン/アバター/自己紹介のファイル名は、すべてアカウント ID
- 表示名とアイコンの版は、サーバーが送る名簿（`directory`。ログインした人の全員）とオンラインの `users` から引く。画面の `nameOf(id)`（`client/src/store.ts`）と `PersonFace` / `PersonName`（`client/src/home/common.tsx`）を使う。名前やアイコンが変わると、名簿の 1 人分が全員へ届く
- アイコン・アバター・自己紹介の取得は `/icon?id=`・`/avatar?id=`・`/avatar/params?id=`・`/profile?id=`
- 手元に覚えるブロック・個別の音量とミュートも ID（localStorage の `tonarium.blockedIds`・`tonarium.peerVolumeById`・`tonarium.peerMutedIds`。名前で覚えていた頃のものは読まない）
- 通信の約束事が変わったので `COMPAT_VERSION` を 8 に上げた
- 名前で持っていた頃のデータは引き継がない。最初の起動で、人に結び付く `data/*.json` とアイコンなどのフォルダを `data/archive-<日時>/` へ移し、印のファイル `data/.ids-v1` を置く（`server/index.ts` の `archiveNameKeyedData`）。`media/`・共有アセット/システム・翻訳はそのまま。サーバーを立てる前に ID 入りのデータを置くテストは、`server/test-db.ts` の `seedDevAccounts` でアカウントを作り、`markIdData` で印を置く

## DB に入っているもの

| 表 | 中身 |
|---|---|
| `accounts`・`auth_sessions`・`login_pending` | ログイン（[login.md](login.md)） |
| `profiles` | アカウント ID ごとの自己紹介・ステータス・ひとこと・最近のひとこと・最後にいなくなった時刻 |
| `watches` | 来たら知らせる（待つ人 → 待たれる人） |
| `follows` | フォロー（向き付き） |
| `user_sessions`・`session_renames` | 画面から作ったセッションと、`sessions.json` のセッションの名前の変更 |
| `groups`・`events` | グループ（チャンネルは jsonb）とイベント |
| `messages`・`message_reads` | DM とチャンネルのメッセージ（中身は jsonb）と既読 |

## 書き方

- サーバーは今までどおり、起動時に全部読んでメモリに持ち、メモリ側を正とする（`server/db/home-store.ts` の `loadPeopleAndHome`）。ハンドラーはメモリだけを読み書きする
- 変わったら DB へ書く。作ったセッション・グループ・イベント・プロフィール・フォローは、続けて変わっても 800 ミリ秒に 1 回へまとめ、その表を丸ごと 1 つのトランザクションで書き直す（行数は人数ぶん程度なので差分を追わない）。メッセージと既読は、変わった会話・人の分だけ書き直す
- 書き込みは `server/db/persist.ts` の 1 本の列に並べて順に流す。失敗はログに出して次へ進み、5 秒おいて同じ分を書き直す（成功するまで続ける）。終了時（SIGINT/SIGTERM）は、まとめ待ちの分も積んでから、列が空になるのを待って閉じる。強制終了されると、まとめ待ちの 800 ミリ秒分は失われることがある（書き終えた分はトランザクションで守られる）
- PostgreSQL の文字列と jsonb は NUL を入れられないので、書く前に取り除く（1 つでも混ざると同じトランザクションの書き込みが全部失敗するため）。DM の会話キーも NUL ではなく `:` で区切る

## PostgreSQL

- 接続先は `DATABASE_URL`。サーバーは起動時につなぎ、`drizzle/` のマイグレーションのうちまだ流していないものを流してから待ち受けを始める。つながらない・流せないときは理由を出して止まる（`server/index.ts` の末尾、`server/db/index.ts`）
- テーブルは `server/db/schema.ts`（Drizzle ORM）。中身は上の「DB に入っているもの」
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
- `npm run test:integration`（ログイン・ID・再起動しても DB から戻るか・空のセッションの片付け・グループ・セッションのリンク・翻訳）と `npm run test:storage`（`S3_TEST_ENDPOINT=http://localhost:8333` を付けると SeaweedFS でも試す）
