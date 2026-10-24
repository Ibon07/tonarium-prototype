// Uses only two temporary PulseAudio null sinks and their remapped monitor sources.
// No production connection, physical microphone, physical speaker, or recordings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'electron/build/verification/audio-virtual-devices');
const pactl = (...args) => execFileSync('pactl', args, { encoding: 'utf8' }).trim();
const modules = [], checks = [];
const prefix = `tonarium_test_${process.pid}`;
const devices = ['a','b'].map(s => ({ sink: `${prefix}_${s}`, source: `${prefix}_mic_${s}`, label: `Tonarium_Test_${s.toUpperCase()}_${process.pid}` }));
let app, vite;
function belongsTo(pid, rootPid) { for(let i=0;i<30&&pid>1;i++){if(pid===rootPid)return true;try{const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');pid=Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[1]);}catch{return false;}}return false;}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
 fs.mkdirSync(output, { recursive: true });
 try {
  for (const device of devices) {
   modules.push(pactl('load-module', 'module-null-sink', `sink_name=${device.sink}`, `sink_properties=device.description=${device.label}_Speaker`));
   modules.push(pactl('load-module', 'module-remap-source', `master=${device.sink}.monitor`, `source_name=${device.source}`, `source_properties=device.description=${device.label}_Microphone`));
  }
  const sources = JSON.parse(pactl('-f','json','list','sources'));
  const allowedSources = new Set(sources.filter(source => devices.some(d => source.name === d.source || source.name === `${d.sink}.monitor`)).map(s => s.index));
  vite = spawn(process.execPath, [path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5193','--strictPort'], {cwd:root,stdio:'ignore'});
  for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:5193')).ok)break;}catch{}await sleep(200);}
  app = await _electron.launch({executablePath:path.join(root,'electron/node_modules/electron/dist/electron'),env:{...process.env,PULSE_SOURCE:devices[0].source,PULSE_SINK:devices[0].sink},args:[path.join(root,'electron/app/main.cjs'),'--server','http://127.0.0.1:5193','--data-dir',path.join(output,`profile-${process.pid}`),'--ozone-platform=x11','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  const page=await app.firstWindow(); await page.waitForSelector('#joinname');
  // Expose device labels without opening any default microphone: only exact virtual IDs are captured below.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.session.setPermissionCheckHandler((_contents,permission,origin,details)=>new URL(origin).origin==='http://127.0.0.1:5193' && (permission==='speaker-selection'||permission==='media')));
  checks.push('Test-only permission pregrant exposes names without opening default capture');
  const settingsPromise=app.waitForEvent('window');
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='マイク・スピーカー…').click());
  const settings=await settingsPromise;await settings.waitForLoadState();await settings.locator('select').first().waitFor();
  await settings.waitForFunction(label=>[...document.querySelectorAll('select')][0]?.textContent.includes(label), devices[0].label);
  const enumeration=await page.evaluate(async()=> (await navigator.mediaDevices.enumerateDevices()).map(d=>({id:d.deviceId,label:d.label,kind:d.kind})));
  for(const device of devices){device.inputId=enumeration.find(d=>d.kind==='audioinput'&&d.label.includes(device.label))?.id;device.outputId=enumeration.find(d=>d.kind==='audiooutput'&&d.label.includes(device.label))?.id;assert.ok(device.inputId);assert.ok(device.outputId);}
  await page.evaluate(async()=>{window.__testContext=new AudioContext();window.__testMedia=document.createElement('audio');document.body.appendChild(window.__testMedia);});
  for(const device of devices){
   await settings.locator('select').nth(0).selectOption(device.inputId);
   await page.waitForFunction(id=>window.__tonariumElectronAudio.status().input===id,device.inputId);
   const actual=await page.evaluate(async()=>{window.__testStream=await navigator.mediaDevices.getUserMedia({audio:true});return window.__testStream.getAudioTracks()[0].getSettings().deviceId;});
   assert.equal(actual,device.inputId);
   const captures=JSON.parse(pactl('-f','json','list','source-outputs')).filter(s=>belongsTo(Number(s.properties?.['application.process.id']),app.process().pid));assert.ok(captures.length);fs.writeFileSync(path.join(output,'routing-debug.json'),JSON.stringify({allowed:[...allowedSources],captures:captures.map(s=>({index:s.index,source:s.source,process:s.properties?.['application.process.id'],application:s.properties?.['application.name']}))},null,2));assert.ok(captures.every(s=>allowedSources.has(s.source)));
   await page.evaluate(()=>window.__testStream.getTracks().forEach(t=>t.stop()));
   await settings.locator('select').nth(1).selectOption(device.outputId);
   await page.waitForFunction(id=>window.__tonariumElectronAudio.status().output===id,device.outputId);
   const sinks=await page.evaluate(()=>({context:window.__testContext.sinkId,media:window.__testMedia.sinkId}));
   assert.equal(sinks.context,device.outputId); assert.equal(sinks.media,device.outputId);
   checks.push(`${device.label}: UI mic selection matches actual track deviceId; AudioContext and HTMLAudioElement sinkIds match speaker selection; captures remain virtual`);
  }
  await page.evaluate(async()=>{window.__testStream?.getTracks().forEach(t=>t.stop());await window.__testContext.close();window.__testMedia.remove();});
  await settings.screenshot({path:path.join(output,'device-settings.png')});
  await settings.close();await page.reload();await page.waitForSelector('#joinname');
  await page.waitForFunction(id=>window.__tonariumElectronAudio.status().output===id,devices[1].outputId);
  await page.evaluate(()=>{window.__restoredContext=new AudioContext();window.__restoredMedia=document.createElement('audio');document.body.appendChild(window.__restoredMedia);});
  await page.waitForFunction(id=>window.__restoredContext.sinkId===id&&window.__restoredMedia.sinkId===id,devices[1].outputId);
  assert.equal(await page.evaluate(()=>window.__tonariumElectronAudio.status().input),devices[1].inputId);
  await page.evaluate(()=>window.__restoredContext.close());
  checks.push('Web reload restores input selection and routes newly created standard AudioContext/media elements to the saved virtual output');
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks,limitations:['This successful run opens exact virtual input IDs only; test-only permission pregrant exposes device labels without default capture.','No LiveKit server connection or media transmission.','Sink routing identifiers validated without audible playback.','Playwright adds --no-sandbox; does not verify OS sandbox enforcement.']},null,2));
  console.log('PASS virtual PulseAudio A→B microphone capture and AudioContext/HTMLAudioElement output routing');
 } catch(error) {fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:false,checks,error:String(error.stack||error)},null,2));throw error;}
 finally {
  if(app)await app.close().catch(()=>{});if(vite)vite.kill('SIGTERM');
  for(const module of modules.reverse())try{pactl('unload-module',module);}catch{}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
