// Web の音定義を実行してレシピ化する。音程・長さを別管理しない。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'client/src/world/survivorAudio.ts'), 'utf8');
const body = source.slice(source.indexOf('  switch (kind)'), source.lastIndexOf('}'));
if (!body.startsWith('  switch (kind)')) throw new Error('Web audio switch not found');
const render = new Function('kind', 'gear', 'tone', 'hiss', 'chord', `const c = null, at = 0.012, v = 1; ${body}`);
const recipes = {};
const gears = [...new Set([...source.matchAll(/gear === '([^']+)'/g)].map(m => m[1])), 'default'];
const kinds = [...source.matchAll(/case '([^']+)':/g)].map(m => m[1]);
for (const kind of kinds) for (const gear of kind === 'attack' ? gears : ['']) {
  const voices = [];
  const tone = (_, at, start, end, duration, wave, volume) => voices.push({at,start,end,duration,wave,volume});
  const hiss = (_, at, duration, volume, cutoff) => voices.push({at,duration,volume,cutoff,wave:'noise'});
  const chord = (c, at, notes, duration, volume) => notes.forEach((f,i) => tone(c, at+i*0.075,f,f*1.005,duration,'sine',volume));
  render(kind, gear, tone, hiss, chord);
  recipes[gear ? `${kind}:${gear}` : kind] = voices;
}
fs.writeFileSync(path.join(root,'native/Tonarium.Desktop/Assets/survivor-audio.json'), JSON.stringify(recipes,null,2)+'\n');
console.log(`Generated ${Object.keys(recipes).length} Web audio recipes`);
