// Offline UI check: the real controller + local UI, with a fake updater (no install/network).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarium-update-ui-'));
  const config = path.join(temp, 'update-build.json');
  fs.writeFileSync(config, JSON.stringify({ enabled: true, channel: 'nightly' }));
  const server = http.createServer((_req, res) => res.end('<!doctype html><h1>Local test page</h1>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const bootstrap = path.join(temp, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `
    const Module = require('node:module');
    const { EventEmitter } = require('node:events');
    const load = Module._load;
    const fake = new EventEmitter();
    fake.setFeedURL = () => {};
    fake.checkForUpdates = async () => {
      global.updateChecks = (global.updateChecks || 0) + 1;
      fake.emit('update-available', {version:'0.0.9-nightly.2.1'});
      if (fake.autoDownload) fake.emit('update-downloaded', {version:'0.0.9-nightly.2.1'});
      return {};
    };
    fake.quitAndInstall = () => { global.updateInstalled = true; };
    Module._load = function(name, parent, isMain) {
      const result = load.apply(this, arguments);
      if (name === './updater.cjs' && parent?.filename === ${JSON.stringify(path.join(root, 'electron/app/main.cjs'))}) {
        return { createUpdateController: options => result.createUpdateController({
          ...options, app: { isPackaged:true, getPath:key=>options.app.getPath(key), getVersion:()=> '0.0.8' },
          autoUpdater:fake, platform:'linux', env:{APPIMAGE:'/tmp/fake.AppImage'}, buildConfigPath:${JSON.stringify(config)}
        }) };
      }
      return result;
    };
    require(${JSON.stringify(path.join(root, 'electron/app/main.cjs'))});
  `);
  let app;
  const launch = async () => {
    app = await _electron.launch({ executablePath: path.join(root, 'electron/node_modules/electron/dist/electron'),
      args: [bootstrap, '--server', `http://127.0.0.1:${server.address().port}/`, '--data-dir', path.join(temp, 'profile'), '--ozone-platform=x11', '--disable-gpu'] });
  };
  try {
    await launch();
    let updates;
    for (let i = 0; i < 100; i++) {
      updates = app.windows().find(page => page.url().endsWith('/updates.html'));
      if (updates) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(updates, 'first launch prompts for update settings');
    await updates.locator('#save').waitFor();
    assert.equal(await app.evaluate(() => global.updateChecks || 0), 0);
    assert.equal(await updates.locator('#check-on-startup').isChecked(), false);
    assert.equal(await updates.locator('#auto-install').isEnabled(), false);
    await updates.locator('#save').click();
    await updates.waitForFunction(() => document.querySelector('#first').hidden);
    await app.close(); app = undefined;
    await launch();
    const main = await app.firstWindow();
    await main.locator('h1').waitFor();
    assert.equal(await main.evaluate(() => typeof window.tonariumShell), 'undefined');
    assert.equal(await app.evaluate(() => global.updateChecks || 0), 0);
    assert.equal(app.windows().filter(page => page.url().endsWith('/updates.html')).length, 0);
    const next = app.waitForEvent('window');
    await app.evaluate(({Menu}) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === 'アプリの更新…').click());
    updates = await next;
    await updates.locator('#check-on-startup').check();
    await updates.locator('#save').click();
    await updates.locator('#check').click();
    await updates.waitForFunction(() => document.querySelector('#status').textContent.includes('新しい更新'));
    assert.equal(await updates.locator('#install').isVisible(), false);
    await updates.locator('#auto-install').check();
    await updates.locator('#save').click();
    await updates.locator('#check').click();
    await updates.locator('#install').waitFor();
    await app.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response:1}); });
    await updates.locator('#install').click();
    await updates.waitForTimeout(100);
    assert.equal(await app.evaluate(() => global.updateInstalled), true);
    console.log('PASS first-run consent, saved opt-out, check-only, auto update, restart action and remote isolation (fake updater)');
  } finally {
    if (app) await app.close();
    server.closeAllConnections(); server.close();
    fs.rmSync(temp, {recursive:true, force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
