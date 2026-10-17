# Tonarium Prototype

2D（チャット・通話・配信視聴）と 3D（空間）を同じセッションのまま行き来できる体験検証用プロトタイプ。本番では捨てる前提。

## 構成
- `client/` Vite + React + TypeScript。3D は React Three Fiber。状態は zustand
- `server/` Node + ws。オンラインのユーザーと、チャンネル・セッションごとの状態（チャット・付箋・アバター位置）をメモリに保持し、LiveKit のトークンも発行
- `shared/protocol.ts` WebSocket メッセージ型
- `channels.json` テキストチャンネルとセッションの構成
- 音声・画面共有は LiveKit Cloud

設計上のポイント:
- LiveKit 接続は `client/src/net/livekit.ts` に1つだけあり、2D/3D の表示コンポーネントとは無関係に生きている → 表示切替で通話・配信が切れない
- 配信映像は1つの `<video>` を 2D パネルと 3D スクリーン（VideoTexture）で共有 → 二重再生しない。音声は表示と無関係に1回だけ attach
- 付箋は同じ ID で 2D カード／2D マップ／3D 空間の看板として表示。競合は「最後の変更を採用」＋「編集中」表示

## セットアップ
```bash
npm install
cp .env.example .env   # LiveKit Cloud の URL / API Key / Secret を記入
```
`.env` が未設定でも、チャット・付箋・3D は動く（通話と配信のみ無効）。

## チャンネル構成の変更
`channels.json` を編集する。カテゴリごとにチャンネルを並べ、`type` は `text`（テキストチャンネル）か `session`（通話・配信・3D空間・付箋を持つセッション）。
```json
{ "id": "lounge", "name": "ラウンジ", "type": "session" }
```
- `id` は英数字で一意に。セッションごとに別の LiveKit ルーム（`tonarium-<id>`）・3D空間・付箋・チャットになる
- `npm run dev` 中は保存するとサーバーが再起動する（メモリ内のチャット・付箋は消える）。`npm start` の場合は再起動が必要

## 使い方
- はじめはどのセッションにも入っていない状態（テキストチャンネルだけ使える）
- 🔊 のセッションをクリックすると参加して通話につながる。別のセッションをクリックすると移動
- 通話中もテキストチャンネルを開ける（通話は切れない）。左下の 📞 で切断
- マイクのミュートは未接続中でも切り替えられ、次に入ったセッションで反映される

## 開発
```bash
npm run dev
```
http://localhost:5173 を開く。同じブラウザで別人として入るには `?as=b` のように付ける。

## テスト本番（インターネット越し）
```bash
npm start                                         # ビルドして http://localhost:3001 で配信
cloudflared tunnel --url http://localhost:3001    # 表示された https://*.trycloudflare.com を参加者に共有
```
cloudflared は `winget install Cloudflare.cloudflared` で入る。

## 参加者への注意
- デスクトップ版 Chrome / Edge 推奨
- 配信の音声: タブ共有ならタブ音声、Windows で画面全体を共有すると PC の音声も流れる（ウィンドウ単位の共有では音声なし）
- 3D: WASD/矢印で移動、ドラッグで視点、付箋をクリックで選択・ドラッグで移動、Esc で選択解除
- サーバーを再起動すると部屋の状態（チャット・付箋）は消える
