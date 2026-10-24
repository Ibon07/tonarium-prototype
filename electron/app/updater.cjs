const fs = require('node:fs');
const path = require('node:path');

const RELEASE_URL = 'https://github.com/katteni-kaihatu/tonarium-prototype/releases/tag/nightly';
const FEED_URL = 'https://github.com/katteni-kaihatu/tonarium-prototype/releases/download/nightly/';

function createUpdateController({ app, autoUpdater, onChange = () => {}, onNeedsConfiguration = () => {}, platform = process.platform, env = process.env, fetch: fetchUpdate = globalThis.fetch, buildConfigPath = path.join(__dirname, 'update-build.json') }) {
  let build = {};
  try { build = JSON.parse(fs.readFileSync(buildConfigPath, 'utf8')); } catch { /* 開発・旧配布版は更新を無効にする。 */ }
  const available = app.isPackaged === true && build.enabled === true && build.channel === 'nightly';
  const windowsInstalled = platform === 'win32' && fs.existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall Tonarium Electron.exe'));
  const supported = available && (windowsInstalled || (platform === 'linux' && typeof env.APPIMAGE === 'string' && env.APPIMAGE.length > 0));
  const canCheck = available && ['linux', 'win32'].includes(platform);
  const settingsPath = path.join(app.getPath('userData'), 'updates.json');
  let preferences = { checkOnStartup: null, autoInstall: false };
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (typeof saved.checkOnStartup === 'boolean' && typeof saved.autoInstall === 'boolean') {
      preferences = { checkOnStartup: saved.checkOnStartup, autoInstall: saved.checkOnStartup && saved.autoInstall };
    }
  } catch { /* 未設定や破損した設定では自動通信しない。 */ }
  const reason = !available ? 'このビルドでは自動更新を利用できません。' : !supported ? 'この配布形式は自動更新に対応していません。リリースページから更新してください。' : '';
  let current = { status: !available ? 'disabled' : !canCheck ? 'unsupported' : 'idle', version: app.getVersion(), updateVersion: null, downloadedVersion: null, progress: null, error: null };
  let updater;
  let checking;
  let cancellationToken;
  let downloading = false;
  let rearmDownload = false;
  let started = false;
  let disposed = false;
  const listeners = [];

  function state() {
    return { ...current, ...preferences, available, supported, canCheck, reason, needsConfiguration: preferences.checkOnStartup === null, releaseUrl: RELEASE_URL };
  }
  function publish(change = {}) {
    if (disposed) return;
    current = { ...current, ...change };
    onChange(state());
  }
  function failure(error) {
    publish({ status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
  function applyPreferences() {
    if (!updater) return;
    updater.autoDownload = supported && preferences.checkOnStartup === true && preferences.autoInstall;
    updater.autoInstallOnAppQuit = updater.autoDownload;
  }
  function getUpdater() {
    if (updater) return updater;
    updater = typeof autoUpdater === 'function' ? autoUpdater() : autoUpdater;
    if (!updater) throw new Error('更新プログラムを読み込めませんでした。');
    updater.setFeedURL({ provider: 'generic', url: FEED_URL, channel: 'nightly' });
    updater.channel = 'nightly';
    updater.allowPrerelease = true;
    // channel の setter が allowDowngrade を変更するため、最後に設定する。
    updater.allowDowngrade = false;
    applyPreferences();
    const listen = (event, handler) => { updater.on(event, handler); listeners.push([event, handler]); };
    listen('checking-for-update', () => publish({ status: 'checking', error: null, progress: null }));
    listen('update-available', info => publish({ status: 'available', updateVersion: info.version, error: null }));
    listen('update-not-available', () => publish({ status: current.downloadedVersion ? 'downloaded' : 'not-available', error: null }));
    listen('download-progress', progress => publish({ status: 'downloading', progress: Math.max(0, Math.min(100, Number(progress.percent) || 0)) }));
    listen('update-downloaded', info => {
      cancellationToken = undefined;
      applyPreferences();
      publish({ status: 'downloaded', updateVersion: info.version, downloadedVersion: info.version, progress: 100, error: null });
    });
    listen('update-cancelled', () => { cancellationToken = undefined; publish({ status: current.downloadedVersion ? 'downloaded' : current.updateVersion ? 'available' : 'idle', progress: null }); });
    listen('error', failure);
    return updater;
  }

  function configure(value) {
    if (disposed) throw new Error('更新処理は終了しています。');
    if (!available) throw new Error(reason);
    if (!supported && value?.autoInstall) throw new Error(reason);
    if (!value || typeof value.checkOnStartup !== 'boolean' || typeof value.autoInstall !== 'boolean' || (value.autoInstall && !value.checkOnStartup)) {
      throw new Error('自動適用には起動時の更新確認を有効にしてください。');
    }
    const next = { checkOnStartup: value.checkOnStartup, autoInstall: value.autoInstall };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const temporary = `${settingsPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, settingsPath);
    } finally { try { fs.unlinkSync(temporary); } catch { /* rename 後は存在しない。 */ } }
    // A completion racing with OFF may not register the updater's quit hook.
    // Re-check the cached download after re-enabling so its public completion path re-arms it.
    if (next.autoInstall && !preferences.autoInstall && current.downloadedVersion) rearmDownload = true;
    preferences = next;
    applyPreferences();
    if (!next.autoInstall) cancellationToken?.cancel();
    publish();
    return state();
  }

  function check() {
    if (disposed || !canCheck) return Promise.resolve(state());
    if (checking) return checking;
    // 完了済みの更新は保持し、重複ダウンロードを避ける。
    if (downloading || current.status === 'downloading' || (current.downloadedVersion && !rearmDownload)) return Promise.resolve(state());
    checking = Promise.resolve().then(async () => {
      try {
        publish({ status: 'checking', error: null });
        if (!supported) {
          const yaml = require('js-yaml');
          const semver = require('semver');
          const filename = platform === 'linux' ? 'nightly-linux.yml' : 'nightly.yml';
          const response = await fetchUpdate(`${FEED_URL}${filename}`, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
          if (!response.ok) throw new Error(`更新情報を取得できませんでした (HTTP ${response.status})。`);
          const body = await response.text();
          if (body.length > 1024 * 1024) throw new Error('更新情報が大きすぎます。');
          const info = yaml.load(body, { schema: yaml.JSON_SCHEMA });
          if (!info || typeof info.version !== 'string' || !semver.valid(info.version)) throw new Error('更新情報のバージョンが不正です。');
          const newer = semver.gt(info.version, app.getVersion());
          publish({ status: newer ? 'available' : 'not-available', updateVersion: newer ? info.version : null, error: null });
          return state();
        }
        rearmDownload = false;
        const result = await getUpdater().checkForUpdates();
        if (disposed) return state();
        cancellationToken = result?.cancellationToken;
        if (!preferences.autoInstall) cancellationToken?.cancel();
        if (result?.downloadPromise) {
          downloading = true;
          // ダウンロードは更新確認の Promise と別に失敗する。
          result.downloadPromise.catch(error => { if (!disposed && !result.cancellationToken?.cancelled) failure(error); }).finally(() => { downloading = false; });
        }
      } catch (error) { failure(error); }
      finally { checking = undefined; }
      return state();
    });
    return checking;
  }

  function install() {
    if (disposed || !supported || !current.downloadedVersion) return false;
    try {
      getUpdater().quitAndInstall(false, true);
      return true;
    } catch (error) { failure(error); return false; }
  }

  async function start() {
    if (started || disposed) return state();
    started = true;
    publish();
    if (!canCheck) return state();
    if (preferences.checkOnStartup === null) {
      onNeedsConfiguration(state());
      return state();
    }
    if (preferences.checkOnStartup && canCheck) return check();
    return state();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (updater) {
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      cancellationToken?.cancel();
      for (const [event, listener] of listeners) updater.removeListener(event, listener);
    }
  }

  return { state, configure, check, install, start, dispose };
}

module.exports = { createUpdateController, RELEASE_URL, FEED_URL };
