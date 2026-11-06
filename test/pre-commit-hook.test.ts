// @vitest-environment node
/**
 * The pre-commit hook commits what was staged, and nothing else.
 *
 * It used to end with `git add -u`, which put every modified tracked file into the commit: in a
 * checkout another session works in too, that session's unfinished work, under somebody else's
 * message. lint-staged, tried next, still worked across the whole working tree, and the review
 * reproduced both outcomes again for a file another session wrote while the hook ran: committed on
 * success, lost on a formatting error (`git reset --hard`). `scripts/format-staged.mjs` now formats
 * the staged content in the index and touches no other file.
 *
 * The end-to-end tests run the real `.githooks/pre-commit` and the real script through real
 * `git commit`s, in throwaway repositories. Only `lint` and `dev:prepare` are stubbed: the type-aware
 * lint needs the whole Nuxt project, and it only reads. The parallel-session tests call
 * `formatStaged` directly with a formatter that writes another file while it runs.
 *
 * The fixtures have no node_modules, on purpose: oxfmt is started by its absolute path from this
 * repository, and pnpm (for the stubbed scripts) finds nothing to install. With this repository's
 * node_modules linked in, pnpm 11's `verifyDepsBeforeRun` found them out of sync with the fixture's
 * package.json and set out to remove them; only ERR_PNPM_UNSAFE_MODULES_DIR stopped it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatStaged, oxfmtFormatter } from '../scripts/lib/format-staged.mjs';

const ROOT = process.cwd();
/** The commands only: comments may name what the code must not do. */
const code = (path: string, comment: RegExp) =>
  readFileSync(resolve(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !comment.test(line))
    .join('\n');
const HOOK = code('.githooks/pre-commit', /^\s*#/);
const FORMAT_STAGED = code('scripts/lib/format-staged.mjs', /^\s*\/\//);

const UNFORMATTED = (name: string, value: number) => `export const ${name}   =   ${value}\n`;
const FORMATTED = (name: string, value: number) => `export const ${name} = ${value};\n`;
// Ten lines, so a change on the first and one on the last line are separate hunks.
const PARTIAL_BASE = ['export const first = 1;', ...Array.from({ length: 8 }, (_, i) => `export const filler${i} = ${i};`), 'export const last = 1;', ''].join('\n');

/** The environment for git in a fixture: nothing inherited from a calling git hook (`pre-push` runs the tests). */
function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

interface Fixture {
  commit: (...args: string[]) => ReturnType<typeof spawnSync>;
  dir: string;
  git: (...args: string[]) => string;
  read: (path: string) => string;
  write: (path: string, content: string) => void;
}

const fixtures: string[] = [];

/** A repository with the real hook, the real script (imported from here) and the stubbed lint, with `files` committed. */
function createFixture(files: Record<string, string>): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'lt-pre-commit-'));
  fixtures.push(dir);
  mkdirSync(join(dir, '.githooks'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'src'));
  copyFileSync(resolve(ROOT, '.githooks/pre-commit'), join(dir, '.githooks/pre-commit'));
  copyFileSync(resolve(ROOT, '.oxfmtrc.jsonc'), join(dir, '.oxfmtrc.jsonc'));
  // The hook runs `node scripts/format-staged.mjs`; this runs the real one, which resolves oxfmt (and every import) from this repository.
  writeFileSync(join(dir, 'scripts/format-staged.mjs'), `import ${JSON.stringify(pathToFileURL(resolve(ROOT, 'scripts/format-staged.mjs')).href)};\n`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pre-commit-fixture', private: true, scripts: { 'dev:prepare': 'node -e 0', lint: 'node -e 0' } }, null, 2));

  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (path: string, content: string) => writeFileSync(join(dir, path), content);
  git('init', '--quiet');
  for (const [key, value] of [
    ['user.name', 'Fixture'],
    ['user.email', 'fixture@test.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
    ['core.hooksPath', '.githooks'],
  ] as const) {
    git('config', key, value);
  }
  for (const [path, content] of Object.entries(files)) write(path, content);
  git('add', '.');
  git('commit', '--quiet', '--no-verify', '-m', 'base');

  return {
    commit: (...args) => spawnSync('git', ['commit', '--quiet', ...args], { cwd: dir, encoding: 'utf8', env: gitEnv() }),
    dir,
    git,
    read: (path) => readFileSync(join(dir, path), 'utf8'),
    write,
  };
}

afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { force: true, recursive: true });
});

describe('pre-commit hook — what reaches the commit', () => {
  let repo: Fixture;
  let commit: ReturnType<typeof spawnSync>;

  beforeAll(() => {
    repo = createFixture({ 'src/foreign.ts': FORMATTED('foreign', 1), 'src/partial.ts': PARTIAL_BASE, 'src/staged.ts': FORMATTED('staged', 1) });

    // What the developer stages: an unformatted change, which the hook formats.
    repo.write('src/staged.ts', UNFORMATTED('staged', 2));
    repo.git('add', 'src/staged.ts');
    // Another session's unfinished work in the same checkout: modified, never staged.
    repo.write('src/foreign.ts', UNFORMATTED('foreign', 2));
    // Partially staged: the first line is staged, the last line is not.
    repo.write('src/partial.ts', PARTIAL_BASE.replace('export const first = 1;', 'export const first   =   10'));
    repo.git('add', 'src/partial.ts');
    repo.write('src/partial.ts', PARTIAL_BASE.replace('export const first = 1;', 'export const first   =   10').replace('export const last = 1;', 'export const last   =   20'));

    commit = repo.commit('-m', 'staged work');
    if (commit.status !== 0) throw new Error(`git commit failed (${commit.status}):\n${commit.stdout}${commit.stderr}`);
  }, 120_000);

  it('commits the staged file formatted, and formats it in the working tree too', () => {
    expect(repo.git('show', 'HEAD:src/staged.ts')).toBe(FORMATTED('staged', 2));
    expect(repo.read('src/staged.ts')).toBe(FORMATTED('staged', 2));
  });

  it('keeps an unstaged file out of the commit, and leaves it in the working tree exactly as it was', () => {
    expect(repo.git('show', 'HEAD:src/foreign.ts')).toBe(FORMATTED('foreign', 1));
    expect(repo.read('src/foreign.ts')).toBe(UNFORMATTED('foreign', 2));
  });

  it('commits only the staged lines of a partially staged file, formatted', () => {
    expect(repo.git('show', 'HEAD:src/partial.ts')).toBe(PARTIAL_BASE.replace('export const first = 1;', 'export const first = 10;'));
  });

  it('leaves the working tree of a partially staged file untouched, unstaged lines included', () => {
    expect(repo.read('src/partial.ts')).toBe(PARTIAL_BASE.replace('export const first = 1;', 'export const first   =   10').replace('export const last = 1;', 'export const last   =   20'));
    expect(repo.git('diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('runs without pnpm installing anything, in the fixture or in this repository', () => {
    expect(String(commit.stderr)).not.toMatch(/ERR_PNPM_|install that runs before scripts/);
    expect(existsSync(join(repo.dir, 'node_modules'))).toBe(false);
  });
});

describe('pre-commit hook — other ways to commit', () => {
  it('`git commit -a` commits every tracked change formatted', { timeout: 60_000 }, () => {
    const repo = createFixture({ 'src/a.ts': FORMATTED('a', 1), 'src/b.ts': FORMATTED('b', 1) });
    repo.write('src/a.ts', UNFORMATTED('a', 2));
    repo.write('src/b.ts', UNFORMATTED('b', 2));

    expect(repo.commit('-a', '-m', 'all').status).toBe(0);

    expect(repo.git('show', 'HEAD:src/a.ts')).toBe(FORMATTED('a', 2));
    expect(repo.git('show', 'HEAD:src/b.ts')).toBe(FORMATTED('b', 2));
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it('`git commit <path>` commits that path formatted and leaves every other file alone', { timeout: 60_000 }, () => {
    const repo = createFixture({ 'src/a.ts': FORMATTED('a', 1), 'src/b.ts': FORMATTED('b', 1) });
    repo.write('src/a.ts', UNFORMATTED('a', 3));
    repo.write('src/b.ts', UNFORMATTED('b', 3));

    expect(repo.commit('-m', 'only a', 'src/a.ts').status).toBe(0);

    expect(repo.git('show', 'HEAD:src/a.ts')).toBe(FORMATTED('a', 3));
    expect(repo.git('show', 'HEAD:src/b.ts')).toBe(FORMATTED('b', 1));
    expect(repo.read('src/b.ts')).toBe(UNFORMATTED('b', 3));
    // The default index matches the commit for a.ts, so nothing is left over for it.
    expect(repo.git('status', '--porcelain')).toBe(' M src/b.ts\n');
  });

  it('refuses the commit when a staged file cannot be formatted, and changes nothing', { timeout: 60_000 }, () => {
    const repo = createFixture({ 'src/good.ts': FORMATTED('good', 1) });
    repo.write('src/good.ts', UNFORMATTED('good', 2));
    repo.write('src/bad.ts', 'export const bad = (;\n');
    repo.git('add', 'src/good.ts', 'src/bad.ts');

    const commit = repo.commit('-m', 'broken');

    expect(commit.status).not.toBe(0);
    expect(String(commit.stderr)).toMatch(/src\/bad\.ts/);
    expect(repo.git('log', '--format=%s')).toBe('base\n');
    expect(repo.git('show', ':src/good.ts')).toBe(UNFORMATTED('good', 2));
    expect(repo.read('src/good.ts')).toBe(UNFORMATTED('good', 2));
  });

  it('commits a staged file oxfmt does not format as it is', { timeout: 60_000 }, () => {
    const repo = createFixture({ 'src/a.ts': FORMATTED('a', 1) });
    repo.write('src/icon.png', 'not really a png');
    repo.write('src/a.ts', UNFORMATTED('a', 2));
    repo.git('add', 'src/icon.png', 'src/a.ts');

    expect(repo.commit('-m', 'with asset').status).toBe(0);

    expect(repo.git('show', 'HEAD:src/icon.png')).toBe('not really a png');
    expect(repo.git('show', 'HEAD:src/a.ts')).toBe(FORMATTED('a', 2));
  });
});

describe('formatStaged — another session writes while it runs', () => {
  const oxfmt = oxfmtFormatter(ROOT);

  it('stages nothing but the staged files, and leaves the other session’s write in the working tree', { timeout: 60_000 }, () => {
    const repo = createFixture({ 'src/foreign.ts': FORMATTED('foreign', 1), 'src/staged.ts': FORMATTED('staged', 1) });
    repo.write('src/staged.ts', UNFORMATTED('staged', 2));
    repo.git('add', 'src/staged.ts');

    const result = formatStaged({
      cwd: repo.dir,
      env: gitEnv(),
      format: (path, content, context) => {
        appendFileSync(join(repo.dir, 'src/foreign.ts'), '// other session, unfinished\n');
        return oxfmt(path, content, context);
      },
    });

    expect(result).toEqual({ errors: [], formatted: ['src/staged.ts'] });
    expect(repo.git('diff', '--cached', '--name-only')).toBe('src/staged.ts\n');
    expect(repo.git('show', ':src/staged.ts')).toBe(FORMATTED('staged', 2));
    expect(repo.read('src/foreign.ts')).toBe(`${FORMATTED('foreign', 1)}// other session, unfinished\n`);
  });

  it('loses nothing the other session wrote when a staged file cannot be formatted', { timeout: 60_000 }, () => {
    const repo = createFixture({ 'src/foreign.ts': FORMATTED('foreign', 1), 'src/good.ts': FORMATTED('good', 1) });
    repo.write('src/good.ts', UNFORMATTED('good', 2));
    repo.write('src/bad.ts', 'export const bad = (;\n');
    repo.git('add', 'src/good.ts', 'src/bad.ts');

    const result = formatStaged({
      cwd: repo.dir,
      env: gitEnv(),
      format: (path, content, context) => {
        appendFileSync(join(repo.dir, 'src/foreign.ts'), `// other session, while ${path} was formatted\n`);
        return oxfmt(path, content, context);
      },
    });

    expect(result.errors.map((error) => error.path)).toEqual(['src/bad.ts']);
    expect(result.formatted).toEqual([]);
    expect(repo.read('src/foreign.ts')).toBe(
      `${FORMATTED('foreign', 1)}// other session, while src/bad.ts was formatted\n// other session, while src/good.ts was formatted\n`,
    );
    expect(repo.git('show', ':src/good.ts')).toBe(UNFORMATTED('good', 2));
    expect(repo.git('diff', '--cached', '--name-only')).toBe('src/bad.ts\nsrc/good.ts\n');
  });
});

describe('pre-commit hook — source guards', () => {
  it('formats through scripts/format-staged.mjs and never stages anything itself', () => {
    expect(HOOK).toMatch(/^node scripts\/format-staged\.mjs \|\| exit 1$/m);
    expect(HOOK).not.toMatch(/\bgit\s+add\b/);
    expect(HOOK).not.toMatch(/\bpnpm (run |exec )?(format|lint-staged)\b/);
  });

  it('formats in the index only: no add, reset, stash, checkout, restore or clean', () => {
    expect(FORMAT_STAGED).toMatch(/"update-index", "--cacheinfo"/);
    expect(FORMAT_STAGED).not.toMatch(/git\(\s*\[\s*"(add|reset|stash|checkout|restore|clean)"/);
  });

  it('still lints, after preparing .nuxt when it is missing', () => {
    expect(HOOK).toMatch(/\[ -f \.nuxt\/tsconfig\.json \] \|\| pnpm dev:prepare \|\| exit 1/);
    expect(HOOK).toMatch(/\bpnpm lint \|\| exit 1/);
  });
});
