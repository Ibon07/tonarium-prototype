const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const target = path.join(root, 'native/Tonarium.Unity/Assets/Resources/Web');
const sources = [
  ['client/public/brand/mark.png', 'Brand/mark.png'],
  ['client/public/brand/logo.png', 'Brand/logo.png'],
  ['client/public/brand/favicon.png', 'Brand/favicon.png'],
  ['native/Tonarium.Desktop/Assets/fonts/ZenKakuGothicNew-Regular.ttf', 'Fonts/ZenKakuGothicNew-Regular.ttf'],
  ['native/Tonarium.Desktop/Assets/fonts/ZenMaruGothic-Bold.ttf', 'Fonts/ZenMaruGothic-Bold.ttf'],
  ['native/Tonarium.Desktop/Assets/fonts/ZenKakuGothicNew-OFL.txt', 'Fonts/ZenKakuGothicNew-OFL.txt'],
  ['native/Tonarium.Desktop/Assets/fonts/ZenMaruGothic-OFL.txt', 'Fonts/ZenMaruGothic-OFL.txt'],
];
for (const [source, destination] of sources) {
  const output = path.join(target, destination);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const input = path.join(root, source);
  if (!fs.existsSync(output) || !fs.readFileSync(input).equals(fs.readFileSync(output))) fs.copyFileSync(input, output);
}
fs.writeFileSync(path.join(target, 'WebAssetSources.json'), JSON.stringify(sources.map(([source, asset]) => ({ source, asset, sha256: createHash('sha256').update(fs.readFileSync(path.join(target, asset))).digest('hex') })), null, 2) + '\n');
console.log(`Copied ${sources.length} original Web/native assets into Unity Resources.`);
