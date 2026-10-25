import { createRequire } from 'node:module';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = await import(path.join(root, 'node_modules/vite/dist/node/index.js'));
const html = path.join(root, 'client/.survivor-parity.html'), jsx = path.join(root, 'client/.survivor-parity.jsx');
await mkdir(path.join(root, 'native/build/survivor-parity/web'), {recursive:true});
let server, browser;
try {
await writeFile(html, '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/.survivor-parity.jsx"></script></body></html>');
await writeFile(jsx, `import React from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas} from '@react-three/fiber';
import {WorldMesh} from './src/view3d/worlds3d.tsx';
import {SurvivorPanel} from './src/world/SurvivorPanel.tsx';
import {useStore} from './src/store.ts';
import './src/style.css';
const now=1700000000300; Date.now=()=>now;
const person=(id,x,z)=>({id,name:id,style:'bloodrose',x,z,hp:120,maxHp:120,level:2,xp:0,nextXp:16,alive:true,kills:6,gear:{moonblade:1},choiceQueue:[],hitAt:0,attackAt:{},moveAt:now});
const players={'probe-self':person('probe-self',0,.55),'probe-ally':person('probe-ally',1,-1)};
const enemies=[{id:'ghoul',kind:'ghoul',x:2,z:1,radius:.3,hp:20,maxHp:20,hitAt:0},{id:'boss',kind:'boss',x:-2,z:-1,radius:.8,hp:1000,maxHp:1000,hitAt:0},{id:'bat',kind:'bat',x:-3,z:2,radius:.3,hp:20,maxHp:20,hitAt:0},{id:'knight',kind:'knight',x:3,z:-3,radius:.45,hp:80,maxHp:80,hitAt:0}];
const base={run:1,phase:'running',startedAt:now-10000,endedAt:null,pausedAt:null,players,enemies,effects:[{id:'a',playerId:'probe-self',gear:'moonblade',at:now-200,from:{x:0,z:.55},targets:[{x:2,z:1}],reach:2.1}],stylePicks:{},kills:6,spawnIndex:0,nextSpawnAt:0,randomSeed:1,bossDefeated:false};
const root=createRoot(document.getElementById('root'));
window.fixture=(phase,mode='3d')=>{
 const state=structuredClone(base); state.phase=phase==='choices'?'running':phase;
 if(phase==='lobby'){state.players={};state.enemies=[];state.effects=[];}
 if(phase==='choices'){state.pausedAt=now;state.players['probe-self'].choiceQueue=[['starbolt','shade','astralbook']];state.effects=[];}
 useStore.setState({selfId:'probe-self',selfName:'probe-self',selfAvatar:{x:0,z:.55,ry:0},session:'survivor-fixture',mode,worldBy:{'survivor-fixture':'survivors'},survivors:{'survivor-fixture':state},survivorProfile:{points:6,upgrades:{might:0,vitality:0,haste:0},runs:0,bestLevel:0,bestKills:0,achievements:[],discovered:['moonblade']},participants:[{id:'probe-self',name:'probe-self',mode:'3d',pos:{x:0,z:6.5}},{id:'probe-ally',name:'probe-ally',mode:'3d',pos:{x:1,z:-1}}],avatars:{'probe-self':{x:0,z:6.5,ry:0},'probe-ally':{x:1,z:-1,ry:0}},serverOffset:0});
 root.render(mode==='3d'? <><div style={{position:'fixed',inset:0}}><Canvas camera={{fov:70,near:.05,far:300,position:[0,16,.55],rotation:[-Math.PI/2,0,0]}}><color attach="background" args={['#2b2d31']}/><WorldMesh kind="survivors"/></Canvas></div><SurvivorPanel overlay/></>:<div style={{width:520,height:740,margin:'30px auto'}}><SurvivorPanel/></div>);
 return state;
}; window.fixture('running');`);
server = await createServer({server:{host:'127.0.0.1',port:5187,strictPort:true}}); await server.listen();
browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5187/.survivor-parity.html');await page.waitForFunction(()=>typeof window.fixture==='function');
for(const mode of ['2d','3d']) for(const phase of ['lobby','running','choices','boss']){
 const fixture=await page.evaluate(([phase,mode])=>window.fixture(phase,mode),[phase,mode]);await page.waitForTimeout(700);
 await page.screenshot({path:path.join(root,'native/build/survivor-parity/web',mode+'-'+phase+'.png')});
 if(phase==='choices'){await page.locator('.survivor-choices').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'native/build/survivor-parity/web',mode+'-choices-scrolled.png')});}
 await writeFile(path.join(root,'native/build/survivor-parity/web',phase+'.json'),JSON.stringify(fixture,null,2));
}
if(errors.length) throw new Error(errors.join('\n'));
console.log('Captured Web 2D/3D lobby, running, choices, boss with actual components.');
} finally {await browser?.close();await server?.close();await unlink(html).catch(()=>{});await unlink(jsx).catch(()=>{});}
