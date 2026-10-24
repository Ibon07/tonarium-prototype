# Windows版のCIとリリース

Windowsクライアントは手元でUnityと.NETをビルドし、完成したZIPをGit LFSへコミットする。タグのpushでGitHub Actionsがコミット済みのZIPを検証してReleaseへ添付する。CIでUnityをビルドしないため、Unityのアカウント情報やライセンスをGitHubへ登録する必要はない。

`main`へのpushとPull Requestでは `.github/workflows/native-checks.yml` が型チェック、Webビルド、WindowsネイティブUIの通常操作チェック、自己完結型の.NETビルドを実行する。マイク、音声サーバー、Unityライセンスは使用しない。

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

## Windows / Linux nightly

`.github/workflows/native-nightly.yml` は `main` へのpush（PRマージを含む）と、mainを選んだ手動実行で起動する。毎晩の時刻指定ではなく、main更新ごとの継続ビルド。Ubuntu runner上でUnityのWindows/Linux Monoプレイヤーと.NET 10の自己完結クライアントをビルドする。Unityのバージョンは `ProjectVersion.txt` を使用する。

実行するリポジトリのActions Secretsに `UNITY_EMAIL`・`UNITY_PASSWORD` と `UNITY_LICENSE`（Personal）または `UNITY_SERIAL`（Pro）を設定する。[GameCIの認証手順](https://game.ci/docs/github/activation/)を参照。未設定の場合はビルドを失敗として明示する。forkと上流ではSecretsをそれぞれ設定する必要がある。

両OSのビルドとチェックサム検証に成功した場合にのみ、`nightly` タグをそのコミットへ移動し、同名のprereleaseへ以下を配置・上書きする。安定版のLatestにはしない。実行中にmainが先へ進んだ場合、古い実行はReleaseを更新しない。

- `Tonarium-nightly-win-x64.zip`
- `Tonarium-nightly-linux-x64.tar.gz`
- 各ファイルの `.sha256`

展開先は `win-x64/`・`linux-x64/`。いずれも `Unity/` とビルドコミットを記録した `release.json` を含む。Linux版は通常配布と同じシステム依存が必要で、AppImage/Flatpakではない。既存のバージョンタグ向けWindows Release workflowはそのまま維持する。

ローカルでも `python3 native/package-nightly.py linux-x64 <dotnet publish先> native/build/unity-linux <出力先>`（Windowsは `win-x64` と `native/build/unity`）で同じ梱包処理を実行できる。中間ファイルは `native/build/`、配布アーカイブは `native/artifacts/` に分ける。
