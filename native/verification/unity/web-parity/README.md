# Web 3D と Windows Unity の表示確認

2026-10-21。Web の実装・元アセットを基準に、Unity プレイヤーと Windows 配布版で確認。

- `cafe.png` / `room.png` / `game.png`: 3 ワールド。家具、階層、床、ガラス、照明、アイテムの大きさ。
- `note.png` / `note-back.png` / `canvas.png`: 文字の表裏、長文の収まり、パネル比率。
- `native-fullscene.png` / `native-menu.png`: 全画面 Unity と共通ネイティブ UI、ホームシート。
- `avatar-checks.json`: 元モデル・アニメーション・寸法・配信画面の 10 チェック。
- `item-checks.json`: 付箋・キャンバス・2048・チェス・サイコロ・カメラ・ハンマーの 10 チェック。
- `world-checks.json`: 3 ワールドの切り替え・同期・移動・終了。
- `native-ui-checks.json`: 共通 UI の通常操作 63 チェック。
- `overlay-checks.json`: クリックの透過先、移動・リサイズ・最小化・復帰、子ウィンドウのフォーカス。
- `embedded-checks.json`: Unity 埋め込み、ホームシートを閉じた後の同一プレイヤー復帰、リサイズ。

Windows 配布版を実際に操作し、クリックによる操作開始、W の移動、Esc の解除、F2 から 2D への復帰も確認した。Unity が先に終了する経路で接続破棄が復帰を止めていた問題を修正済み。

YouTube の Unity 内表示はサムネイル。動画再生は共通ネイティブパネルで行う。全ての Web 機能が同一実装になったことを示す記録ではない。
