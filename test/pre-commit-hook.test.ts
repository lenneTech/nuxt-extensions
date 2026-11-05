// @vitest-environment node
/**
 * The pre-commit hook commits what was staged, and nothing else.
 *
 * It used to end with `git add -u`, which put every modified tracked file into the commit. In a
 * checkout another session works in too, that is that session's unfinished work, committed under
 * somebody else's message. It also formatted all of `src/`, rewriting files nobody had staged.
 *
 * These tests run the real `.githooks/pre-commit` and the real `lint-staged` config from
 * package.json through a real `git commit`, in a throwaway repository that borrows this
 * repository's node_modules. Only `lint` and `dev:prepare` are stubbed: the type-aware lint needs
 * the whole Nuxt project, and it only reads, so it cannot change what a commit contains.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
// The commands only: the hook's comments may name what it must not do.
const HOOK = readFileSync(resolve(ROOT, '.githooks/pre-commit'), 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  'lint-staged'?: unknown;
  scripts: Record<string, string>;
};

// Ten lines, so a change on the first and one on the last line are separate hunks.
const PARTIAL_BASE = ['export const first = 1;', ...Array.from({ length: 8 }, (_, i) => `export const filler${i} = ${i};`), 'export const last = 1;', ''].join('\n');

let repo: string;

/** Runs git in the throwaway repository, without anything the calling process inherited from a git hook. */
function git(...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(path: string, content: string): void {
  writeFileSync(join(repo, path), content);
}

function worktree(path: string): string {
  return readFileSync(join(repo, path), 'utf8');
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'lt-pre-commit-'));
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, '.githooks'));
  copyFileSync(resolve(ROOT, '.githooks/pre-commit'), join(repo, '.githooks/pre-commit'));
  copyFileSync(resolve(ROOT, '.oxfmtrc.jsonc'), join(repo, '.oxfmtrc.jsonc'));
  // A junction needs no privileges on Windows; elsewhere the type is ignored.
  symlinkSync(resolve(ROOT, 'node_modules'), join(repo, 'node_modules'), 'junction');
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify(
      {
        'lint-staged': pkg['lint-staged'],
        name: 'pre-commit-fixture',
        private: true,
        scripts: { 'dev:prepare': 'node -e 0', format: pkg.scripts.format, lint: 'node -e 0' },
      },
      null,
      2,
    ),
  );
  write('.gitignore', 'node_modules\n');

  git('init', '--quiet');
  for (const [key, value] of [
    ['user.name', 'Fixture'],
    ['user.email', 'fixture@test.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
    ['core.hooksPath', '.githooks'],
  ]) {
    git('config', key!, value!);
  }

  write('src/staged.ts', 'export const staged = 1;\n');
  write('src/foreign.ts', 'export const foreign = 1;\n');
  write('src/partial.ts', PARTIAL_BASE);
  git('add', '.');
  git('commit', '--quiet', '--no-verify', '-m', 'base');

  // What the developer stages: an unformatted change, which the hook formats.
  write('src/staged.ts', 'export const staged   =   2\n');
  git('add', 'src/staged.ts');

  // Another session's unfinished work in the same checkout: modified, never staged.
  write('src/foreign.ts', 'export const foreign   =   2\n');

  // Partially staged: the first line is staged, the last line is not.
  write('src/partial.ts', PARTIAL_BASE.replace('export const first = 1;', 'export const first   =   10'));
  git('add', 'src/partial.ts');
  write('src/partial.ts', PARTIAL_BASE.replace('export const first = 1;', 'export const first   =   10').replace('export const last = 1;', 'export const last   =   20'));

  git('commit', '--quiet', '-m', 'staged work');
}, 120_000);

afterAll(() => {
  if (repo) rmSync(repo, { force: true, recursive: true });
});

describe('pre-commit hook — what reaches the commit', () => {
  it('commits the staged file, formatted', () => {
    expect(git('show', 'HEAD:src/staged.ts')).toBe('export const staged = 2;\n');
  });

  it('keeps an unstaged file out of the commit', () => {
    expect(git('show', 'HEAD:src/foreign.ts')).toBe('export const foreign = 1;\n');
    expect(git('diff', '--name-only', 'HEAD', '--', 'src/foreign.ts').trim()).toBe('src/foreign.ts');
  });

  it('leaves an unstaged file in the working tree exactly as it was, unformatted', () => {
    expect(worktree('src/foreign.ts')).toBe('export const foreign   =   2\n');
  });

  it('commits only the staged lines of a partially staged file', () => {
    const committed = git('show', 'HEAD:src/partial.ts');
    expect(committed).toContain('export const first = 10;');
    expect(committed).toContain('export const last = 1;');
    expect(committed).not.toContain('= 20');
  });

  it('keeps the unstaged lines of a partially staged file in the working tree, untouched', () => {
    expect(worktree('src/partial.ts')).toContain('export const last   =   20');
    expect(git('diff', '--cached', '--name-only').trim()).toBe('');
  });
});

describe('pre-commit hook — source guards', () => {
  it('never stages anything itself', () => {
    // lint-staged re-stages exactly the files it formatted. Any `git add` here widens that again.
    expect(HOOK).not.toMatch(/\bgit\s+add\b/);
  });

  it('formats through lint-staged, not across src/', () => {
    expect(HOOK).toMatch(/\bpnpm exec lint-staged\b/);
    expect(HOOK).not.toMatch(/\bpnpm (run )?format\b/);
  });

  it('still lints, after preparing .nuxt when it is missing', () => {
    expect(HOOK).toMatch(/\[ -f \.nuxt\/tsconfig\.json \] \|\| pnpm dev:prepare \|\| exit 1/);
    expect(HOOK).toMatch(/\bpnpm lint \|\| exit 1/);
  });
});
