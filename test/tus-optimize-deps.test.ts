import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every CommonJS package the tus-js-client browser build imports must be pre-bundled in dev.
 *
 * The module puts tus-js-client into `build.transpile`, and Nuxt turns every transpile entry
 * into a Vite `optimizeDeps.exclude`. An excluded package is served as-is, and so are the
 * packages it imports unless they are listed explicitly. For an ESM child that is harmless; a
 * CommonJS child reaches the browser raw and its import fails:
 *
 *   The requested module '/_nuxt/@fs/…/url-parse/index.js' does not provide an export named 'default'
 *
 * `useLtTusUpload` catches that and reports "tus-js-client is not installed", so in every
 * consuming project's `nuxt dev` no upload ever started (measured in nuxt-base-starter with
 * tus-js-client 4.3.1). Vite's documented remedy for an excluded ESM package with a CommonJS
 * child is a nested include, `'esm-dep > cjs-dep'`, which `src/module.ts` adds.
 *
 * This test derives the required entries from the INSTALLED tus-js-client rather than from a
 * hand-kept list, so an upgrade that brings a new CommonJS dependency fails here instead of in
 * somebody's dev server.
 */

const ROOT = process.cwd();
const tusRequire = createRequire(createRequire(join(ROOT, 'package.json')).resolve('tus-js-client/package.json'));
const TUS_ROOT = dirname(tusRequire.resolve('tus-js-client/package.json'));

/** The browser-facing ESM build. `lib.esm/node/` is swapped out for `lib.esm/browser/` via the `browser` field. */
function browserBuildFiles(dir = join(TUS_ROOT, 'lib.esm')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node' ? [] : browserBuildFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

function bareImports(): Set<string> {
  const found = new Set<string>();
  for (const file of browserBuildFiles()) {
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1] as string;
      if (!/^[./]/.test(specifier)) found.add(specifier);
    }
  }
  return found;
}

/** A package Vite cannot serve to the browser unbundled: no ESM entry of any kind. */
function isCommonJs(specifier: string): boolean {
  let dir = dirname(tusRequire.resolve(specifier));
  while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const entry = pkg.exports?.['.'] ?? pkg.exports;
  const hasEsmExport = typeof entry === 'object' && entry !== null && 'import' in entry;
  return pkg.type !== 'module' && !pkg.module && !hasEsmExport;
}

/** `'tus-js-client > <dep>'` entries the module adds to `vite.optimizeDeps.include`. */
function nestedIncludes(): string[] {
  const source = readFileSync(resolve(ROOT, 'src', 'module.ts'), 'utf8');
  return [...source.matchAll(/['"]tus-js-client > ([^'"]+)['"]/g)].map((match) => match[1] as string).sort();
}

describe('tus-js-client pre-bundling in dev', () => {
  it('finds the bare imports of the browser build (guard is not vacuous)', () => {
    expect([...bareImports()]).toEqual(expect.arrayContaining(['js-base64', 'url-parse']));
  });

  it('pre-bundles every CommonJS dependency of the tus-js-client browser build', () => {
    const commonJs = [...bareImports()].filter(isCommonJs).sort();

    expect(commonJs).toContain('url-parse');
    expect(nestedIncludes(), "add `'tus-js-client > <dep>'` to vite.optimizeDeps.include in src/module.ts").toEqual(commonJs);
  });

  it('still transpiles tus-js-client, which is what makes the nested include necessary', () => {
    const source = readFileSync(resolve(ROOT, 'src', 'module.ts'), 'utf8');

    expect(source).toContain("nuxt.options.build.transpile.push('tus-js-client')");
  });
});
