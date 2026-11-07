import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * What `ltExtensions.auth.enabled` actually switches (DEV-4075).
 *
 * The name promises "the auth module", but the flag only gates the 401 interceptor plugin, exactly
 * like `auth.interceptor.enabled`. `useLtAuth()`, `useLtAuthClient()`, the auth helpers and the
 * Better-Auth client stay registered: the AI composables and offline sync authenticate through
 * `ltAuthFetch`, TUS uploads send the same session, and an app that sets the flag may still use the
 * composables. The JSDoc and
 * the README say so; this pins the source they describe (the module setup is not executable in a
 * unit test, as in `sync-module-options.test.ts`).
 */

const moduleSource = readFileSync(resolve(process.cwd(), 'src/module.ts'), 'utf8');

function runtimeSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return runtimeSources(path);
    return /\.(ts|vue)$/.test(name) ? [readFileSync(path, 'utf8')] : [];
  });
}

describe('auth.enabled', () => {
  it('is on by default and reaches the public runtime config', () => {
    expect(moduleSource).toMatch(/enabled: resolvedOptions\.auth\?\.enabled \?\? true,/);
  });

  it('gates the interceptor plugin, together with auth.interceptor.enabled', () => {
    expect(moduleSource).toMatch(
      /if \(resolvedOptions\.auth\?\.enabled && resolvedOptions\.auth\?\.interceptor\?\.enabled\) \{\s*addPlugin\(resolve\('\.\/runtime\/plugins\/auth-interceptor\.client'\)\);/,
    );
  });

  it('does not gate anything else: the auth composables are registered unconditionally', () => {
    // Apart from the default, every read of the flag goes together with the interceptor's own flag
    const reads = [...moduleSource.matchAll(/resolvedOptions\.auth\?\.enabled(?! \?\? true)(.{0,60})/g)].map((match) => match[1]);
    expect(reads.length).toBeGreaterThan(0);
    for (const rest of reads) expect(rest).toMatch(/^ && resolvedOptions\.auth\?\.interceptor\?\.enabled/);
    const unconditional = moduleSource.slice(moduleSource.indexOf('// Add explicit imports'), moduleSource.indexOf('// AI composables'));
    for (const name of ['useLtAuth', 'useLtAuthClient', 'ltAuthFetch', 'useSystemSetup']) {
      expect(unconditional).toContain(`name: '${name}'`);
    }
  });

  it('is read by no runtime code, so the documented effect is the whole effect', () => {
    const readers = runtimeSources(resolve(process.cwd(), 'src/runtime')).filter((source) => /auth\?*\.enabled\b/.test(source));
    expect(readers).toEqual([]);
  });

  it('says so in its documentation', () => {
    const types = readFileSync(resolve(process.cwd(), 'src/runtime/types/module.ts'), 'utf8');
    const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*enabled\?: boolean;\s*\/\*\* Enable admin plugin/.exec(types)?.[1] ?? '';
    expect(doc).toContain('interceptor');
    expect(doc).toContain('useLtAuth');
  });
});
