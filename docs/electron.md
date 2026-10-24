# Electron 版

Electron 版は接続先サーバーの Web クライアントを、そのまま専用ウィンドウで開く。2D は React、3D は React Three Fiber / Three.js で、サバイバーズを含む描画・操作・音・通信は Web 版と同じコードを実行する。Avalonia / Unity のネイティブ版とは別のアプリで、並行して利用できる。

初期接続先は `https://tonarium.rheni.work/`。サーバーに配信された Web 更新は、Electron 版でも再読み込み時に反映される。Web アセットやサーバーは配布物に同梱しないため、接続にはネットワークが必要。Electron 本体の更新はアプリの再ビルド・再インストールで行う。自動更新配信は未実装。

メニューの「接続先を変更…」から接続先を設定する。設定はユーザーデータ内の `connection.json` に保存する。起動時の `--server URL` でも指定できる。HTTPS 接続を使用し、開発用の `localhost` / `127.0.0.1` / `[::1]` だけ HTTP を許可する。`--data-dir PATH` でテスト用に保存先を分離できる。

## 開発とビルド

Node.js 22.12 以上 / npm が必要。Electron と electron-builder は `electron/package-lock.json` で固定している。`npm ci` の postinstall で開発・テスト用 Electron 本体もダウンロードする。

```bash
npm --prefix electron ci
npm --prefix electron start
npm --prefix electron run build:linux
npm --prefix electron run build:windows
```

Linux x86_64 は tar.gz と AppImage、Windows x86_64 は ZIP を生成する。成果物と SHA-256 は `electron/artifacts/`、展開済みアプリやビルド中間ファイルは `electron/build/` に置く。Windows ZIP は Linux からも作成できるが、Windows 実機での動作確認は別途必要。コード署名・Windows インストーラー・macOS 配布は含めていない。

AppImage は実行権限を付けて起動する。FUSE を利用できない環境では `--appimage-extract-and-run` を利用できる。

```bash
chmod +x electron/artifacts/Tonarium-Electron-0.0.8-linux-x86_64.AppImage
electron/artifacts/Tonarium-Electron-0.0.8-linux-x86_64.AppImage
```

## Linux へのインストール

ビルド後、次を実行する。

```bash
bash electron/install-linux-user.sh
tonarium-electron
```

アプリは `~/.local/opt/tonarium-electron/`、起動コマンドは `~/.local/bin/tonarium-electron`、アプリメニューには **Tonarium Electron** として登録する。再インストール時は新しい日時付きディレクトリに配置して `current` を切り替え、古いアプリを保持する。ネイティブ版の `tonarium` とインストール先を共有しない。ユーザーデータの既定位置は Linux では `$XDG_CONFIG_HOME/tonarium-electron`（通常 `~/.config/tonarium-electron`）、Windows では `%APPDATA%/tonarium-electron`。保存先は Web ブラウザーとも別のため、初回は Web 版と同様にログインが必要。

## 機能と制約

- マイク・カメラは接続先の Web ページから要求された際に確認する。
- 画面共有は Electron / OS の画面選択を通す。Wayland では PipeWire とデスクトップ環境に対応する XDG Desktop Portal が必要。Linux は画面の映像のみで、システム音声の共有は未対応。Windows は要求時にループバック音声を利用するが、実機確認が必要。
- 外部リンクは通常のブラウザーで開く。Web ページに Node.js や任意のローカルファイル操作権限を渡さない。
- 日本語入力・WebGL・音声・画面共有は同梱 Chromium と OS の組み合わせに依存する。Web と同じコードを使うが、ブラウザーのバージョン、GPU、コーデック、外部サービス側の埋め込み制限による差はあり得る。
- アプリ本体のライセンスは未設定。パッケージの `UNLICENSED` はオープンソースライセンスの付与を意味しない。同梱 Electron / Chromium 等のライセンス文書は配布物に保持する。

テスト用のサーバーやセッションを使い、運用中のラウンジで自動操作テストを実行しない。

## 検証

```bash
npm run electron:test
# Playwrightが別ディレクトリにある場合はPLAYWRIGHT_MODULEにその絶対パスを指定
xvfb-run -a node electron/verification/smoke.cjs
xvfb-run -a node electron/verification/web-smoke.cjs
xvfb-run -a node electron/verification/launch.cjs
```

`smoke.cjs` はローカルHTTPページと合成メディアデバイスで、接続先・保存・権限・外部リンク・接続失敗時の復帰・画面共有選択のキャンセルを確認する。実画面・実マイクは取得しない。`ELECTRON_BINARY` に展開済みの実行ファイルを指定すると配布版を検証できる。PlaywrightのElectronドライバーは起動時にサンドボックスを無効にするため、別の `launch.cjs` では通常の配布版をその指定なしで起動して確認する。仮想画面のGPU描画にはテスト時のみSwiftShaderを指定する。

`web-smoke.cjs` は既存のWeb版React／Three.jsコンポーネントを変更せずElectronで描画し、2D／3D画像を保存する。Viteのローカル検証ページを一時生成し、終了時に削除する。結果は `electron/build/verification/` に置く。OSの実IME変換、Waylandでの実画面選択、Windows実行はこの自動検証の対象外。

Electronの隔離と権限処理は[公式セキュリティガイド](https://www.electronjs.org/docs/latest/tutorial/security)、画面共有は[desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)に基づく。

### マイク・スピーカーの選択

Electronの「Tonarium Electron → マイク・スピーカー…」、またはWebのホーム／セッション内の音量メニューから共通の設定を開けます。入力・出力のプルダウンで選んだ機器は接続先ごとに保存されます。機器名が表示されない場合は「マイクを許可して機器名を表示」を押してください。この操作で取得したマイクはすぐ停止し、録音・送信しません。

通話中のマイク変更はLiveKitに即時反映されます。録音メッセージは次の録音から新しいマイクを使います。出力設定は人の声、効果音、動画・録音メッセージに適用します。YouTube埋め込みは別オリジンのため対象外です。機器を取り外すと、権限取得済みで消失を確認できた時点でシステムの既定へ戻ります。

この設定はWebの実装を共有するため、接続先サーバーにも本変更の配信が必要です。旧WebのままElectronメニューを開いた場合は更新が必要な旨を表示します。リモートWebへのNode API公開やメディアAPIの差し替えは行いません。

音声デバイス設定の検証: `npm run test:audio-devices` は偽の機器で切替・権限拒否・保存・機器消失・出力失敗時の復元・並行変更を確認します。`PLAYWRIGHT_MODULE=/path/to/playwright xvfb-run -a node electron/verification/audio-settings.cjs` はローカルWebと偽マイクを使い、Electronメニューからの設定表示・機器選択・再読み込み後の保存を確認します。実マイクの録音・サーバー送信はしません。PlaywrightによるElectron起動は `--no-sandbox` が追加されるため、この検証だけでOSサンドボックス自体を検証したことにはなりません。

`electron/verification/audio-virtual-devices.cjs` は検証専用のPulseAudio仮想入力・出力を2組作り、選択した入力IDと実際の取得元、AudioContext／HTMLAudioElementの出力IDを確認して終了時に削除します。許可をテスト用に事前設定し、仮想入力IDを明示して取得します。音声保存・送信・可聴再生は行いません。実通話の音質確認は別途必要です。
