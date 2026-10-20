# Windows ネイティブクライアント

Avalonia 12 / .NET 10 の2Dクライアントと、Unity 2022.3のWindows Player。ホーム・チャット・アイテム・プロフィールはネイティブUIで、Unityは3Dを開いたときだけ別プロセスで起動する。Windowsでは同じウィンドウの中央へ埋め込み、左右の一覧・チャット・下のドックを維持する。

既存のNodeサーバー、kokosync、LiveKitを使用する。ブラウザ版と同じセッションに参加でき、2D/3D切り替えでユーザーID・同期接続・通話接続は変わらない。2Dに戻るとUnityプロセスを終了する。

## 起動

リポジトリのルートで実行する。ローカルサーバーが未起動ならスクリプトが起動する。

```powershell
powershell -ExecutionPolicy Bypass -File native/run-desktop.ps1
powershell -ExecutionPolicy Bypass -File native/run-desktop.ps1 -Server https://example.com -Name なまえ
```

既定の接続先は http://localhost:3001。開発ビルドには.NET 10 SDKが必要。この作業では `%LOCALAPPDATA%/Tonarium/dotnet` に導入済みで、スクリプトはこのSDKを優先する。通常のdotnetにSDKがあればそちらも使える。通話は既存の.envと `npm run livekit` を使用する。

```powershell
powershell -ExecutionPolicy Bypass -File native/build-unity.ps1
powershell -ExecutionPolicy Bypass -File native/publish-desktop.ps1
```

Unity EditorとWindows Build Supportが必要。ビルドは導入済みの2022.3を優先し、`native/build/unity/Tonarium3D.exe` を生成する。ビルドがなければ3Dボタンからもビルドを試みる。`TONARIUM_UNITY_EDITOR` / `TONARIUM_UNITY_PLAYER` で実行ファイルを指定できる。

配布用フォルダーは `native/artifacts/Tonarium-win-x64/`。全体をコピーして `Tonarium.exe` を起動する。.NETランタイムとUnityを含むため配布先にSDKは不要。接続先のTonariumサーバーは別途必要。YouTubeを開く場合だけWebView2 Runtimeを使用する。Unityビルド済みならpublishに `-SkipUnity` を指定できる。独立した3Dウィンドウで比較する場合はアプリに `--separate-3d` を付ける。

## 実装・確認範囲

| 分野 | 実装 | 通常操作の確認 |
| --- | --- | --- |
| ホーム | ホーム、フレンド、セッション、イベント、グループ、ワールド、アイテム | 全ページ描画・移動 |
| ソーシャル | セッション作成・参加、フレンド申請・承認、グループ・チャンネル、イベント・RSVP | 実サーバーで往復 |
| メッセージ | 範囲別チャット、アナウンス、DM、既読、日程、添付、音声 | 入力イベント、送信、AAC保存・配送 |
| 2Dルーム | 距離別一覧、動くお絵描きアバター、通知、折りたたみ、ドック | 描画・操作・最小サイズ |
| アイテム | 付箋、共同キャンバス、チェス・AI、サイコロ、2048、画像、動画、YouTube、ハンマー、カメラ表示 | 編集・描画・駒移動・ロール・再生・同期時計 |
| プロフィール | 自己紹介、アイコン、アバター・調整値、フレンド、接近、追従、ブロック、通報 | 自他画面描画、自己紹介保存 |
| 同期 | C# kokosync SDK、暗号化MessagePack、再接続、初期同期・差分・大きい本文 | ネイティブ2台と既存JS SDKの相互接続 |
| 音声 | LiveKit、WASAPI、距離・左右音声、ミュート、機器選択 | 別参加者との実際の送受信、ミュート後再入室 |
| 共有 | 画面・ウィンドウ、PC音声、映像受信 | 実際の送受信、覆われたウィンドウの取得 |
| 3D | ホール・カフェ・板わたり、アバター、移動・ジャンプ・衝突、アイテム、写真 | Windows Player起動・描画、位置送信、テレポート、共有画像 |
| 切り替え | Unity埋め込み、リサイズ、2D復帰 | 実際のHWND・プロセス・接続状態 |

「実装」と「確認」は区別している。全操作を全端末で確認した意味ではなく、Web版とのピクセル単位の同一性も保証しない。

## 通常操作の再確認

テスト用のサーバーを指定する。dotnetがSDKを見つけられなければ `%LOCALAPPDATA%/Tonarium/dotnet/dotnet.exe` を使う。

```powershell
# ネイティブ2台と既存JS SDKとの相互接続
 dotnet run --project native/Tonarium.Smoke -- http://localhost:3015
# 実際のネイティブコントロールの操作・描画
 dotnet run --project native/Tonarium.UiSmoke -- http://localhost:3015 native/Tonarium.UiSmoke/results
# Unity Playerの描画とIPC
 node native/Tonarium.Unity/Tools/smoke-bridge.cjs
# Windows親子ウィンドウ・リサイズ・2D復帰
 native/Tonarium.Desktop/bin/Debug/net10.0-windows/Tonarium.exe --server http://localhost:3015 --name NativeCheck --smoke native/artifacts/embedded --smoke-3d
# マイク・画面を約3秒取得する明示的な実機確認
 native/Tonarium.Desktop/bin/Debug/net10.0-windows/Tonarium.exe --media-smoke --output native/artifacts/media-smoke.json
```

UIスモークは日本語入力イベントとEnter送信を確認するが、実機IMEの候補選択は自動確認していない。画像は `native/verification/unity/`、通常の実行結果は `native/artifacts/` と `native/Tonarium.UiSmoke/results/` に保存する。後者はGit管理外。

配布用Release版の実機計測では、通話接続中・マイクミュート・アバター2体の2Dルームで、10秒間のCPU時間増分891ms（1コア換算8.9%）、ワーキングセット約285MiB、Unity起動なしだった。背景と固定パネルは描画をキャッシュしている。端末・通話・共有・データ量によって変わる参考値。

`--smoke 保存先 --measure-idle 10` で、操作確認用の外部UI Automationから独立して同じ待機計測を実行できる。秒数は省略時5秒。

## Web版の見た目とお絵描きアバター

ホーム・ルーム・プロフィール・アイテムは、Web版の配置と色を基準にしたネイティブコントロール。元のブランド画像、`Icon.tsx` のベクター図形、Zen Kaku Gothic New / Zen Maru Gothicを使用する。フォントとOFLライセンスは `native/Tonarium.Desktop/Assets/fonts/` に同梱する。セッションカード、週のイベント欄、320px / 300pxのルームパネル、下部ドック、顔のグリッドと上部ストリップもWeb版に合わせている。

2Dのお絵描きアバターは元のGLBから取り出した14メッシュ・28三角形と14アニメーションチャンネルをC#で描画する。テクスチャを切り抜いた静止画像ではなく、待機アニメーション、瞬き、マイクに反応する口パク、3D参加者の顔の上下、アップロードした画像とmanifestの体型変更に対応する。顔カードはWeb版と同じカメラで胸から上を表示し、プロフィール編集では全身を確認できる。

モデルと画像は共有キャッシュを使い、表示中の大きい顔は約15fps、小さい顔は約8fpsで更新する。非表示・画面外・最小化中は更新を止める。2Dの顔のためにUnityやWebViewを起動しない。元のGLBを変更した場合は `node native/Tonarium.Unity/Tools/convert-avatar.cjs` で共通データを作り直す。

UIスモークにはアバターのフレーム差分、独立した瞬き・口パク・視線の描画、実サーバーへの画像アップロードと体型更新を含む。アバター検証画像は `native/verification/avatar/`、画面比較用の画像は `native/verification/ui/` に保存する。

## 残る差分

- マイクのエコーキャンセルは未実装。現在の通話はヘッドホンを推奨する。
- Unity仮想カメラ視点のLiveKit配信は未実装。写真撮影、共有映像の3D表示、通常の画面共有には対応する。
- Unityへの共有映像は最大960px・5fpsのJPEG転送。2DはネイティブSDKのフレームを直接表示する。
- YouTubeだけはアイテムを開いたときにWebView2を起動する。通常のホーム・2D画面にはWebViewを使わない。
- ネイティブ同期は既存サーバーへ接続できるWebSocket経路を使う。LNL/QUICエンドポイントと直接P2P接続は今回未実装。
- カンタン表示は他のアイテムウィンドウを最小化する。Web版の小さい内部ウィンドウ列とは異なる。フリー表示はOSウィンドウを自由に動かせる。
- macOSの実装・配布確認は未実施。一部のGPU描画ウィンドウはPrintWindow取得に対応しないため、画面全体の共有が必要な場合がある。

## ファイルと責務

- `native/Tonarium.Desktop/Core/`: 接続、状態、kokosync SDK、設定
- `native/Tonarium.Desktop/Views/`: ネイティブ画面・アイテム
- `native/Tonarium.Desktop/Media/`: LiveKit、音声・映像、実機スモーク
- `native/Tonarium.Desktop/ThreeD/`: Unity起動、埋め込み、IPC
- `native/Tonarium.Unity/`: Unityプロジェクト、確認スクリプト
- `native/Tonarium.Smoke/` と `native/Tonarium.UiSmoke/`: 通常の同期・UI操作確認

ログは `%LOCALAPPDATA%/Tonarium/desktop.log` と `unity-player.log`。接続先・名前・ユーザーIDは `desktop.json`、表示と音声の設定はNativeSettingsが同じアプリ用ディレクトリへ保存する。
