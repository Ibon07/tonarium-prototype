# Windows版のCIとリリース

`main`へのpushとPull Requestでは `.github/workflows/native-checks.yml` が型チェック、Webビルド、WindowsネイティブUIの通常操作チェック、自己完結型の.NETビルドを実行する。この確認はUnityライセンス、マイク、音声サーバーを必要としない。

`v0.0.1` のようなタグをpushすると `.github/workflows/release-windows.yml` がUnityと.NETを別々にビルドし、一つのWindowsクライアントとしてパッケージする。タグは `main` に含まれるコミットへ付ける。手動実行もでき、その場合はActions Artifactだけを作り、GitHub Releaseは作らない。

## 初回設定：Unity Personal

[リポジトリのActions Secrets](https://github.com/katteni-kaihatu/tonarium-prototype/settings/secrets/actions) に次の3つを登録する。値をソースコードやチャットに記載しない。

- `UNITY_LICENSE`: Unity Hubで認証したPersonalライセンスの `.ulf` ファイルの内容
- `UNITY_EMAIL`: そのライセンスに対応するUnityアカウントのメールアドレス
- `UNITY_PASSWORD`: Unityアカウントのパスワード

`.ulf` のWindowsでの標準保存先は `C:\ProgramData\Unity\Unity_lic.ulf`。作成・取得方法は [GameCIの認証手順](https://game.ci/docs/github/activation/) を参照する。Secretsが不足する場合はUnityジョブが不足する名前を表示して停止し、不完全な2D版をReleaseとして公開しない。

Unityはプロジェクトと同じ `2022.3.22f1`、Monoの `StandaloneWindows64` を使用する。Ubuntu上でGameCIから既存の `WindowsBuild.Build` を呼ぶ。.NET側はWindows runnerで.NET 10を自己完結型としてビルドする。外部ActionはコミットSHAで固定している。

## リリース手順

対象コミットのCI成功と `main` への取り込みを確認した後に実行する。

```bash
git switch main
git pull --ff-only origin main
git tag -a v0.0.1 -m "Tonarium v0.0.1"
git push origin v0.0.1
```

[Actions](https://github.com/katteni-kaihatu/tonarium-prototype/actions) で `Release Windows client` が成功すると、同名の [Release](https://github.com/katteni-kaihatu/tonarium-prototype/releases) に次のファイルが付く。

- `Tonarium-v0.0.1-win-x64.zip`
- `Tonarium-v0.0.1-win-x64.zip.sha256`

ZIPには `Tonarium.exe`、必要な.NET/nativeライブラリー、`Unity/`、ライセンス表記、起動方法の `README.txt`、ビルド元コミットを記録した `release.json` を含む。Unityの実行ファイルがないパッケージは失敗扱いになる。利用者はZIP全体を展開して `Tonarium.exe` を起動する。インストーラーやコード署名は含まない。

失敗した実行は原因を解消してGitHub Actionsの「Re-run failed jobs」で再実行できる。同じタグの成功した再実行では添付ファイルを更新するため、既存の配布物を維持したい場合は新しいタグを使う。

## 手元での同等ビルド

```powershell
./native/build-unity.ps1 -Version 0.0.1
./native/publish-desktop.ps1 -SkipUnity -Version 0.0.1
./native/package-windows.ps1 -Version 0.0.1
```

Unity EditorとWindows Build Supportが必要。出力先は `native/artifacts/releases/`。CIではGameCIの `-customBuildPath` と `-buildVersion` を受け取り、同じC#ビルド処理を使う。
