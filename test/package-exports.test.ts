import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the package exports and what it depends on (DEV-4079).
 *
 * 1. `src/index.ts` IS used, just not by npm. The module builder builds `src/module.ts`, so npm
 *    mode never sees it. Vendor mode does: the lt CLI copies it to `app/core/index.ts` and
 *    rewrites `from '@lenne.tech/nuxt-extensions'` to `app/core`. It was a hand-written list
 *    that stopped growing in 1.7.1 and missed three composables; it now re-exports whole
 *    barrels, and this file checks every runtime export actually arrives.
 * 2. Every package `src/` imports is declared. `@nuxt/ui` was imported (toast) and aliased onto
 *    a stub when absent, so it was treated as an optional peer without being one.
 * 3. No type is declared twice. `LtErrorTranslationModuleOptions` existed in `types/error.ts`
 *    and `types/module.ts`; the barrel exported one, the other could drift unseen.
 */

const ROOT = process.cwd();
const SRC = resolve(ROOT, 'src');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.vue'))
    .map((file) => join(dir, file));
}

/** Package name of a bare specifier: `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/** Bare specifiers of real import/export statements and dynamic imports; comments do not count. */
function bareSpecifiers(source: string): string[] {
  const found: string[] = [];
  const statement = /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm;
  const sideEffect = /^\s*import\s+['"]([^'"]+)['"]/gm;
  const dynamic = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const pattern of [statement, sideEffect, dynamic]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? '';
      if (!specifier.startsWith('.') && !specifier.startsWith('#') && !specifier.startsWith('~')) {
        found.push(specifier);
      }
    }
  }
  return found;
}

describe('the vendored entry point (src/index.ts)', () => {
  it('re-exports every runtime value of the composables, lib and utils barrels', async () => {
    const entry = await import('../src/index');
    const barrels = {
      composables: await import('../src/runtime/composables'),
      lib: await import('../src/runtime/lib'),
      utils: await import('../src/runtime/utils'),
    };

    const missing: string[] = [];
    let checked = 0;
    for (const [barrel, exports] of Object.entries(barrels)) {
      for (const name of Object.keys(exports)) {
        checked++;
        if (!(name in entry)) {
          missing.push(`${barrel}: ${name}`);
        }
      }
    }

    expect(checked).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  it('includes the composables the hand-written list had lost', async () => {
    const entry = await import('../src/index');
    for (const name of ['useLtAiSettings', 'useLtAiStatus', 'useLtOfflineSync']) {
      expect(entry, name).toHaveProperty(name);
    }
  });

  it('exports the module itself the way the npm entry does', async () => {
    const entry = await import('../src/index');
    const module = await import('../src/module');
    expect(entry.default).toBe(module.default);
    expect(entry.name).toBe('@lenne.tech/nuxt-extensions');
    expect(entry.configKey).toBe('ltExtensions');
  });

  it('carries the same type barrel as module.ts, the npm entry', () => {
    const typeBarrel = "export type * from './runtime/types';";
    expect(readFileSync(resolve(SRC, 'index.ts'), 'utf8')).toContain(typeBarrel);
    expect(readFileSync(resolve(SRC, 'module.ts'), 'utf8')).toContain(typeBarrel);
  });
});

describe('declared dependencies', () => {
  // `vue` comes with the `nuxt` peer; the module never runs without it.
  const providedByNuxt = new Set(['vue']);
  const builtins = new Set(builtinModules);

  it('declares every package src/ imports, as a dependency or a peer', () => {
    const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
    const undeclared = new Map<string, string>();
    let imports = 0;

    for (const file of sourceFiles(SRC)) {
      for (const specifier of bareSpecifiers(readFileSync(file, 'utf8'))) {
        imports++;
        const name = packageName(specifier);
        if (specifier.startsWith('node:') || builtins.has(name) || providedByNuxt.has(name) || name === pkg.name) {
          continue;
        }
        if (!declared.has(name)) {
          undeclared.set(name, file.slice(ROOT.length + 1));
        }
      }
    }

    expect(imports).toBeGreaterThan(10);
    expect(Object.fromEntries(undeclared)).toEqual({});
  });

  it('declares @nuxt/ui and tailwindcss as OPTIONAL peers', () => {
    // @nuxt/ui: the toast import, aliased onto a stub when absent (module.ts).
    // tailwindcss: the LtTransition* classes, in Tailwind 4 syntax since DEV-4071.
    for (const name of ['@nuxt/ui', 'tailwindcss']) {
      expect(pkg.peerDependencies?.[name], name).toBeTruthy();
      expect(pkg.peerDependenciesMeta?.[name]?.optional, name).toBe(true);
    }
  });
});

describe('type declarations', () => {
  it('declares no exported type or interface twice under src/runtime/types', () => {
    const typesDir = resolve(SRC, 'runtime', 'types');
    const seen = new Map<string, string[]>();

    for (const file of sourceFiles(typesDir)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/^export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/gm)) {
        const name = match[1] ?? '';
        seen.set(name, [...(seen.get(name) ?? []), file.slice(typesDir.length + 1)]);
      }
    }

    const duplicates = [...seen].filter(([, files]) => files.length > 1);
    expect(seen.size).toBeGreaterThan(30);
    expect(Object.fromEntries(duplicates)).toEqual({});
  });
});
