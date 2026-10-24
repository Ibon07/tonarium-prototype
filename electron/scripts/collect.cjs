const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function collect(platform, source = path.join(root, 'build', `package-${platform}`), output = path.join(root, 'artifacts')) {
  if (!['linux', 'win'].includes(platform)) throw new Error('Specify linux or win');
  fs.mkdirSync(output, { recursive: true });
  const metadata = platform === 'linux' ? 'nightly-linux.yml' : 'nightly.yml';
  const names = fs.readdirSync(source).filter(name => name === metadata ||
    (/^Tonarium-Electron-.*\.(tar\.gz|AppImage|zip|exe|blockmap)$/.test(name) && name.includes(`-${platform}-`)));
  if (!names.some(name => name.endsWith(platform === 'linux' ? '.AppImage' : '.exe'))) throw new Error('Missing updater installation artifact');
  // 過去のビルドを次回の publish に混ぜない。同時実行する別 OS の成果物は残す。
  for (const name of fs.readdirSync(output)) {
    if (name === metadata || name === `${metadata}.sha256` || (name.startsWith('Tonarium-Electron-') && name.includes(`-${platform}-`))) fs.unlinkSync(path.join(output, name));
  }
  for (const name of names) {
    const destination = path.join(output, name);
    fs.copyFileSync(path.join(source, name), destination);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
    fs.writeFileSync(`${destination}.sha256`, `${hash}  ${name}\n`);
    console.log(destination);
  }
  return names;
}
module.exports = { collect };
if (require.main === module) collect(process.argv[2]);
