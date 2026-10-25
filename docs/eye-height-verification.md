# アバターの目の高さへの追従（PR 説明案・検証記録）

固定 1.6m だった一人称の高さを、アバターの頭の寸法と首・脚のパラメータから求める。Web と Unity は既定値から開始し、パラメータ・テクスチャの読み込み後に時定数 200ms の指数補間で追従する。モデル側にも同じ床補正を適用する。体のメッシュだけを変える bodySize は頭の位置を変えない。

既定パラメータの計算値は **1.085556018447876m**。Web の単体テストと Unity のコメント・AvatarParityProbe に同じ期待値を残す（Unity の float は誤差 0.000001m を許容）。極端値の期待値は headSize=100、neckLength=80、legsDistanceFromBody=70、legsSize=3 で **3.926202306447876m**。反転した寸法のケースもテストする。

頭の上下・前方の目印は headSize の 1/4・1/3。高さには上下成分を使う。通常の待機アニメーションやエモートでカメラが揺れ続けないよう、実行時 Head ワールド座標による上書きは採用せず、静止寸法の計算値を使う。Web のテストは実 GLB と Unity の生成済みノードの一致、頭の寸法定数と GLB の一致、および標準・極端・反転体型の頭の目印と計算値の差も検査する。

## EYE 参照箇所の変更一覧

`git grep -n -w EYE HEAD -- client/src/view3d` で変更前の全 6 箇所を確認。

| 変更前の箇所 | 変更内容 |
| --- | --- |
| interact.ts:17 定義 | DEFAULT_EYE_HEIGHT を標準アバターの既定値として公開 |
| Player.tsx:15 import | EYE を除き useEyeHeight を使用 |
| Player.tsx:96 初期カメラ | 現在の高さに足元の y を加算 |
| Player.tsx:327 毎フレームのカメラ | 補間済みの高さに足元・被弾オフセットを加算 |
| View3D.tsx:13 import | EYE を除き高さの Context を使用 |
| View3D.tsx:287 Canvas 初期位置 | Context の既定値を使用 |

変更後の EYE は interact.ts の標準値の定義のみ。上面視点は Web / Unity とも `現在の高さ + (16 - 標準の高さ)` とし、標準体型では 16m を維持する。手元のハンマーとカメラはカメラ座標系の相対位置を使う。他者の手持ち表示、照準用コライダー、名札・吹き出しも頭の高さに追従する。他者の手持ちは標準体型のハンマー 0.6m・カメラ 0.9m を維持し、標準の目の高さとの差分を加算する。照準用コライダーは最低 0.7m を確保し、中心を実際の高さの半分に置く。

Unity では EyeHeightProvider だけが補間を行う。TonariumWorld、WorldGeometry、WorldSurvivors はその値を読む。自分のモデルも読み込み、一人称では非表示、設置カメラによる撮影時に表示する。見た目の照準用コライダーは追従させ、移動用 CharacterController の寸法は既存の衝突・段差処理を維持するため変えない。

## 検証結果（2026-10-25）

| コマンド | 結果 |
| --- | --- |
| git diff --check | 成功 |
| npm run test:avatar | 実行不可: Volta の保存先への権限エラーで npm が起動しない |
| npm run typecheck | 同上 |
| node_modules/@typescript/typescript-win32-x64/lib/tsc.exe --noEmit -p tsconfig.json | 成功（npm の typecheck と同じコンパイラ・引数を直接実行） |
| npm run build | 同上 |
| powershell -ExecutionPolicy Bypass -File native/build-unity.ps1 | 実行不可: 指定版 Unity Editor 6000.6.7f1 が見つからない |
| dotnet run --project native/Tonarium.UiSmoke -c Release -- unused native/build/eye-height-lifecycle --3d-lifecycle | 実行不可: .NET SDK が見つからない |

型チェックは成功。ビルド成功・単体テスト成功・実機での受け入れ確認は未達。依存ツールを利用できる環境で上記を再実行し、[Windows の既存手順](native-windows.md)に従って Unity Player の `--tonarium-avatar-parity --tonarium-output <出力先>` を実行する。既存プローブに既定値・極端値・読み込み前・補間・フレームレート独立性・頭の目印の検査と極端体型の画像出力を追加した。Linux の描画・操作確認は [Linux の既存手順](native-linux.md)に従う。

## 既存挙動のチェックリスト

チェック済みはコードの確認。実機での操作・画像比較は下段の未チェック項目として残す。

- [x] ジャンプ・落下・段差・電車の足元計算を維持し、最後に目の高さを加算
- [x] 被弾による体の縮み・カメラの上下オフセットを維持
- [x] 上面視点は標準体型で 16m、体型の差分は加算
- [x] 一人称ハンマーのカメラからの相対位置・振り動作を維持
- [x] カメラアイテムの撮影・配信は現在の一人称カメラ座標を参照
- [ ] 標準体型と極端体型の両方で、自撮り・他者視点と一人称の目の高さを画像比較
- [ ] 低速読み込み・アバター変更時にカメラが跳ねないことを実機確認
- [ ] ジャンプ・被弾・段差・電車・上面視点・手持ち表示を実機確認

既存実装には独立したしゃがみ入力はない。今回、しゃがみ動作は追加していない。受け入れ条件の 6 項目を完了と扱うには、未実行のビルド・プローブ・実機確認が必要。
