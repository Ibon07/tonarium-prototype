# Unity canvas performance

2026-10-21、Windows / Unity 2022.3.22f1 の Player で比較。

## 条件

- 32本×80点の既存履歴（色ペンと消しゴムを含む）
- 1本の線へ3点ずつ120回追加
- 実際の `Receive` → `ApplyDelta` →描画面更新を計測
- 修正後の遅延アップロードも、各測定内で `LateUpdate` を呼んで含める

`before.json` と `after.json` に個別サンプルと描画整合性チェックを保存する。CPU側の処理比較であり、表示FPS、ネットワーク遅延、物理マウス入力の計測ではない。非表示の検証プレイヤーではフレーム待ちやGPU表示条件が通常ウィンドウと異なるため、`frameMilliseconds` はFPS評価に使用しない。Monoの割り当てバイト数APIはこの環境で常に0を返したため、メモリー評価にも使用しない。

## 確認内容

- 色、線幅、クリッピング、消しゴム、複数の線への交互追記が全再描画と一致
- 修正前後の `canvas-history.png` と `canvas-correctness.png` のSHA-256が一致
- 描画面とテクスチャを再利用
- ローカル開始・追記は送信やACKより前に反映
- 自分のACKで点が増えず、遅いクリアACKで新しい線が消えない
- 全体更新を挟んでも送信待ち・未送信の線を維持
- ツールバーだけの更新で絵が変わらない
- `roundtrip.json`: 通常のネイティブ送受信・消去・逆方向・再参加の一致
- `native-ui.json`: 2Dの実コントロール入力・50ms一括送信・最後の点・点だけの描画
- `item-parity.json`: 既存の3Dアイテム描画・キャンバス更新

## 再実行

```powershell
./native/build-unity.ps1
./native/build/unity/Tonarium3D.exe --tonarium-canvas-perf --tonarium-output native/artifacts/canvas-perf -screen-fullscreen 0 -screen-width 800 -screen-height 600 -logFile native/artifacts/canvas-perf/player.log
```

結果に `ok: true` があることを確認する。プローブは一時キャンバスを作るだけで、サーバーへ参加せず終了する。通常起動時には実行しない。
