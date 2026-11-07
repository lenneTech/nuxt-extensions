import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every name the shipped docs import from a subpath entry exists (DEV-4080).
 *
 * CLAUDE.md goes out with the package to every project, where agents copy its examples.
 * It showed `import { createTestUser, loginTestUser } from '@lenne.tech/nuxt-extensions/testing'`
 * for a long time; neither name was ever exported. An example that does not compile is worse
 * than none, because it is copied with confidence.
 *
 * Checked against the source barrels the subpaths are built from: values by importing the
 * barrel, types by their `type Name` entry in the barrel's export list.
 */

const ROOT = process.cwd();
const DOCS = ['CLAUDE.md', 'README.md'];

const ENTRIES = {
  lib: { barrel: 'src/runtime/lib/index.ts', load: () => import('../src/runtime/lib') },
  testing: { barrel: 'src/runtime/testing/index.ts', load: () => import('../src/runtime/testing') },
} as const;

type Entry = keyof typeof ENTRIES;

/** `{ a, b as c, type T }` from every `import … from '@lenne.tech/nuxt-extensions/<entry>'`, one or many lines. */
function importedNames(markdown: string): { entry: Entry; name: string }[] {
  const found: { entry: Entry; name: string }[] = [];
  const pattern = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@lenne\.tech\/nuxt-extensions\/(lib|testing)['"]/g;
  for (const match of markdown.matchAll(pattern)) {
    const entry = match[2] as Entry;
    for (const part of (match[1] ?? '').split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) {
        found.push({ entry, name });
      }
    }
  }
  return found;
}

describe('imports shown in the shipped docs', () => {
  const imports = DOCS.flatMap((doc) => importedNames(readFileSync(resolve(ROOT, doc), 'utf8')).map((item) => ({ ...item, doc })));

  it('finds the examples it is meant to check (guard is not vacuous)', () => {
    expect(imports.some((item) => item.doc === 'CLAUDE.md' && item.entry === 'testing')).toBe(true);
    expect(imports.some((item) => item.doc === 'README.md' && item.entry === 'lib')).toBe(true);
  });

  it('imports only names the entry exports', async () => {
    const missing: string[] = [];

    for (const [entry, { barrel, load }] of Object.entries(ENTRIES)) {
      const values = await load();
      const barrelSource = readFileSync(resolve(ROOT, barrel), 'utf8');

      for (const item of imports.filter((candidate) => candidate.entry === entry)) {
        const isValue = item.name in values;
        const isType = new RegExp(String.raw`\btype\s+${item.name}\b`).test(barrelSource);
        if (!isValue && !isType) {
          missing.push(`${item.doc}: ${item.name} from '@lenne.tech/nuxt-extensions/${entry}'`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('recognises the names the old CLAUDE.md example used as missing', () => {
    const old = "import { createTestUser, loginTestUser } from '@lenne.tech/nuxt-extensions/testing';";
    expect(importedNames(old).map((item) => item.name)).toEqual(['createTestUser', 'loginTestUser']);
  });
});
