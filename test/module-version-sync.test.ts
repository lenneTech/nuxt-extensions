import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards `scripts/sync-module-version.mjs` — the script that keeps
// `export const version` in src/module.ts aligned with package.json.
//
// Why this file exists, in the script author's own words (its header): the original
// pattern matched only double quotes while the oxfmt-formatted source uses single
// quotes. `String.replace` with a non-matching pattern returns the input unchanged,
// so the script wrote the file back untouched and reported success — the version
// silently froze at 1.5.2 for THREE minor releases.
//
// The header says the not-found guard now prevents that. It does. But measured
// against the suite, deleting that guard cost ZERO test failures:
//
//   regex reverted to double-quote-only + guard removed + module.ts desynced
//     version:check   exit 0 — "in sync (1.15.0)"     <- the original bug, back
//     version:sync    exit 0 — file left untouched
//     vitest          260 passed
//
// A guard whose own removal is undetectable is one refactor from re-arming the bug
// it was written for. These tests fail if it goes.
//
// This matters more than the check-script coverage suggests: CI runs `lint`,
// `dev:prepare`, `test`, `build` — NOT `version:check`. vitest is the only gate CI
// enforces, so the invariant has to live here to be enforced anywhere but a laptop.

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, 'scripts/sync-module-version.mjs');

interface RunResult {
  status: number;
  stderr: string;
  stdout: string;
}

/**
 * Runs the real script against a throwaway package, so the repo's own
 * package.json and src/module.ts are never touched.
 */
function runInFixture(packageVersion: string, moduleSource: string, args: string[] = []): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'lt-version-sync-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: packageVersion }, null, 2));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/module.ts'), moduleSource);

    let status = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      const e = error as { status?: number; stderr?: string; stdout?: string };
      status = e.status ?? 1;
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
    }

    return { status, stderr, stdout: stdout + readBack(dir) };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/** Appends the resulting module source so assertions can inspect what was written. */
function readBack(dir: string): string {
  return `\n---MODULE---\n${readFileSync(join(dir, 'src/module.ts'), 'utf8')}`;
}

const singleQuoted = (v: string) => `export const name = 'x';\nexport const version = '${v}';\n`;
const doubleQuoted = (v: string) => `export const name = "x";\nexport const version = "${v}";\n`;

describe('sync-module-version', () => {
  describe('--check mode', () => {
    it('exits 0 when the module version matches package.json', () => {
      const r = runInFixture('1.15.0', singleQuoted('1.15.0'), ['--check']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('in sync (1.15.0)');
    });

    it('exits 1 when the module version has drifted', () => {
      const r = runInFixture('1.15.0', singleQuoted('1.14.0'), ['--check']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('OUT OF SYNC');
    });

    it('does not modify the file in check mode', () => {
      const r = runInFixture('1.15.0', singleQuoted('1.14.0'), ['--check']);
      expect(r.stdout).toContain("export const version = '1.14.0'");
    });
  });

  describe('write mode', () => {
    it('rewrites a single-quoted export (the oxfmt style this repo uses)', () => {
      const r = runInFixture('1.15.0', singleQuoted('1.14.0'));
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("export const version = '1.15.0'");
    });

    it('rewrites a double-quoted export and normalises it to single quotes', () => {
      // The historical bug was a pattern that saw only ONE quote style. Both must work,
      // and the output must stay oxfmt-clean.
      const r = runInFixture('1.15.0', doubleQuoted('1.14.0'));
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("export const version = '1.15.0'");
      expect(r.stdout).not.toContain('export const version = "');
    });
  });

  // THE load-bearing test. Mutation-verified: delete the `if (!pattern.test(content))`
  // block in the script and this case — and only this case — turns red.
  describe('the not-found guard', () => {
    const withoutExport = "export const name = 'x';\n// no version export here\n";

    it('exits non-zero in --check mode when the version export cannot be found', () => {
      const r = runInFixture('1.15.0', withoutExport, ['--check']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('no `export const version` found');
    });

    it('exits non-zero in write mode rather than silently writing nothing', () => {
      // This is the exact 1.5.2 failure mode: a no-op that reports success. `prepack`
      // runs write mode, so a silent no-op here publishes a wrong `meta.version`.
      const r = runInFixture('1.15.0', withoutExport);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('no `export const version` found');
    });
  });
});

describe('release metadata consistency', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

  it('src/module.ts carries the package.json version', () => {
    const source = readFileSync(resolve(ROOT, 'src/module.ts'), 'utf8');
    expect(source).toContain(`export const version = '${pkg.version}'`);
  });

  it('the newest CHANGELOG entry is for the version being published', () => {
    // Nothing else asserts this. A release whose notes are headed with the previous
    // version publishes an entry nobody can find by version number.
    const changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');
    const firstEntry = /^## \[([^\]]+)\]/m.exec(changelog);
    expect(firstEntry, 'expected a "## [x.y.z]" heading in CHANGELOG.md').toBeTruthy();
    expect(firstEntry?.[1]).toBe(pkg.version);
  });
});
