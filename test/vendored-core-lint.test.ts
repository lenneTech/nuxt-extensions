// @vitest-environment node
/**
 * The vendored core, linted with nuxt-base-template's oxlint configuration.
 *
 * `lt fullstack init` copies `src/module.ts`, `src/index.ts` and `src/runtime/` into `app/core/`,
 * where the project's `.oxlintrc.json` lints them through overrides on `app/core/**`. This
 * repository's `check` runs in npm mode and never saw that: up to 1.24.0 the template applied
 * `unicorn` to the core, and every new vendor-mode project reported three warnings in
 * `sync-hints.ts` that nothing here had reported (smoke test, 2026-11-05). `check:vendored-core`
 * now lints the staged core with the template's current configuration; these tests pin how it
 * stages, reads and reports, offline.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { corePath, lintVendoredCore, VENDORED_ENTRIES } from '../scripts/lib/vendored-core-lint.mjs';

const ROOT = process.cwd();
const SNAPSHOT = resolve(ROOT, 'test/fixtures/vendored-core/nuxt-base-template.oxlintrc.json');
const TEMPLATE_CONFIG = readFileSync(SNAPSHOT, 'utf8');
/** The shape of the template up to 2.35.0: `unicorn` for everything, the core included. */
const UNICORN_FOR_CORE = JSON.stringify({ plugins: ['typescript', 'unicorn'] });
const SPREAD = 'export const copy = [...[1, 2]];\n';

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

let src: string;

beforeAll(() => {
  src = mkdtempSync(join(tmpdir(), 'lt-vendored-src-'));
  mkdirSync(join(src, 'runtime', 'lib'), { recursive: true });
  writeFileSync(join(src, 'module.ts'), SPREAD);
  writeFileSync(join(src, 'runtime', 'lib', 'spread.ts'), SPREAD);
  writeFileSync(join(src, 'runtime', 'lib', 'clean.ts'), 'export const value = 1;\n');
  // Not vendored by the CLI, so not linted as core either.
  writeFileSync(join(src, 'not-vendored.ts'), SPREAD);
});

afterAll(() => {
  if (src) rmSync(src, { force: true, recursive: true });
});

const lint = (config: string, env: NodeJS.ProcessEnv = process.env, srcDir = src) => lintVendoredCore({ config, env, root: ROOT, srcDir });

describe('corePath — the reported file, whatever form oxlint prints it in', () => {
  it.each([
    ['app/core/runtime/lib/sync-hints.ts', 'app/core/runtime/lib/sync-hints.ts'],
    ['file:///private/tmp/lt-vendored-core-x/app/core/runtime/lib/sync-hints.ts', 'app/core/runtime/lib/sync-hints.ts'],
    ['C:\\Users\\dev\\AppData\\Local\\Temp\\lt-vendored-core-x\\app\\core\\module.ts', 'app/core/module.ts'],
    ['file:///C:/Users/dev/AppData/Local/Temp/lt-vendored-core-x/app/core/runtime/index.ts', 'app/core/runtime/index.ts'],
  ])('%s → %s', (filename, expected) => {
    expect(corePath(filename)).toBe(expected);
  });

  it.each(['app/utils/x.ts', 'myapp/core/x.ts', 'app/core'])('%s is outside the core', (filename) => {
    expect(corePath(filename)).toBeNull();
  });
});

describe('lintVendoredCore', () => {
  // `undefined` is any other terminal, CI included. In a JetBrains terminal oxlint prints `file:///` paths.
  it.each([undefined, 'JetBrains-JediTerm'])('reports what a template that lints the core with unicorn would report (TERMINAL_EMULATOR=%s)', { timeout: 60_000 }, (terminal) => {
    const result = lint(UNICORN_FOR_CORE, { ...process.env, TERMINAL_EMULATOR: terminal });

    expect(result.ok).toBe(false);
    expect(result.findings.map(({ file, line, rule, severity }) => `${file}:${line} ${severity} ${rule}`).sort()).toEqual([
      'app/core/module.ts:1 warning unicorn(no-useless-spread)',
      'app/core/runtime/lib/spread.ts:1 warning unicorn(no-useless-spread)',
    ]);
  });

  it('passes when the template keeps the plugin away from the core, as it does since 2.35.1', { timeout: 60_000 }, () => {
    const result = lint(TEMPLATE_CONFIG);

    expect(result).toMatchObject({ files: 3, findings: [], ok: true });
  });

  it('fails when oxlint cannot use the configuration, instead of reading as clean', { timeout: 60_000 }, () => {
    const result = lint(JSON.stringify({ plugins: ['no-such-plugin'] }));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.output).toMatch(/no-such-plugin/);
  });

  it('fails when nothing reached app/core, instead of reading as clean', { timeout: 60_000 }, () => {
    const empty = mkdtempSync(join(tmpdir(), 'lt-vendored-empty-'));
    try {
      expect(lint(TEMPLATE_CONFIG, process.env, empty)).toMatchObject({ files: 0, ok: false });
    } finally {
      rmSync(empty, { force: true, recursive: true });
    }
  });

  it('stages exactly what the CLI vendors', () => {
    // cli: src/extensions/frontend-helper.ts copies module.ts, index.ts, runtime and LICENSE into app/core.
    expect(VENDORED_ENTRIES).toEqual(['module.ts', 'index.ts', 'runtime']);
  });
});

describe('this repository’s core', () => {
  it('is clean with the snapshot of the template configuration', { timeout: 60_000 }, () => {
    const result = lint(TEMPLATE_CONFIG, process.env, resolve(ROOT, 'src'));

    expect(result.findings).toEqual([]);
    expect(result.files).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
  });
});

describe('check:vendored-core', () => {
  const run = (config: string) =>
    spawnSync(process.execPath, ['scripts/check-vendored-core.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, LT_TEMPLATE_OXLINTRC: config },
    });

  it('passes on the real core with the template configuration', { timeout: 60_000 }, () => {
    const result = run(SNAPSHOT);

    expect(result.stdout).toMatch(/app\/core clean: \d+ files/);
    expect(result.status).toBe(0);
  });

  it('fails with every finding listed', { timeout: 60_000 }, () => {
    const config = join(src, 'one-line-files.oxlintrc.json');
    writeFileSync(config, JSON.stringify({ rules: { 'max-lines': ['error', { max: 1 }] } }));

    const result = run(config);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/app\/core\/module\.ts:\d+ {2}error eslint\(max-lines\)/);
    expect(result.stderr).toMatch(/Found 0 warnings and \d+ errors in the vendored core/);
  });

  it('fails when the configuration cannot be read, and says the core was not linted', { timeout: 60_000 }, () => {
    const result = run(join(src, 'missing.oxlintrc.json'));

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/was NOT linted/);
  });

  it('runs in every check chain right after the lint, and in CI', () => {
    expect(pkg.scripts['check:vendored-core']).toBe('node scripts/check-vendored-core.mjs');
    expect(pkg.scripts['check:raw']).toContain('pnpm run lint && pnpm run check:vendored-core &&');
    expect(pkg.scripts['check:fix']).toContain('pnpm run lint:fix && pnpm run check:vendored-core &&');
    expect(pkg.scripts['check:naf']).toContain('pnpm run lint:fix && pnpm run check:vendored-core &&');
    // Blocking in CI: the step itself, up to the next step, carries no continue-on-error.
    const step = /- name: Lint as vendored core[^\n]*\n((?:(?!\n\s*- name:)[\s\S])*)/.exec(readFileSync(resolve(ROOT, '.github/workflows/build.yml'), 'utf8'))?.[1] ?? '';
    expect(step).toMatch(/run: pnpm run check:vendored-core/);
    expect(step).not.toMatch(/continue-on-error/);
  });
});
