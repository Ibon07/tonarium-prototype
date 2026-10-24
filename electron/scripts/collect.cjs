const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts');
const platform = process.argv[2];
if (!['linux', 'win'].includes(platform)) throw new Error('Specify linux or win');
fs.mkdirSync(output, { recursive: true });
for (const name of fs.readdirSync(path.join(root, 'build'))) {
  if (!/^Tonarium-Electron-.*\.(tar\.gz|AppImage|zip)$/.test(name)) continue;
  if (!name.includes(`-${platform}-`)) continue;
  const destination = path.join(output, name);
  fs.copyFileSync(path.join(root, 'build', name), destination);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  fs.writeFileSync(`${destination}.sha256`, `${hash}  ${name}\n`);
  console.log(destination);
}
