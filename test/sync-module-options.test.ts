import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `ltExtensions.sync` is opt-in, and its flag must reach the public runtime config.
 *
 * `useLtAuth().signOut()` reads `ltExtensions.sync.enabled` from the runtime config to decide
 * whether to send and delete the local offline-sync data. If the module stopped forwarding the flag,
 * nothing would fail — sign-out would simply leave every synced record of the user on the device.
 * And an app that never enabled sync must not get the composable or the cleanup (protocol §1.6:
 * without a sync configuration nothing changes). The module setup is not executable in a unit test,
 * so this pins the source, like `tus-module-options.test.ts`.
 */

const moduleSource = readFileSync(resolve(process.cwd(), 'src/module.ts'), 'utf8');

describe('sync module options', () => {
  it('is off by default, on the nest-server base path', () => {
    expect(moduleSource).toMatch(/sync: \{\s*basePath: '\/sync',\s*enabled: false,\s*\}/);
  });

  it('forwards enabled (default false) and the base path into the public runtime config', () => {
    expect(moduleSource).toMatch(/sync: \{\s*basePath: resolvedOptions\.sync\?\.basePath \|\| '\/sync',\s*enabled: resolvedOptions\.sync\?\.enabled \?\? false,\s*\}/);
  });

  it('auto-imports the composable only when enabled', () => {
    expect(moduleSource).toMatch(/if \(resolvedOptions\.sync\?\.enabled\) \{\s*addImports\(\[\{ name: 'useLtOfflineSync'/);
    expect(moduleSource.match(/useLtOfflineSync/g)).toHaveLength(1);
  });
});
