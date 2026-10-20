# 同期の仕組み（WebSocket と LiveKit の部屋）

経路は 2 本。セッションの外でも使うものは WebSocket、セッションの中のものは LiveKit の部屋（データチャネル）で流す。状態の正はどちらもサーバーが持つ。

## 2 本の経路
- **WebSocket（`/ws`）** クライアントは `client/src/net/ws.ts`、サーバーは `server/index.ts` の `handle`
  - つないだときの `snapshot`（セッション一覧・オンラインの人 `users`・フレンド・グループ・イベント・`sessionInfo`）と `inbox`
  - `join` / `leave`、プロフィール更新、フレンド申請、ホームの操作（セッション・グループ・イベントの作成、DM・チャンネル、ステータス、招待）
- **LiveKit の部屋** セッションごとに `tonarium-<セッション ID>`（`LIVEKIT_ROOM_PREFIX` で変えられる）。サーバー自身も参加者 `server` として入る（`server/rooms.ts`、Node 用の `@livekit/rtc-node`）。最初の人がセッションに入るときにつなぎ、最後の人が出たら部屋から出る。`/token` はサーバーが部屋に入ってから返す（先に入っていないと、入った人に中の状態を渡せない）
  - クライアント → サーバー（信頼モード、宛先は `server` だけ）: `mode` `status` `follow` `dropFollowers` `place2d` `displayMove` `chat` `viewing` `poke` `sound` `liveRequest` `viewLive` `itemCreate` `itemRemove` `itemMove` `itemAction` `attention` `broadcast` `world` `gameStart` `gameStep` `gameFell` `hit` `sync`
  - クライアント → 全員（損失許容モード）: `avatar`（3D の位置）だけ。サーバーを経由せず SFU から直接届く。サーバーも受け取って、途中から入る人に渡す分を覚える
  - サーバー → 部屋: `presence` `chat` `item` `itemRemove` `itemAction` `avatarRemove` `hit` `poke` `sound` `liveRequest` `attention` `broadcast` `worldPending` `world` `game` `gameTile`。宛先を絞るものは `destinationIdentities`（声の範囲のチャット、シークレットのサイコロ、自分が適用済みの差分）
- `client/src/net/ws.ts` の `send()` が種類で振り分けるので、呼ぶ側は経路を意識しない（`shared/protocol.ts` の `isRoomClientMsg`）

## 入ったときの状態
- 部屋に人が入るとサーバーがその人だけに `SessionSnapshot`（チャット・位置・アイテム・presence・ブロードキャスト・ワールド・ゲーム・サーバー時刻）をテキストストリーム（topic `snapshot`）で送る。クライアントもつないだ直後に `sync` を送るので、どちらが先に部屋に入っても届く
- データパケットは 1 通 14KB まで（`ROOM_PACKET_MAX`）。超えるもの（画像付きのチャット、大きいキャンバスなど）はテキストストリーム（topic `msg`）で送る。クライアントからサーバーへも同じ

## User と Presence
- `User`（WebSocket で全員に届く。ホームの「誰がどこにいるか」にも使う）: `id` `name` `session` `mode` `sharing` `icon` `avatar` `bio` `status` `statusText`
- `Presence`（部屋でそのセッションの人にだけ届く）: `micOn` `follow` `pos`（2D の立ち位置） `viewing` `viewLive` `display`（配信ディスプレイの位置）。変わるたびにセッションの全員分をまとめて `presence` で配り直す
- クライアントは `participants` = `User` + `Presence` に合成して使う（`store.ts` の `recompute`）。サーバーは 1 つのオブジェクトで持ち、WebSocket に出すときに `Presence` の項目を落とす
- ホーム向けには `sessionInfo`（セッションごとのワールドとアイテムの要約）を WebSocket で配る。アイテムやワールドが変わったら 300ms でまとめて全員へ。セッションカードの「置いてあるもの」と、メッセージに添えたアイテムの表示に使う

## 位置
- 3D の人は 30fps（33ms 間隔）で、変化したときだけ `avatar` を送る（`client/src/view3d/Player.tsx`）
- 受け取った側は `shared/places.ts` の `clampAvatar` でそのワールドの範囲に収める。2D の人の分が残っていても表示しない（`mode` の変更より先に位置が届くことがあるので、届いた時点では捨てない）
- 表示は届いた値に向かって毎フレーム寄せる補間（`View3D.tsx` の `Avatar3D`）

## 切断とつなぎ直し
- **WebSocket が切れた**: サーバーは退出扱いにする。つなぎ直したら `join` を送り直し、部屋はつながったままなので `sync`・`mode`・位置・`viewing`・`status` を送り直す（`livekit.ts` の `resyncRoom`）
- **LiveKit が切れた**: 3 秒後につなぎ直す。切れている間はセッションの中の同期も止まる（ドックの上に出る）
- **LiveKit につながらない人**: セッションに入ってもチャット・アイテム・位置は同期されない。ホームは見られる。WebSocket への切り戻しは無い
- **サーバーの再起動**: セッションの中の状態（チャット・位置）は消える。アイテムは `data/items.json` から戻る

## 開発中の注意
- `livekit.ts` が HMR で読み直されても `Room` は `globalThis` に 1 つ。2 つ目を作ると同じ ID で入って互いに蹴り出し、つなぎ直しを繰り返す
- 複数のワークツリーで 1 つの LiveKit を共有すると、同じセッション ID の部屋が混ざる（サーバー同士も `server` の ID で蹴り合う）。片方の `.env` で `LIVEKIT_ROOM_PREFIX` を変える
- サーバーがつなぐ先はブラウザと別に `LIVEKIT_SERVER_URL` で指定できる（docker-compose では `ws://livekit:7880`）。省略時は `LIVEKIT_URL`
