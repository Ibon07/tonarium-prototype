const DEFAULT_SERVER = 'https://tonarium.rheni.work/';

function normalizeServer(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('HTTPS の URL を指定してください（localhost は HTTP も利用できます）。');
  }
  if (url.username || url.password) throw new Error('認証情報を含む URL は利用できません。');
  url.hash = '';
  return url.href;
}

function sameOrigin(value, server) {
  try { return new URL(value).origin === new URL(server).origin; } catch { return false; }
}

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function option(args, name) {
  const exact = args.indexOf(name);
  if (exact >= 0) {
    if (!args[exact + 1] || args[exact + 1].startsWith('--')) throw new Error(`${name} の値がありません。`);
    return args[exact + 1];
  }
  return args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

module.exports = { DEFAULT_SERVER, normalizeServer, sameOrigin, externalUrl, option };
