import { join } from 'node:path';
import { aggregateChangelog, root } from './changelog.mjs';

export function changelogPlugin(cwd = root) {
  const legacy = join(cwd, 'shared/changelog.ts').replaceAll('\\', '/');
  const fragments = join(cwd, 'changelog').replaceAll('\\', '/') + '/';
  return {
    name: 'aggregate-changelog',
    // addWatchFile にディレクトリを渡すと、Windows の開発サーバーがそれを import として解決しようとして失敗する。
    // 作業別ファイルの追加・変更・削除は開発サーバーの監視で拾い、集約したモジュールを読み直させる
    configureServer(server) {
      server.watcher.add(fragments);
      const reload = (file) => {
        if (!file.replaceAll('\\', '/').startsWith(fragments)) return;
        const mod = server.moduleGraph.getModuleById(legacy);
        if (!mod) return;
        server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      for (const event of ['add', 'change', 'unlink']) server.watcher.on(event, reload);
    },
    transform(_code, id) {
      if (id.split('?')[0] !== legacy) return;
      return { code: `export const CHANGELOG = ${JSON.stringify(aggregateChangelog(cwd))};`, map: null };
    },
  };
}
