const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../..');
const output=path.resolve(process.argv[2] || path.join(root,'electron/build/verification/normal-launch'));
const binary=process.env.ELECTRON_BINARY || path.join(root,'electron/build/linux-unpacked/tonarium-electron');
let child,browser;
const server=http.createServer((_,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<!doctype html><html><title>Tonarium Electron 起動確認</title><body><h1>Tonarium Electron</h1><p>通常起動・分離されたユーザー設定</p><input id="ime" autofocus><canvas id="canvas"></canvas></body></html>')});
(async()=>{
 await fs.mkdir(output,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={...process.env,WAYLAND_DISPLAY:'',XDG_SESSION_TYPE:'x11'};delete env.ELECTRON_RUN_AS_NODE;
 const args=['--server',`http://127.0.0.1:${server.address().port}/`,'--data-dir',path.join(output,'profile'),'--ozone-platform=x11','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=9328','--remote-debugging-address=127.0.0.1'];
 child=spawn(binary,args,{env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Electron exited '+child.exitCode+' '+log);try{browser=await chromium.connectOverCDP('http://127.0.0.1:9328');break}catch{await new Promise(r=>setTimeout(r,100))}}
 if(!browser)throw Error('Debugging endpoint not ready '+log);
 const context=browser.contexts()[0];let page;
 for(let i=0;i<50;i++){page=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:'));if(page)break;await new Promise(r=>setTimeout(r,100));}
 await page.locator('#ime').waitFor();await page.locator('#ime').fill('吾輩は猫である。名前はまだ無い。');
 const isolated=await page.evaluate(()=>typeof require==='undefined' && typeof process==='undefined' && typeof tonariumShell==='undefined');
 if(!isolated)throw Error('Renderer exposes host APIs');
 const webgl=await page.evaluate(()=>!!document.querySelector('#canvas').getContext('webgl2'));
 if(!webgl)throw Error('WebGL2 unavailable');
 await page.screenshot({path:path.join(output,'normal-launch.png')});
 await fs.writeFile(path.join(output,'electron.log'),log);
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,binary,args,checks:['Production executable starts without --no-sandbox or a Playwright Electron launcher','Renderer host APIs remain unavailable','WebGL2 and Japanese text render in normal startup'],limitations:['Virtual X11 display uses an explicitly enabled software GPU; physical Wayland IME not exercised']},null,2));
 console.log('PASS normal packaged launch without --no-sandbox; WebGL2/Japanese renderer');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser){await browser.newBrowserCDPSession().then(s=>s.send('Browser.close')).catch(()=>{});await browser.close();}child?.kill('SIGTERM');server.close()});
