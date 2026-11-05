import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `lt fullstack init` vendors by default: it copies `src/runtime` unchanged to `app/core/runtime`,
 * one level deeper than here. A tsconfig in that tree keeps its relative `extends`, which then points
 * at `app/.nuxt/`, and that does not exist. As soon as a `.ts` file sits next to it, `oxlint
 * --type-aware` stops with `Invalid tsconfig`, and `lint` is part of every project's `check`.
 *
 * None of this repository's gates can see it: `check` and `check:consumer` run in npm mode, where the
 * package sits in `node_modules` and is never linted. Module-level tsconfigs live in the repository
 * root instead, which vendoring does not copy.
 */
describe('vendored core', () => {
  it('src/runtime holds no tsconfig', () => {
    const files = readdirSync(resolve(process.cwd(), 'src/runtime'), { recursive: true }).map(String);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => /(?:^|[\\/])tsconfig[^\\/]*\.json$/.test(file))).toEqual([]);
  });

  // nuxt-base-starter lints `app/core/**` with a subset of these plugins, and a generated project
  // expects a lint without warnings. So this repository lints with every plugin the starter may apply
  // there, and fails on a warning. A warning only the starter reports surfaces after the release.
  it('is linted with every plugin nuxt-base-starter may apply to app/core, and a warning fails the lint', () => {
    const config = readFileSync(resolve(process.cwd(), '.oxlintrc.json'), 'utf8');
    const plugins = JSON.parse(config.match(/"plugins":\s*(\[[^\]]*\])/)?.[1] ?? '[]') as string[];
    expect(plugins).toEqual(expect.arrayContaining(['typescript', 'vue', 'unicorn', 'import']));

    const scripts = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(scripts.lint).toContain('--deny-warnings');
    expect(scripts['lint:fix']).toContain('--deny-warnings');
  });

  it('the Nitro code is typechecked from the repository root', () => {
    expect(existsSync(resolve(process.cwd(), 'tsconfig.server.json'))).toBe(true);
  });
});
