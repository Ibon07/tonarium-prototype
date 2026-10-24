const fs = require('node:fs');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { collect } = require('./collect.cjs');
const root = path.resolve(__dirname, '..');

function configuration(args, env = process.env) {
  const flags = new Set(['--linux', '--win', '--dir', '--disable-updates', '--nightly']);
  for (const arg of args) if (!flags.has(arg)) throw new Error(`Unknown build argument: ${arg}`);
  if (args.includes('--linux') && args.includes('--win')) throw new Error('Build one platform at a time');
  const platform = args.includes('--win') ? 'win' : args.includes('--linux') ? 'linux' : process.platform === 'win32' ? 'win' : 'linux';
  const pkg = require('../package.json');
  let version = pkg.version;
  if (args.includes('--nightly')) {
    const run = env.GITHUB_RUN_NUMBER;
    const attempt = env.GITHUB_RUN_ATTEMPT || '1';
    if (!/^[1-9][0-9]*$/.test(run || '') || !/^[1-9][0-9]*$/.test(attempt)) throw new Error('Nightly requires positive GITHUB_RUN_NUMBER and GITHUB_RUN_ATTEMPT');
    const stable = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
    if (!stable) throw new Error('Base package version must be stable SemVer');
    version = `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}-nightly.${run}.${attempt}`;
  }
  return { platform, version, enabled: !args.includes('--disable-updates'), directoryOnly: args.includes('--dir') };
}

async function main(args) {
  const options = configuration(args);
  const publish = require('../package.json').build.publish;
  fs.writeFileSync(path.join(root, 'app/update-build.json'), JSON.stringify({ enabled: options.enabled, version: options.version, ...publish }, null, 2) + '\n');
  const output = path.join(root, 'build', `package-${options.platform}`);
  fs.rmSync(output, { recursive: true, force: true });
  const platform = options.platform === 'win' ? Platform.WINDOWS : Platform.LINUX;
  await build({ projectDir: root, targets: platform.createTarget(options.directoryOnly ? ['dir'] : undefined, Arch.x64), publish: 'never', config: {
    extraMetadata: { version: options.version },
    directories: { output },
    publish: options.enabled ? publish : null,
  } });
  if (!options.directoryOnly) collect(options.platform, output);
}

module.exports = { configuration };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
