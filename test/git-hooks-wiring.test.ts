import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The `.githooks` scripts (format + lint on commit, prepare + test + build on push) only run
// because `prepare` points git at them on every install. Nothing else notices when that line
// goes: install, check, CI and the build stay green, and a fresh clone simply commits and
// pushes without the local gate. It went once, as a side effect of a maintenance run that
// rewrote package.json in a scratch step (found in review before 1.20.0 shipped).

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

describe('git hooks wiring', () => {
  it('points git at .githooks on every install', () => {
    expect(pkg.scripts?.prepare).toBe('git config core.hooksPath .githooks');
  });

  it('ships the hooks the prepare script points at', () => {
    for (const hook of ['pre-commit', 'pre-push']) {
      expect(existsSync(resolve(ROOT, '.githooks', hook)), `.githooks/${hook} is missing`).toBe(true);
    }
  });
});
