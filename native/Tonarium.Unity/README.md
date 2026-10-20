# Tonarium Unity client

Unity 2022.3.22f1 の Windows x64 プレイヤー。2D クライアントのセッションを引き継ぐ描画プロセスとして動作します。別のユーザーとしてサーバーには接続しません。

## ビルド

```powershell
& 'C:/Program Files/Unity/Hub/Editor/2022.3.22f1/Editor/Unity.exe' -batchmode -nographics -quit -projectPath "$PWD/native/Tonarium.Unity" -executeMethod Tonarium.UnityClient.Editor.WindowsBuild.Build -logFile "$PWD/native/Tonarium.Unity/build.log"
```

出力先は `native/build/unity/Tonarium3D.exe`。シーンはビルド時に生成され、ワールドやアイテムは共有セッションの状態をもとに構築されます。`TONARIUM_UNITY_EDITOR` と `TONARIUM_UNITY_PLAYER` でエディター／ビルド済みプレイヤーのパスを指定できます。

## 操作

| 操作 | キー |
| --- | --- |
| 視点の操作を開始 | 空間をクリック |
| 移動／速く移動 | WASD／Shift |
| ジャンプ | Space |
| アイテムを使う、付箋を開く、チェスの駒を動かす | E または左クリック |
| 運ぶ／置く | 右クリック |
| ハンマー・カメラを手放す | Q |
| 持っているカメラで撮影してチャットに送る | C |
| チャット | Enter |
| ワールド切替・アイテム追加メニュー | Esc |
| 2D に戻る | F2 または右上ボタン |

ホール・カフェ・板わたりの家具配置、当たり判定、ジャンプ値、アイテムのメッセージ形式は `shared/` と既存 Web 版の定義に対応しています。チェス、付箋、サイコロ、2048、共同キャンバス、画像、同期動画の表示・基本操作に対応します。各アイテムから「2D のパネルで開く」で既存セッションの詳しい操作パネルを開けます。YouTube はこのパネルを利用します。

## プロセス間通信

`--tonarium-port N` を渡すと IPv4 loopback TCP に接続します。UTF-8 newline JSON で、Unity は `ready`、`room`、`return2d`、`openItem` を送信します。Desktop は初期 `snapshot` と既存サーバーメッセージの差分、`teleport`、`videoFrame`、`resize`、`shutdown` を送信します。Windows では親 HWND に描画ウィンドウを埋め込みます。`resize` は親ウィンドウのクライアント領域の実ピクセル数を渡し、Unity の描画解像度も更新します。親 HWND を省略すると独立ウィンドウになります。埋込みでは重複するタイトル・チャットを隠し、2D 復帰と操作案内を狭い描画領域に合わせて表示します。

LiveKit の接続・音声・画面共有送信は常駐 Desktop が所有します。受信画像は 3D 使用中だけ、最大 5 fps・幅 960 px の JPEG として Unity に渡します。2D に戻ると転送と Unity プロセスを終了します。Unity のカメラ写真は対応済みですが、仮想カメラ視点の LiveKit 配信は未対応です。

## 動作確認

ルートで `node native/Tonarium.Unity/Tools/smoke-bridge.cjs`。実際の Windows プレイヤーにセッション状態、アバター、4 種のアイテム、ライブ画像、テレポートを送信します。3 ワールドの画面と結果を `native/verification/unity/` に保存します。ユーザー操作の異常系を網羅する試験ではありません。

## アバター

`Assets/Resources/OekakiGeometry.json` は既存 `client/public/oekaki/avatar.glb` の 14 個の Draco メッシュを展開したものです。`node native/Tonarium.Unity/Tools/convert-avatar.cjs` で再生成できます。既存サンプルテクスチャとカスタムテクスチャ・調整値を使用します。元データの出典・利用許可は `Assets/Resources/OekakiSource.md` を参照してください。
