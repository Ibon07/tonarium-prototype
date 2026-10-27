# ログインとゲスト

入口で「Misskey でログイン」か「ゲストで入る」を選ぶ。本人はサーバーが Cookie のセッションで決め、画面から名乗った名前や ID は信じない。部品はサーバーが `server/auth.ts`、画面が `client/src/auth.ts` と `client/src/App.tsx` の入口。

## できること

| | ログインした人（Misskey） | ゲスト |
|---|---|---|
| セッションに入る・話す・セッション内チャット・アイテム | できる | できる |
| アイコン・3D アバターの保存 | できる | できる（その端末のゲストに残る） |
| 自己紹介 | できる | できない |
| タイムラインへの投稿・リアクション・リポスト | できる | 見るだけ |
| フォロー・DM・グループ・セッション/イベントの作成・参加表明・ステータス・いいね | できる | できない |
| ゲームの進み具合（サバイバーズ） | 残る | 残らない（遊ぶことはできる） |

- ゲストがログインした人だけの操作をすると、サーバーは受け付けずに `loginRequired` を返し、画面に「ゲストは使えません。Misskey でログインすると使えます」と出る（`server/index.ts` の `LOGIN_ONLY`）。HTTP の自己紹介・タイムラインの写真・グループ画像の書き込みもゲストは断る
- ゲストは名前の横に「ゲスト」の印が付く（左のプレイヤー一覧とプロフィールカード）。同じ表示名でもアカウントが違えば別人として扱う。ログインした人のプロフィールカードには Misskey の @ユーザー名を出す
- 表示名は最初は Misskey の名前（ゲストは入口で入れた名前）。設定（プロフィール）の「アカウント」で変えられ、つないでいる全員にすぐ届く。同じ欄にログアウトと、ゲストなら「Misskey でログイン」がある
- まだ保存データの多く（フォロー・DM・タイムライン・アイコンなど）は表示名で持っている。名前を変えるとそれらは引き継がれない。アカウント ID で持つように直すのは次の段階（[storage.md](storage.md)）

## Misskey でのログイン（MiAuth）

ログインできる Misskey は 1 つだけ（既定は misskey.resonite.love、`MISSKEY_URL` で変更）。権限は何も求めず、本人確認だけに使う。Misskey のトークンは確認のあとすぐ捨て、Misskey の API は呼ばない。

1. 画面が `POST /auth/miauth/start` を呼ぶ。サーバーは MiAuth のセッション ID を作って `login_pending` に残し、その端末にだけ「待ち合わせ用の秘密」を Cookie（`tonarium_login`、10 分）で渡し、Misskey の許可画面の URL を返す
2. ブラウザはそのまま Misskey へ移る。許可すると Misskey が `/auth/miauth/callback?session=...` へ戻し、サーバーが Misskey の `POST /api/miauth/<セッション>/check` で本人（Misskey のユーザー ID・ユーザー名・名前）を確かめる。待ち合わせの Cookie を持つブラウザなら、ログインの Cookie を付けて `/` へ戻す
3. Electron 版は別のサイトへ移らず、許可画面を外のブラウザで開く（`window.open` → 外部ブラウザ）。アプリ側は「ブラウザで Misskey のログインを続けてください」と出して `POST /auth/miauth/poll` を 2 秒ごとに呼び、終わったらその場でログインの Cookie を受け取る。外のブラウザのほうは「アプリに戻ってください」の案内だけで、ログインはしない
4. 同じ Misskey の人は何度ログインしても同じアカウント（Misskey のユーザー ID で引く）。Misskey 側でユーザー名を変えていれば更新する

## セッション

- ログインの Cookie は `tonarium_session`（HttpOnly・SameSite=Lax、HTTPS なら Secure）。中身は乱数で、DB（`auth_sessions`）にはハッシュだけを残す。期限はログイン 90 日・ゲスト 1 年で、残りが 30 日を切ると使ったときに延ばす。期限切れは 1 時間ごとに消す
- ゲストで入り直すと、同じ端末（Cookie）のゲストなら同じアカウントのまま名前だけ変わる。ログアウトするとその端末のゲストには戻れない
- `/auth/*` の POST は同じオリジンからの fetch だけ受ける（Origin を見る）。他サイトからログインさせたり、名前を変えさせたりできない
- WebSocket（`/ws`）はつなぐ時点でセッションから本人を決める。`hello` は互換性の版だけを送り、セッションが無ければそこで断る（版が古い画面には先に `incompatible` を返して再読み込みを促す）。ログインの導入で `COMPAT_VERSION` を 7 に上げた
- HTTP の書き込み（アイコン・アバター・自己紹介・写真・グループ画像・メディア・通報）と翻訳・OGP・LiveKit のトークンは、セッションの本人で受ける。URL の `?name=` は読むとき（だれのアイコンか）にだけ使う

## 開発とテスト

- `npm run dev`（`--dev`）とテストのサーバー（`AUTH_DEV_LOGIN=1`）では、名前だけでログイン扱いのアカウントを作る `POST /auth/dev` が開く。本番では開かない
- 開発中は URL に `?as=b` を付けると、その名前の開発用アカウントでそのタブだけ入る。同じブラウザの Cookie は全タブで共有されるので、`?as=` のタブはセッションを `sessionStorage` に持ち、fetch は `X-Tonarium-Session` ヘッダー、WebSocket は `?session=` で送る（`--dev` のときだけサーバーが読む）
- サーバーのテストは `server/test-auth.ts` の `devLogin(base, 名前)` で入り、返った Cookie を WebSocket と fetch に付ける。ログインそのものは `server/auth.integration.test.ts` が偽の Misskey を立てて確かめる（`npm run test:integration`）
