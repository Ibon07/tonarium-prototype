## 利用者向けの変更

- 2Dマップの床・家具・目印の平面表示に、右ドラッグでの回転・俯角変更を追加します。中ドラッグで平行移動、ホイールでズーム、Spaceで視点を戻せます。
- 人物を既存設定の全身アバターと名前で表示します。名前は人物の補間後の位置から投影し、モデル読み込み中も表示します。
- マップ設定の未保存時は2Dを選び、保存済みの「なし／2D／3D」は維持します。操作説明を日本語・英語・韓国語で更新します。

## 実装と再作業

- 作業ツリーの既存実装と、View3D.tsxの `recentlyHit` importを維持しました。TS2304が解消していることを型チェックで確認しました。
- 床・家具・線路・電車の既存SVGをアバターと同じカメラで投影し、床面との交点を既存の移動処理へ渡します。建物・家具の立体モデル、独立した同期・保存・アバター設定、新規依存は追加していません。
- ブラウザ検証で、モデル読み込み後にDrei Htmlの名前ラベルが空になる問題を確認しました。名前をDOMへ置き、人物の補間後の変換と現在のカメラから毎フレーム投影するよう修正しました。床とCanvasの重なり順も明示しました。
- 既存three-stdlibのOrbitControlsはマウス押下時にcaptureを取得せず、documentのpointermove/upを使う実装でした。回帰テストの誤った前提を修正しました。capture喪失のケースはfixtureが実ポインターをcaptureし、releasePointerCaptureで実際のlostpointercaptureを発生させます。
- ブラウザテストでは既存Three.js同梱のDracoデコーダーを使用し、外部通信を遮断したまま実モデルを読み込みます。

## 自動検証（2026-10-29）

通常のnpmコマンドはVoltaが保護されたディレクトリを作ろうとして失敗します。利用可能な既存Node.js **24.19.0**をPATHの先頭に置き、package.jsonに定義された同じスクリプト本体を、ローカル依存のCLIから直接実行しました。以下はすべて終了コード0です。npmコマンドそのものの成功記録ではありません。

| 対応するnpmスクリプト | 直接実行した内容 | 結果 |
| --- | --- | --- |
| typecheck | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 成功、recentlyHitを含む型エラーなし |
| build | `node node_modules/vite/bin/vite.js build` | 成功 |
| test:client | `node node_modules/tsx/dist/cli.mjs --test` + package.jsonの全対象ファイル | 105成功、失敗・スキップ0 |
| test:avatar | 同上、test:avatarの全対象ファイル | 3成功、失敗・スキップ0 |
| test:movement | 同上、test:movementの全対象ファイル | 23成功、失敗・スキップ0 |
| test:camera | 同上、test:cameraの全対象ファイル | 17成功、失敗・スキップ0 |
| test:i18n | 同上、test:i18nの全対象ファイル | 21成功、失敗・スキップ0 |
| check:content-locales | `node node_modules/tsx/dist/cli.mjs scripts/content-translations.ts validate` | 38文書成功 |
| check:changelog | `node scripts/check-changelog.mjs --base HEAD` | 成功、履歴変更なし |

- test:clientには複数の回転角・俯角・距離・ズーム・平行移動・画面寸法での床投影／クリック復元、交点なし、ボタン・ドラッグ・キャンセル判定、未保存／保存済み三択の設定復元が含まれます。
- buildは成功しましたが、大きなchunkとlivekitの動的／静的import混在の警告があります。
- `npm run check:completion` も再試行しましたが、Voltaの権限エラーで検証本体の起動前に終了コード1でした。その構成要素（履歴チェック、翻訳チェック、型チェック、ビルド）は上記の方法ですべて成功しました。**必須npmコマンド自体の成功は未確認です。**
- `git diff --check` 成功。`changelog/`・`shared/changelog.ts` は変更していません。

## ブラウザ検証

既存PlaywrightとChrome **153.0.8010.36**を使用。`node scripts/verify-map-browser.mjs` でfixtureを起動し、`node scripts/test-map-browser.mjs <既存Playwrightのmodule URL> <Chromeのパス>` を実行して成功しました。新規依存は不要です。

確認済み:

- 右ドラッグの回転・俯角変更、中ドラッグの平行移動、右／中クリック、左ドラッグで移動が発火しないこと。
- 子要素が伝播を止めるpointercancel、実際のcapture喪失、CDPによるタッチキャンセルで移動しないこと。キャンセル後のクリック／タップで移動できること。
- 回転・平行移動後の床クリックが、表示したSVG床から復元した座標と0.01m未満の差で一致すること。
- ホイールで投影が変わり、Spaceで床の投影が初期位置へ戻ること（床上3点の画面座標差0.02px未満）。
- 390×844のタッチ端末エミュレーションでタップ移動が機能すること。
- 2D／3D参加者と自分の全身モデル読み込み、名前表示。fixtureに投入した参加者状態の位置・向きへの補間、名前変更、退出時の人物・名前削除。
- roomからcafeへの切替と平面家具表示、既存3Dマップのroom描画。ブラウザのpageerrorなし。
- 保存した実描画画像を確認し、床・スポーン・範囲表示、カフェの平面家具、名前、3Dマップの壁・床と天井クリッピングを確認しました。標準アバターの細線は初期縮尺では判別しづらく、ズーム画像でも確認しました。

検証ログと画像は `.local/verification/` に保存しています（Git管理対象外）。このfixtureは実際のMap2D／Map3D・ストア・モデルを使用しますが、参加者状態はテストから投入します。実サーバー経由の同期の成功とは扱いません。

## 未確認・実行環境の制約

- 通常の `npm run` と `npm run check:completion` の成功。Voltaの書き込み権限がなく、npm配布元への接続も失敗しました。代替Node.jsで各スクリプト本体は成功しています。
- 実サーバーを通す複数クライアントでの移動・向き・追従・アバター変更・入退室・着席の同期。ローカルの標準テスト用DB接続は認証エラー（28P01）となり、Docker APIにも権限がありません。既存の3001番サービスはTonariumの認証APIを提供していませんでした。
- 実アプリ全体でのパネル開閉・画面サイズ変更、マップ三択の操作と再読み込み、ワールド変更のカウントダウン。設定復元の単体テストとfixtureでのワールド切替は成功済みです。
- 実機スマホ、街の線路・駅・電車・アイテム目印、三言語の操作説明の実画面確認。タッチエミュレーションとi18nテストは成功済みです。

Git push、PR作成、リリースは実行していません。
