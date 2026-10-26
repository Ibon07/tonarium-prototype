# VRの座標変換と回帰確認（2026-10-27）

対象: `katteni-kaihatu/tonarium-prototype`、調査開始時HEAD `72a01b9`。#272はローカル履歴のマージ `648b035`「WebXRの頭・手同期とVR内パネル・操作UIの改善」と、その実装コミット `6479562` の差分で確認した。GitHub上の本文・コメントはWeb取得失敗、CLIの設定ファイルへのアクセス拒否により未確認。現在のworktreeには対象VR実装が存在する。開始時に確認できた既存差分は配布ZIPのみで、ソースの未完了差分はなかった。ZIPは変更していない。Git LFSの一時ディレクトリが書込不可のため、状態と差分の確認時のみLFSフィルタを無効化した。

## 変換経路と階層

`T`をアバターの床位置、`R`をスティック旋回のY回転、`I`を開始時の頭のlocal-floor座標、`E`を目の高さとする。原点リグの移動量は `O = T + R × ((0,E,0) - I)`。追跡点`p`の世界座標は `O + R × p`、姿勢は `R × q`。頭の実移動は初期位置との差として保持する。

| 経路 | 親子階層と適用する変換 |
| --- | --- |
| 視点 | scene → XRScene.origin → 通常camera。WebXRManagerがlocal-floorの頭・左右眼の行列へorigin.matrixWorldを適用する。XRの描画用ArrayCameraと左右眼カメラは親を持たず、matrixWorldへ世界変換が直接設定される |
| コントローラ・レーザー | scene → origin → targetRaySpaceのcontroller → -Z向きのLine。世界レイの始点・方向は同じcontroller.matrixWorldから取得。レーザー長と丸印には同じPanelSurfaces.hitの距離・交点を使う |
| アバターの頭・左右手 | viewerPose / gripSpace → avatarTrackingPose → xr.pose → Avatar3D → body → 床補正 → motion → 縮尺・Y軸180°回転済みモデル → 頭・手。送信前に頭のyawを除き、Avatar3Dの`rigYaw + headYaw`で戻す。applyTrackedPoseでアバタールートから世界座標、実際のモデル親のローカル座標へ変換する |
| UI選択 | 世界レイ → 最新のpanel.group / HTMLMeshの世界行列 → 交点UV → 元DOMの矩形座標 → TerminalPointer。描画用レーザーと別の方向や原点を計算しない |
| DOMパネル | scene → panel.group → HTMLMesh。生成時の描画カメラの世界位置とロールを除いた姿勢から配置。左腕以外は配置後に世界固定、グラブ中のみコントローラの世界行列×取得時オフセットに追従 |
| 3D吹き出し・ラベル | 対象物・参加者のgroup → Label(sprite)。位置は各生成箇所のローカル座標に従い、向きは描画中の眼カメラに対面。画面内のロールを相殺する |

Playerは従来どおり左スティックを`look.yaw + headYaw`で移動へ変換し、右スティックのスナップ／スムース旋回をlook.yawへ加算する。Playerの更新後にXRSceneがoriginを配置し、UI・レイを更新する。追跡中はアバター全体へキーボード由来のleanを重ねず、頭・手の実姿勢を優先する。通常3Dのleanと移動計算は維持する。保持物は保持した側のcarryRayを使う。

## コードから確認した原因と修正

1. `PanelSurfaces.place`は親のないXR描画カメラへ`getWorldPosition`、`uprightQuaternion`と`Label.onBeforeRender`は`getWorldQuaternion`を呼んでいた。これらは世界行列を再計算するため、WebXRManagerが設定したリグ込みのmatrixWorldを追跡空間のmatrixから上書きしうる。位置・向きの取得をmatrixWorldの読取りへ変更し、眼カメラの行列も変更しないようにした。リグの移動・旋回が失われると、UI位置と手・レーザーの世界位置が一致しなくなる経路になる。
2. `PanelSurfaces.hit`はレイキャスト前に行列を更新していなかった。パネル新規生成、手首追従、グラブ直後は、描画で更新されるまで過去の行列で選択される。候補パネルと子メッシュの行列を判定前に更新する。
3. `OekakiAvatar`の追跡基準は階層の段数で求めたbodyだった。追跡座標はアバター全体が基準なので、bodyの被打撃スケールなどが加わるとずれる。Avatar3Dから実際の追跡ルートを明示し、モデル親へ変換する。モデル縮尺や180°回転はその逆変換で扱う。
4. B/Y処理は当該フレームで生成したxr.pose・headYawまで初期化していた。表示開閉時は入力・保持・ドラッグを解除しつつ追跡を保持する。終了・非表示・切断では従来どおり追跡も解除する。

以上はコード上の原因候補と修正であり、Quest 3で報告された症状の原因確定ではない。Three.jsの行列管理は[公式WebXRManager実装](https://github.com/mrdoob/three.js/blob/dev/src/renderers/webxr/WebXRManager.js)のupdateCamera / updateUserCameraも参照した。依存パッケージが未導入のため、参照した公開dev版とロックされた依存版の実行比較は未実施。

## 吹き出し・浮動UIの全生成経路と配置仕様

「吹き出し」を発言表示だけに限定せず、VR中のラベル・浮動ボード・DOM表示面を含めて棚卸しした。以下は現行コードから読み取った仕様で、各種類の実機結果はすべて未確認。

| 種類 | 生成箇所 | 配置・追従仕様 |
| --- | --- | --- |
| 2D参加者・他の3D参加者の発言 | View3D.ChatBubble → Label | 参加者ルートの`height + .54`、直近30秒、空白整理・32文字まで。本人の3D発言は非表示。頭の実追跡点そのものではなく参加者ルートの高さへ追従 |
| 名前・ミュート表示 | View3D.Standee / Avatar3D → Label | 参加者ルートの`height + .22`。歩行・着席・保持・縮小は参加者ルートに従う |
| エモートのキャプション・4粒子 | Emote3D.Reaction → Label | 参加者ルート基準。通常はキャプションY=1.95、粒子Y=1.4にアニメーション。低減設定では静止。portraitは専用の縮小位置 |
| チェス・AIチェスの状態、操作・リセット | itemModels / items3d → Label | テーブル・操作メッシュのローカル座標。状態Y=1.5、メッセージY=1.28、各ボタン上+.14 |
| 2048・Canvas等のパネル名 | itemModels.PanelStand → Label | 盤面上端+.18。親アイテムの移動・回転に追従 |
| 画像・動画等のボード名 | items3d → Label | `BOARD_Y + h/2 + .18`、親アイテムに追従 |
| サイコロ結果・スタンド名 | dice3d → Label | 各ダイスの床上座標、台上`STAND_Y + .55`。結果はダイスごとの位置 |
| お絵描き伝言の名前・進行 | telephone3d → Label | アイテム基準Y=1.2と`[0,.7,.16]` |
| 配信者・注釈者名 | shareDisplay → Label | 配信画面上端+.16 / +.11、注釈者名は画面寸法に比例する位置。画面の移動・回転へ追従 |
| カメラのモニター | camera3d.CamMonitor → UprightBillboard | カメラ設置位置または参加者の指定位置。位置は対象へ追従し、世界姿勢からロールを除いて視点に対面 |
| AD次元・モック設備・コア・祭壇・Crunch・銀河・ジオラマ名 | antimatterLab → Label | それぞれ塔の高さ+1.4、Y=1.75 / 2.6 / 1.5 / 2.3 / .7 / 2.2。設備・研究所ルート基準 |
| ADポータル名 | antimatterItem3d → Label | アイテム基準Y=1.95 |
| AD次元ボード | antimatterLab → antimatterPanels.PanelBoard | 次元ごとのx,zと塔の高さ+1.9。位置は設備基準、世界姿勢のロールを除いて視点に対面。ボードの選択から前面操作画面を開く |
| 都市の階名・階ボタン・駅名・マンション名 | city3d → Label | 各階・駅の生成座標に固定。階ボタンはボタン親基準 |
| ゲームのステージ名・参加人数・開始案内 | game3d → Label | アリーナの各段、ロビー設備・開始ボタンの指定座標 |
| サバイバーの施設名・扉・プレイヤーLv・入口 | survivors3d → Label | 各施設ルートY=2.1 / 1.5、プレイヤーY=1.12、入口`[0,2.2,-8]` |
| 共有アセット名 | shared-assets/SharedAssets3D → Label | プレースホルダーの`p.scale + .3`。アセット配置に追従 |
| 共有システムのオブジェクト・アイテム操作名 | systems/SystemObjects3D / SystemItem → Label | オブジェクト上端+.25、アイテムのx,zとY=1.5（カメラ1.95）。各生成親に従う |
| 共有システムのタイマー文字 | systems/demo-models → UprightBillboard + Label | システム配置基準の`[0,.05,.14]`、ロールを除いて視点に対面 |
| 開発・マーケットのプレビュー名 | systems/SystemPlaytest / market/Preview3D → Label | 開発用役名、伝言名、サイコロ名。通常セッションのVR生成経路外だが同じLabel修正の影響範囲 |
| 上部の顔の発言 | world/FaceStrip `.bubble` | 元DOMの顔枠内に絶対配置。3DのChatBubbleとは別で、直接空間スプライト化しない |

DOM表示面は`PanelSurfaces.refresh`が次の全入口から登録する。共通仕様は、生成時の視点から配置して世界固定、グリップ中は追従、離すと固定。B/Yはutility以外をまとめて表示・非表示にし、配置は保持する。個別に閉じて一覧から再表示すると視点基準で再配置する。

| 登録入口 | 全種別 | 位置・追従の例外 |
| --- | --- | --- |
| WindowLayerの`data-xr-surface` | 画面共有、視点配信、カメラ配信、参加者の顔、画像、動画、YouTube、付箋、サイコロ、お絵描き伝言、バイク、反物質、共有システム操作、チェス、AIチェス、2048、Canvas、サバイバー、図鑑、AD研究所、AD空間設定 | 共通の生成位置は`[(表示枚数%3-1)*.7,0,-1.25]`をロール除去済みの視点姿勢で回したオフセット |
| SOURCES | nearlist、noticelog、worldbadge、dock、hoverlay、survivor-panel.overlay | 近くの一覧、チャット・通知、通話設定、マイク・音・エモート、ホーム、サバイバーHUD。ホーム以外は一覧から表示 |
| 自動ダイアログ検出 | modalbg、popover、lightbox、survivor-choice-overlay | プロフィール編集・参加者プロフィール、ワールド変更、セッション作成・編集、ステータス、アイテム追加、確認・外部リンク確認、画像拡大、設定・音量・音・エモート、サバイバー選択。既に登録済みの面の内側は二重登録しない |
| 個別の追加面 | View3D.NoteEditorのnote-editor、AntimatterPanelのad-offline | 付箋編集、ADオフライン報酬。共通の配置・B/Y規則 |
| XRControlsのutility 6種類 | wrist、tools、help、keyboard、commands、options | 初期視点オフセットは順に`[-.55,-.2,-.8]`、`[.8,.15,-1.25]`、`[-.8,.05,-1.25]`、`[0,-.7,-1.1]`、`[.8,-.55,-1.25]`、`[0,.25,-1.05]`。wristのみ左gripの`[.02,.12,-.05]`へ毎フレーム追従し、X軸-90°回転。左gripがなければ最後の配置を維持。wristはグラブ不可。残りは世界固定・グラブ可。B/Yでも残る |

## 今回の検証結果と残る確認

環境: Windows PowerShell、ヘッドセット・左右コントローラなし、node_modulesなし。Questブラウザの版は取得できていない。

| 検証 | 今回の結果 |
| --- | --- |
| #272のローカル差分・現行コード・全生成入口の調査 | 実施。上記の変換経路と原因候補を確認 |
| `git diff --check`（LFSフィルタ無効化） | 成功 |
| 作業別履歴JSONのPowerShellでの読取り | 成功。正式な履歴検査は未実施 |
| `npm run check:completion` | Voltaが通常のランタイムディレクトリを作成できず起動前に失敗。履歴検査・翻訳検査・型チェック・ビルドは未実施 |
| `npm run test:xr` | 同じVolta権限エラーで起動前に失敗 |
| `node scripts/test-xr-browser.mjs` | 同じVolta権限エラーで起動前に失敗。ブラウザ模擬試験は未実施 |
| Quest 3 / Questブラウザの受け入れ条件すべて | **未確認**。自動試験の追加・コード確認を実機確認の代わりにしない |

追加した`pose.test.ts`は、親のないXR描画カメラの世界行列を保持すること、リグ平行移動・Y旋回・頭と左右手の3軸移動と回転、モデル親のオフセット・縮尺・180°回転、同じレイの描画終点と面の中央UVを確認する。ブラウザ模擬試験には、B/Y用入力解除時の姿勢保持、移動・旋回済みのXRカメラによるパネル生成、描画前の手首UIの最新ヒット判定を追加した。いずれも今回未実行。

実行可能な環境で`npm ci`後、`npm run test:xr`、`node scripts/test-xr-browser.mjs`（Playwrightが必要）、`npm run test:movement`、`npm run test:camera`、`npm run check:completion`を実行する。その後、Quest 3で次を確認し、機器・ブラウザ版・コミット・ワールド・各結果を記録する。

1. QuestブラウザでHTTPSのセッションへ参加し、クライアントモードからVR開始。直後にBを押し、閉じた場合はもう一度Bで表示する（初期open=trueのため最初のBは閉じる）。手・左右レーザー・左腕UI・通常パネルの位置と向きを記録する。
2. 頭と左右の手をそれぞれ前後・左右・上下へ動かし、yaw/pitch/rollを変える。左右の取り違え・反転・頭だけに手が追従する現象・B開閉時の瞬間的なずれがないか確認する。
3. 左右それぞれで同じUIの中央・四隅・小さい項目を狙い、レーザー終点と丸印と選択項目を照合する。グラブ移動直後・手首UIの移動中にもクリック・ドラッグ・スクロールを確認する。
4. 上記棚卸しの全種類を対応ワールド・参加者・アイテム・発言・エモートで生成し、生成位置・対象への追従・ロール除去・世界固定・グラブ・解除・B表示切替を種類別に記録する。
5. 左スティックの前後左右移動、左右スナップ／スムース旋回、ジャンプ、飛行、バイク、物・参加者・配信画面の保持を確認する。移動・旋回後に2〜4を繰り返し、VR終了後の通常3Dも確認する。

受け入れ条件はすべて実機確認待ちで、完了チェックも未完了。現時点では修正完了・動作保証とは扱わない。
