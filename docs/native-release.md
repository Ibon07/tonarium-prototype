# Windows版のCIとリリース

Windowsクライアントは手元でUnityと.NETをビルドし、完成したZIPをGit LFSへコミットする。タグのpushでGitHub Actionsがコミット済みのZIPを検証してReleaseへ添付する。CIでUnityをビルドしないため、Unityのアカウント情報やライセンスをGitHubへ登録する必要はない。

`main`へのpushとPull Requestでは、`native/**`・`packaging/**`・Nativeが直接取り込む `client/public/brand/**` と `client/public/oekaki/sample.png`・チェック用ワークフロー自身の変更がある場合に `.github/workflows/native-checks.yml` が型チェック、Webビルド、WindowsネイティブUIの通常操作チェック、自己完結型の.NETビルドを実行する。マイク、音声サーバー、Unityライセンスは使用しない。Electronや通常のWeb画面だけの変更では実行しない。nightly公開処理のテストは、関連するワークフロー・スクリプトの変更時に `nightly-checks.yml` で独立して実行する。どちらも手動実行できる。

## 1. 手元でビルドする

Unity 6000.6.7f1とWindows Build Support、.NET 10、Node.jsが必要。先にソース変更をコミットし、そのコミットからビルドする。

```powershell
./native/build-unity.ps1 -Version 0.0.1
./native/publish-desktop.ps1 -SkipUnity -Version 0.0.1 -OutputDirectory native/artifacts/release/Tonarium-win-x64
./native/package-windows.ps1 -Version 0.0.1 -InputDirectory native/artifacts/release/Tonarium-win-x64 -OutputDirectory releases/windows/v0.0.1
Copy-Item native/artifacts/release/Tonarium-win-x64/release.json releases/windows/v0.0.1/release.json
```

ZIPには `Tonarium.exe`、必要な.NET/nativeライブラリー、`Unity/`、ライセンス表記、起動方法の `README.txt`、ビルド元コミットを記録した `release.json` を含む。起動と2D/3Dを確認してからコミットする。利用者はZIP全体を展開して `Tonarium.exe` を起動する。インストーラーやコード署名は含まない。

## 2. ビルドをコミットする

ZIPは100MBを超えるため、`.gitattributes` で `releases/windows/**/*.zip` をGit LFSの対象としている。Git LFSを導入してから操作する。`.sha256` と `release.json` は通常のGitで管理する。

```bash
git lfs install --local
git add releases/windows/v0.0.1
git commit -m "Add Windows client v0.0.1 build"
git push
```

`release.json` の `commit` はビルド元のソースコミット。ZIPを追加した後のコミットとは異なる。Unityが書き換えたシーンやバージョン設定を意図せず混ぜないよう、コミット内容を確認する。

## 3. mainへ取り込んでタグをpushする

Pull RequestのCI成功と `main` への取り込みを確認した後に実行する。

```bash
git switch main
git pull --ff-only origin main
git tag -a v0.0.1 -m "Tonarium v0.0.1"
git push origin v0.0.1
```

`.github/workflows/release-windows.yml` はタグが `main` に含まれること、ZIPのSHA-256、バージョン、ビルド元コミット、Unityを含むZIP内容を確認する。Git LFSの取得や検証が失敗した場合は公開しない。

[Actions](https://github.com/katteni-kaihatu/tonarium-prototype/actions) の `Release Windows client` が成功すると、[Release](https://github.com/katteni-kaihatu/tonarium-prototype/releases) に次が添付される。

- `Tonarium-v0.0.1-win-x64.zip`
- `Tonarium-v0.0.1-win-x64.zip.sha256`
- `release.json`

手動再実行は対象のタグを選ぶ。同じタグを再実行した場合は添付を同じコミットの内容で更新する。変更したビルドを配布する場合は新しいバージョンを使用する。Git LFSとGitHub Releasesには各サービスの保存容量・帯域制限が適用される。

## Native / Electron nightly

`.github/workflows/native-nightly.yml`（Actionsの表示名は `Nightly clients`）は `main` へのpushと、mainを選んだ手動実行で起動する。毎晩の時刻指定ではなくmain更新ごとの継続ビルド。

Native Linux、Native Windows、Electron Linux、Electron Windowsの4ジョブを並列で実行し、各ジョブが成功した成果物をそのまま `nightly` prereleaseへ公開する。他のクライアント・OSの終了は待たず、失敗によるキャンセルもしない。後続のmain更新でもElectronはNativeの完了を待たない。同じクライアント・OSの実行だけを直列化し、同名ファイルへの同時書き込みを避ける。

NativeはUbuntu runner上でUnityのWindows/Linux Monoプレイヤーと.NET 10の自己完結クライアントをビルドする。Unityの版は `ProjectVersion.txt` を使用する。Actions Secretsに `UNITY_EMAIL`・`UNITY_PASSWORD` と `UNITY_LICENSE`（Personal）または `UNITY_SERIAL`（Pro）が必要。[GameCIの認証手順](https://game.ci/docs/github/activation/)を参照。認証未設定やUnityビルド失敗でもElectronのビルド・公開は継続する。

Electronは別のUbuntu runnerで `electron/package-lock.json` から依存を導入し、Linux AppImage／tar.gzとWindows zipを作る。Unityや.NET、Web本体のビルドは不要。リモートWebの更新は再読み込みで反映する。

公開先は全ジョブで同じ `nightly` prerelease。以下の固定名で、自分の成果物だけを置換する。

- Native: `Tonarium-nightly-linux-x64.tar.gz`、`Tonarium-nightly-win-x64.zip`
- Electron: `Tonarium-Electron-nightly-linux-x64.tar.gz`、`Tonarium-Electron-nightly-linux-x86_64.AppImage`、`Tonarium-Electron-nightly-win-x64.zip`
- 各ファイルの `.sha256`
- 各クライアント・OSの `Tonarium-Native-nightly-<runtime>.build.json` または `Tonarium-Electron-nightly-<runtime>.build.json`

`.build.json` は対応アーカイブの公開が全て成功してから更新し、ソースコミット、Actions実行URL、チェックサムを記録する。失敗・未完了の側は前回成功した成果物と記録を残すため、Release内の全ファイルが同じコミットとは限らない。ダウンロードする種類の `.build.json` を確認する。アップロード中はアーカイブとチェックサムの置換が完了するまで待つ。

公開前にmainが先へ進んでいた場合は古いビルドの公開を省略する。mainを頻繁に更新している間は、時間のかかるNativeの更新が後回しになる場合がある。`nightly` タグは巻き戻さず、安定版のLatestにはしない。初回Release作成が競合しても、他ジョブが作成済みなら自分のアップロードを続ける。

Nativeの展開先は `win-x64/`・`linux-x64/`。`Unity/` とビルドコミットを記録した `release.json` を含む。Linux Native版は通常配布と同じシステム依存が必要で、AppImage/Flatpakではない。既存のバージョンタグ向けWindows Release workflowは維持する。

ローカルでも `python3 native/package-nightly.py linux-x64 <dotnet publish先> native/build/unity-linux <出力先>`（Windowsは `win-x64` と `native/build/unity`）で同じ梱包を行える。公開処理の回帰テストは `python3 .github/scripts/test_publish_nightly.py`。このテストはGitHub APIをモックし、実際のReleaseを書き換えない。
