# Windows ネイティブメディア

`NativeMedia` は LiveKit Rust FFI (`Livekit.Rtc.Dotnet`) に接続し、WASAPI で音声入出力、GDI で画面/ウィンドウ共有を処理します。WebView は使用しません。2D/Unity の切替では同じインスタンスを維持してください。

- `SetMicrophoneAsync` はマイクの希望状態を保存します。セッションを移動してもミュートは維持します。
- `SetScreenShareAsync(true)` は共有対象と PC 音声の選択ダイアログを表示します。
- ウィンドウ共有は `PrintWindow(PW_RENDERFULLCONTENT)` で選択したウィンドウ自身を取得します。通常は別のウィンドウが前面に重なっても含まれません。アプリが取得を拒否した場合のみ表示領域の取得に戻ります。一部の GPU 描画や保護された映像は黒くなる場合があるため、その場合は画面全体の共有を使用してください。
- `ShowAudioSettingsAsync()` は既定または指定の入出力デバイスを選択します。
- マイクは現在エコーキャンセルを行いません。LiveKit の低レベル定義には音声処理設定がありますが、採用した .NET SDK の `AudioSource` はその指定と再生音声の参照入力を公開していません。ヘッドホンで通話してください。PC 音声の共有には通話相手の音声も含まれます。
- `VideoFrameJpeg` は Unity 表示時かつ購読時のみ JPEG を生成します (最大 960px、5fps)。空のバイト配列はトラック終了です。

## 実機スモーク

`npm run livekit` で開発用 LiveKit を起動し、デスクトップアプリを `--media-smoke` で実行します。

```powershell
dotnet run --project native/Tonarium.Desktop -- --media-smoke
```

この明示的なチェックは約 3 秒間マイクと画面を取得し、小さなテスト音を再生します。ユーザーの保存設定は変更しません。通常の UI スモークでは実行しません。

CLI は初期化済み Avalonia UI スレッドで `await NativeMediaSmoke.RunAsync()` を呼び、戻り値の JSON を出力します。既定の接続先は `ws://127.0.0.1:7880`、開発キーです。別サーバーの場合はメソッド引数で URL・API キー・シークレットを渡せます。トークンやシークレットは結果に含めません。

実際の別参加者とのマイク、音声受信、映像受信、画面送信、Unity 用 JPEG、停止・ミュート後の再入室を確認します。PC 音声が無音なら loopback のフレーム数が 0 になる場合があります。
