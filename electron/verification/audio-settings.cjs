// Local fixture only. Fake microphones; no production server or recording transmission.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const root = path.resolve(__dirname, '../..');
 const legacy=path.join(root,'client/public/.audio-legacy.html');
 fs.writeFileSync(legacy,'<!doctype html><title>Legacy Web fixture</title>');
 const vite = spawn(process.execPath, [path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5189','--strictPort'], {cwd:root,stdio:'ignore'});
 let app;
 try {
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:5189')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  app = await _electron.launch({executablePath:process.env.ELECTRON_BINARY||path.join(root,'electron/node_modules/electron/dist/electron'),args:[path.join(root,'electron/app/main.cjs'),'--server','http://127.0.0.1:5189','--data-dir',path.join(root,'electron/build/verification/audio-profile'),'--ozone-platform=x11','--use-fake-device-for-media-stream','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  const page=await app.firstWindow();await page.waitForSelector('#joinname');
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='マイク・スピーカー…').click());
  await page.getByRole('dialog',{name:'マイク・スピーカー'}).waitFor();
  await page.getByRole('button',{name:'マイクを許可して機器名を表示'}).click();
  await page.waitForFunction(()=>document.querySelector('select').options.length>1);
  console.log('Output device options:', await page.locator('select').nth(1).locator('option').allTextContents());
  const values=await page.locator('select').first().locator('option').evaluateAll(options=>options.map(o=>o.value));
  const microphone=values.find(Boolean);assert.ok(microphone);
  await page.locator('select').first().selectOption(microphone);
  await page.waitForFunction(id=>JSON.parse(localStorage.getItem('tonarium.audioDevices')).input===id,microphone);
  await page.reload();await page.waitForSelector('#joinname');
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='マイク・スピーカー…').click());
  assert.equal(await page.locator('select').first().inputValue(),microphone);
  assert.equal(await page.evaluate(()=>typeof require),'undefined');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.setBypassServiceWorker',{bypass:true});
  await page.goto('http://127.0.0.1:5189/.audio-legacy.html');
  assert.equal(await page.title(),'Legacy Web fixture');
  await app.evaluate(({dialog})=>{globalThis.audioNotice=null;dialog.showMessageBox=async(_window,options)=>{globalThis.audioNotice=options.message;return {response:0};};});
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='マイク・スピーカー…').click());
  for(let i=0;i<30&&!await app.evaluate(()=>globalThis.audioNotice);i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(await app.evaluate(()=>globalThis.audioNotice),'接続先Webの更新が必要です');
  console.log('PASS Electron menu/shared audio settings, fake device dropdown, persistence, sandbox API boundary, legacy-Web update notice');
 }finally{if(app)await app.close();vite.kill('SIGTERM');fs.rmSync(legacy,{force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
