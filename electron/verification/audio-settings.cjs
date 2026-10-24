// Local Web and fake devices only; no production connection or physical recording.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const root = path.resolve(__dirname, '../..');
 const output = path.join(root,'electron/build/verification/audio-settings');
 const profile = path.join(output, `profile-${process.pid}`);
 fs.mkdirSync(output,{recursive:true});
 const vite = spawn(process.execPath, [path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5189','--strictPort'], {cwd:root,stdio:'ignore'});
 let app;
 const checks=[];
 const openSettings=async()=>{
  const windowPromise=app.waitForEvent('window');
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='マイク・スピーカー…').click());
  const settings=await windowPromise;await settings.waitForLoadState();await settings.locator('select').first().waitFor();return settings;
 };
 try {
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:5189')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  app = await _electron.launch({executablePath:process.env.ELECTRON_BINARY||path.join(root,'electron/node_modules/electron/dist/electron'),args:[path.join(root,'electron/app/main.cjs'),'--server','http://127.0.0.1:5189','--data-dir',profile,'--ozone-platform=x11','--use-fake-device-for-media-stream','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  const page=await app.firstWindow();await page.waitForSelector('#joinname');
  const settings=await openSettings();assert.ok(settings.url().startsWith('file:'));assert.ok(settings.url().endsWith('/audio.html'));
  // Fake hardware only, so explicitly granting here never opens a physical microphone.
  await settings.locator('button').filter({hasText:/許可/}).click();
  await settings.waitForFunction(()=>document.querySelector('select').options.length>1);
  const microphone=await settings.locator('select').first().locator('option').evaluateAll(options=>options.map(o=>o.value).find(Boolean));assert.ok(microphone);
  await settings.locator('select').first().selectOption(microphone);
  await page.waitForFunction(id=>window.__tonariumElectronAudio.status().input===id,microphone);
  const saved=JSON.parse(fs.readFileSync(path.join(profile,'audio-devices.json'),'utf8'));
  assert.equal(saved['http://127.0.0.1:5189'].input,microphone);
  checks.push('Independent local audio settings select and persist a fake microphone on unchanged Web');
  assert.equal(await page.evaluate(()=>typeof require),'undefined');
  assert.equal(await page.evaluate(()=>typeof window.tonariumShell),'undefined');
  assert.equal(await page.evaluate(()=>typeof process),'undefined');
  checks.push('Remote page has no Node/process/local-shell IPC bridge');
  await settings.close();await page.reload();await page.waitForSelector('#joinname');
  await page.waitForFunction(id=>window.__tonariumElectronAudio.status().input===id,microphone);
  const reopened=await openSettings();assert.equal(await reopened.locator('select').first().inputValue(),microphone);
  await reopened.screenshot({path:path.join(output,'settings.png')});await reopened.close();
  checks.push('Selected input is restored after Web reload and settings reopen');
  // Remove every Web component: the desktop settings remain usable independently.
  await page.evaluate(()=>{document.body.replaceChildren();document.title='Plain Web page';});
  const plain=await openSettings();assert.equal(await plain.locator('select').first().inputValue(),microphone);await plain.close();
  checks.push('Settings do not depend on Web components or a Web deployment');
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks,limitations:['Fake media devices only.','Playwright adds --no-sandbox; OS sandbox enforcement is not tested.']},null,2));
  console.log('PASS Electron-only audio settings, fake microphone, persistence, remote IPC isolation');
 }catch(error){fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:false,checks,error:String(error.stack||error)},null,2));throw error;}
 finally{if(app)await app.close();vite.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
