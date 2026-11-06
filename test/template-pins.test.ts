// @vitest-environment node
/**
 * Vendoring must not raise a version in nuxt-base-template.
 *
 * `lt fullstack init` raises every version the template shares with this package to this
 * package's version when that is newer. After 1.24.0 that took vue-tsc from 3.3.13 to 3.3.14 in
 * every new vendor-mode project, a version the template's own check had never run with: six TS2339
 * in a template component, and a template check that stopped at the first `//` in a component
 * attribute with exit 0 (smoke test, 2026-11-05). `check:template-pins` fails as soon as vendoring
 * would raise anything. These tests pin the rule (the CLI's `alignFrameworkPins`) and the script,
 * offline.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { pinsVendoringRaises } from '../scripts/lib/template-pins.mjs';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

describe('pinsVendoringRaises — the CLI’s rule', () => {
  it('raises a template devDependency this package has newer (vue-tsc after 1.24.0)', () => {
    const result = pinsVendoringRaises({ devDependencies: { 'vue-tsc': '3.3.13' } }, { devDependencies: { 'vue-tsc': '3.3.14' } });

    expect(result.raised).toEqual([{ from: '3.3.13', name: 'vue-tsc', section: 'devDependencies', to: '3.3.14' }]);
  });

  it('never lowers: a template ahead of this package is left alone', () => {
    expect(pinsVendoringRaises({ devDependencies: { typescript: '6.0.3' } }, { devDependencies: { typescript: '5.9.3' } }).raised).toEqual([]);
  });

  it('raises a template dependency only from this package’s dependencies, never from its devDependencies', () => {
    const template = { dependencies: { 'better-auth': '1.7.16', shared: '1.0.0' } };
    const framework = { dependencies: { shared: '1.1.0' }, devDependencies: { 'better-auth': '1.7.17' } };

    expect(pinsVendoringRaises(template, framework).raised).toEqual([{ from: '1.0.0', name: 'shared', section: 'dependencies', to: '1.1.0' }]);
  });

  it('raises a range only when this package’s version lies above the whole range', () => {
    const framework = { devDependencies: { a: '3.3.14', b: '3.3.14' } };
    const result = pinsVendoringRaises({ devDependencies: { a: '^3.3.0', b: '~3.2.0' } }, framework);

    expect(result.raised.map((entry) => entry.name)).toEqual(['b']);
  });

  it('counts only exact versions of this package, as the CLI does', () => {
    expect(pinsVendoringRaises({ dependencies: { '@nuxt/kit': '3.0.0' } }, { dependencies: { '@nuxt/kit': '^4.0.0' } })).toEqual({ compared: 0, raised: [], skipped: [] });
  });

  it('skips this package itself, which the CLI removes from the project before it aligns', () => {
    expect(pinsVendoringRaises({ dependencies: { '@lenne.tech/nuxt-extensions': '1.0.0' } }, { dependencies: { '@lenne.tech/nuxt-extensions': '9.9.9' } })).toEqual({
      compared: 0,
      raised: [],
      skipped: [],
    });
  });

  it('reports what is neither a version nor a range instead of comparing it', () => {
    expect(pinsVendoringRaises({ devDependencies: { local: 'workspace:*' } }, { devDependencies: { local: '2.0.0' } }).skipped).toEqual([
      { current: 'workspace:*', name: 'local', section: 'devDependencies' },
    ]);
  });
});

describe('check:template-pins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lt-template-pins-'));
  afterAll(() => rmSync(dir, { force: true, recursive: true }));

  const run = (template: unknown) => {
    const file = join(dir, `package-${Math.random().toString(36).slice(2)}.json`);
    if (template !== undefined) writeFileSync(file, JSON.stringify(template));
    return spawnSync(process.execPath, ['scripts/check-template-pins.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, LT_TEMPLATE_PACKAGE_JSON: file },
    });
  };

  it('passes when the template already has every version this package has', { timeout: 60_000 }, () => {
    const result = run({ devDependencies: { 'vue-tsc': pkg.devDependencies['vue-tsc'], vitest: pkg.devDependencies.vitest } });

    expect(result.stdout).toMatch(/vendoring raises nothing: 2 shared versions compared/);
    expect(result.status).toBe(0);
  });

  it('fails and lists every version vendoring would raise', { timeout: 60_000 }, () => {
    const result = run({ devDependencies: { 'vue-tsc': '0.0.1' } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`devDependencies.vue-tsc: template 0.0.1 → ${pkg.devDependencies['vue-tsc']}`);
    expect(result.stderr).toMatch(/Vendoring would raise 1 version/);
  });

  it('fails when the template’s package.json cannot be read, and says nothing was compared', { timeout: 60_000 }, () => {
    const result = run(undefined);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/were NOT compared/);
  });

  it('runs in every check chain and blocking in CI', () => {
    expect(pkg.scripts['check:template-pins']).toBe('node scripts/check-template-pins.mjs');
    for (const chain of ['check:raw', 'check:fix', 'check:naf']) {
      expect(pkg.scripts[chain], chain).toContain('pnpm run check:vendored-core && pnpm run check:template-pins &&');
    }
    const step = /- name: Versions the template gets when vendored[^\n]*\n((?:(?!\n\s*- name:)[\s\S])*)/.exec(readFileSync(resolve(ROOT, '.github/workflows/build.yml'), 'utf8'))?.[1] ?? '';
    expect(step).toMatch(/run: pnpm run check:template-pins/);
    expect(step).not.toMatch(/continue-on-error/);
  });
});
