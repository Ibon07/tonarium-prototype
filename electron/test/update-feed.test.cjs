const { test } = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const { GenericProvider } = require('electron-updater/out/providers/GenericProvider');
const { FEED_URL } = require('../app/updater.cjs');

for (const [platform, channel, artifact] of [
  ['linux', 'nightly-linux.yml', 'Tonarium-Electron-0.0.9-nightly.10.1-linux-x86_64.AppImage'],
  ['win32', 'nightly.yml', 'Tonarium-Electron-0.0.9-nightly.10.1-win-x64-setup.exe'],
]) {
  test(`existing ${platform} updater resolves commit assets through the unchanged nightly feed`, async () => {
    const tag = 'nightly-' + 'a'.repeat(40);
    const url = `https://github.com/katteni-kaihatu/tonarium-prototype/releases/download/${tag}/${artifact}`;
    const info = { version: '0.0.9-nightly.10.1', files: [{ url, sha512: Buffer.alloc(64, 1).toString('base64'), size: 123 }],
      path: url, sha512: Buffer.alloc(64, 1).toString('base64'),
      releaseUrl: `https://github.com/katteni-kaihatu/tonarium-prototype/releases/tag/${tag}` };
    const provider = new GenericProvider({ provider: 'generic', url: FEED_URL, channel: 'nightly' },
      { channel: 'nightly', isAddNoCacheQuery: false }, { platform, executor: {} });
    provider.httpRequest = async requested => {
      assert.equal(requested.href, FEED_URL + channel);
      return yaml.dump(info);
    };
    const parsed = await provider.getLatestVersion();
    assert.equal(parsed.releaseUrl, info.releaseUrl);
    assert.equal(provider.resolveFiles(parsed)[0].url.href, url);
    assert.equal(provider.resolveFiles(parsed)[0].info.sha512, info.files[0].sha512);
    // Legacy metadata remains readable during the transition.
    assert.equal(provider.resolveFiles({ ...info, files: [{...info.files[0], url:artifact}], path:artifact })[0].url.href, FEED_URL + artifact);
  });
}

test('Windows missing old commit blockmap falls back to the complete installer with checksum options', async t => {
  // コンストラクターを呼ばず、Electron バイナリ不要で配布ライブラリの取得処理を検証する。
  const { AppUpdater } = require('electron-updater/out/AppUpdater');
  const { NsisUpdater } = require('electron-updater/out/NsisUpdater');
  const fsExtra = require('fs-extra');
  const { gzipSync } = require('node:zlib');
  const oldVersion = '0.0.9-nightly.9.1';
  const version = '0.0.9-nightly.10.1';
  const release = 'https://github.com/katteni-kaihatu/tonarium-prototype/releases/download/nightly-' + 'b'.repeat(40);
  const installerUrl = `${release}/Tonarium-Electron-${version}-win-x64-setup.exe`;
  const checksum = Buffer.alloc(64, 3).toString('base64');
  const info = { version, files: [{ url: installerUrl, sha512: checksum }] };
  const provider = new GenericProvider({ provider: 'generic', url: FEED_URL, channel: 'nightly' },
    { channel: 'nightly' }, { platform: 'win32', executor: {} });
  const blockmapRequests = [];
  const fullDownloads = [];
  const downloadOptions = { sha512: checksum };
  // 新blockmapのキャッシュ書込みと旧キャッシュ確認だけを差し替え、ファイルを変更しない。
  t.mock.method(fsExtra, 'outputFile', async () => {});
  t.mock.method(fsExtra, 'pathExists', async () => false);
  const context = {
    app: { version: oldVersion },
    _logger: { info() {}, warn() {}, error() {} },
    listenerCount: () => 0,
    downloadedUpdateHelper: { cacheDir: '/unused-cache', cacheDirForPendingUpdate: '/unused-pending' },
    executeDownload: options => {
      assert.equal(options.fileInfo.info.sha512, checksum);
      return options.task('/unused-installer.exe', downloadOptions);
    },
    differentialDownloadInstaller: AppUpdater.prototype.differentialDownloadInstaller,
    httpExecutor: {
      downloadToBuffer: async url => {
        blockmapRequests.push(url.href);
        if (url.href === installerUrl + '.blockmap') return gzipSync(JSON.stringify({ version: '2', files: [] }));
        assert.equal(url.href, `${release}/Tonarium-Electron-${oldVersion}-win-x64-setup.exe.blockmap`);
        throw Object.assign(new Error('Old blockmap: HTTP 404'), { statusCode: 404 });
      },
      download: async (url, _destination, options) => fullDownloads.push({ url: url.href, options }),
    },
    verifySignature: async () => null,
  };
  await NsisUpdater.prototype.doDownloadUpdate.call(context, {
    updateInfoAndProvider: { provider, info }, disableWebInstaller: true,
  });
  assert.equal(blockmapRequests.length, 2);
  assert.equal(fullDownloads.length, 1);
  assert.equal(fullDownloads[0].url, installerUrl);
  assert.equal(fullDownloads[0].options, downloadOptions);
  assert.equal(fullDownloads[0].options.sha512, checksum);
});
