import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `ltExtensions.tus.resolveAgainstApi` must reach the public runtime config.
 *
 * `useLtTusUpload` reads the switch from `useRuntimeConfig().public.ltExtensions.tus` and treats a
 * missing value as `true`. If `src/module.ts` stopped forwarding it, nothing would fail — the
 * composable would simply resolve against the API for everybody, and a project that set
 * `resolveAgainstApi: false` to keep its own same-origin proxy would have its uploads rerouted
 * without any error. The module setup is not executable in a unit test, so this pins the source,
 * the same way `optional-peers.test.ts` pins the passkey wiring.
 */

const moduleSource = readFileSync(resolve(process.cwd(), 'src/module.ts'), 'utf8');

describe('tus module options', () => {
  it('defaults resolveAgainstApi to true', () => {
    expect(moduleSource).toMatch(/tus: \{[^}]*resolveAgainstApi: true,[^}]*\}/);
  });

  it('forwards resolveAgainstApi into the public runtime config, defaulting to true', () => {
    expect(moduleSource).toMatch(/resolveAgainstApi: resolvedOptions\.tus\?\.resolveAgainstApi \?\? true/);
  });
});
