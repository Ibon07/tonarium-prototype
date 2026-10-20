# アイテム動作の照合

2026-10-21。Windows 2D/Unityと `shared/items.ts`・Web側の操作を比較し、通常操作を検証した。対象は付箋、キャンバス、チェス、チェスAI、2048、サイコロ、ハンマー、カメラ、画像、動画、YouTube。

- `native-items.json`: 実際の2Dアイテム画面と2クライアントによる編集、保存、設定、キー操作、移動、削除。
- `chess-roundtrip.json`: 2Dのボタンで3手、リセット、実Unity出力の移動要求、AI応手。両者の盤面・棋譜・revisionを比較。
- `unity-chess.json`: 通常手で昇格指定を省略。昇格先4種類、盤の切り替え、選択の取消。
- `canvas-roundtrip.json`: 小数座標の丸め、小数ペン幅、本人・相手・再参加後の一致。
- `unity-items.json`: 付箋ロック、秘密の出目、共通アイテム画面、動画プレイヤー再利用、音声の二重再生抑止、画像保存、実シーンのカメラ撮影。
- `native-video.json` / `unity-video.json`: 同梱の4秒H264動画を実デコードし、再生、停止、短いシーク、赤／青のフレーム変化、終端を確認。
- `camera-loopback.json`: 実LiveKitの別参加者へ仮想映像を送信し、受信・ローカル表示・配信停止を確認。最初の8×8初期化フレームは成功扱いにせず、その後の実画像を確認した。

動画素材は生成した赤2秒・青2秒の640×360 H264、音声なし。カメラ試験にも仮想映像だけを使用し、物理カメラ・マイク・デスクトップ取得は行っていない。YouTubeの埋め込みAPIは時計処理と共通プレイヤーへの引き渡しを確認した。第三者の個別動画が埋め込みを許可することまでは保証しない。3DのYouTube面内再生は未対応で、共通プレイヤーを開く。

```powershell
dotnet run --project native/Tonarium.UiSmoke -c Release -- http://localhost:3016 native/artifacts/items-ui --items
dotnet run --project native/Tonarium.UiSmoke -c Release -- http://localhost:3016 native/artifacts/chess-ui --chess --unity-chess native/verification/item-behavior/unity-chess.json
dotnet run --project native/Tonarium.VideoSmoke -c Release -- native/verification/item-behavior/red-blue-4s.mp4 native/artifacts/video-smoke.json
./native/build/unity/Tonarium3D.exe --tonarium-item-behavior --tonarium-output native/artifacts/items-unity
./native/build/unity/Tonarium3D.exe --tonarium-media-playback --video-fixture native/verification/item-behavior/red-blue-4s.mp4 --tonarium-output native/artifacts/media-unity
./native/artifacts/Tonarium-win-x64/Tonarium.exe --camera-smoke --output native/artifacts/camera-smoke.json
```

サーバーを使う試験のURLは起動中の開発サーバーへ置き換える。今回は共有relayのroom limitを避け、既存ローカルrelayに接続した専用サーバー3016で実行した。既存3015や共有サーバーのデータは変更していない。
