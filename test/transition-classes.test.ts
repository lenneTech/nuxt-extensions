/**
 * The `LtTransition*` components against Tailwind 4 (DEV-4071).
 *
 * Their classes are compiled with the Tailwind version the stack uses. `duration-[--start-duration]`
 * is Tailwind 3's shorthand for a CSS variable; Tailwind 4 compiles it to
 * `transition-duration: --start-duration`, which the browser drops as invalid, so the
 * `startDuration` / `leaveDuration` props had no effect. Tailwind 4 writes `duration-(--start-duration)`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const DIR = join(__dirname, '../src/runtime/components/transition');
const COMPONENTS = readdirSync(DIR).filter((name) => name.endsWith('.vue'));

/** Every class of every `*-class="…"` attribute of a component */
function transitionClasses(file: string): string[] {
  const source = readFileSync(join(DIR, file), 'utf8');
  return [...source.matchAll(/\b[a-z-]+-class="([^"]*)"/g)].flatMap((match) => match[1]!.split(/\s+/).filter(Boolean));
}

let build: (candidates: string[]) => string;

beforeAll(async () => {
  const tailwindCss = require.resolve('tailwindcss/index.css');
  const compiler = await compile('@import "tailwindcss";', {
    base: dirname(tailwindCss),
    loadStylesheet: async (_id, base) => ({ base, content: readFileSync(tailwindCss, 'utf8'), path: tailwindCss }),
  });
  build = (candidates) => compiler.build(candidates);
});

/** The declarations Tailwind generates for exactly one class, whitespace collapsed; '' for an unknown class */
function cssFor(candidate: string): string {
  const css = build([candidate]);
  // The selector as Tailwind writes it (`.duration-\(--start-duration\)`), then escaped for the RegExp
  const selector = `.${candidate.replace(/[[\]()%:./]/g, (char) => `\\${char}`)}`;
  const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  return rule ? rule[1]!.replace(/\s+/g, ' ').trim() : '';
}

describe('LtTransition* classes under Tailwind 4', () => {
  it('finds the five components and their classes', () => {
    expect(COMPONENTS).toHaveLength(5);
    for (const file of COMPONENTS) expect(transitionClasses(file).length).toBeGreaterThan(5);
  });

  it.each(COMPONENTS)('%s: every class compiles to CSS', (file) => {
    const unknown = transitionClasses(file).filter((candidate) => cssFor(candidate) === '');
    expect(unknown).toEqual([]);
  });

  it.each(COMPONENTS)('%s: no class compiles to a bare CSS variable name, which the browser drops', (file) => {
    const broken = transitionClasses(file).filter((candidate) => /:\s*--[\w-]+\s*;/.test(cssFor(candidate)));
    expect(broken).toEqual([]);
  });

  it('LtTransitionFade and LtTransitionFadeScale take their durations from the props', () => {
    for (const file of ['LtTransitionFade.vue', 'LtTransitionFadeScale.vue']) {
      const classes = transitionClasses(file);
      expect(classes).toContain('duration-(--start-duration)');
      expect(classes).toContain('duration-(--leave-duration)');
    }
    expect(cssFor('duration-(--start-duration)')).toContain('transition-duration: var(--start-duration)');
    expect(cssFor('duration-(--leave-duration)')).toContain('transition-duration: var(--leave-duration)');
  });
});
