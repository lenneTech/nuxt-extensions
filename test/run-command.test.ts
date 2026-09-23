/**
 * `scripts/lib/run-command.mjs` — the one way the check scripts start npm-installed commands.
 *
 * Two defects this guards, both measured on the Windows CI runner (Node 24.20.0):
 *  - `execFileSync("npm" | "pnpm", …)` fails with ENOENT there, because both are `.cmd` shims.
 *    `configuredRegistry()` swallowed that into `""`; `check:manifest` reported it as
 *    "`npm pack --dry-run` failed:" followed by NOTHING, because it printed only stdout + stderr,
 *    and both are empty when the process never started.
 *  - so a failure report must always name the command and the reason, even with no output.
 *
 * The shim cases pass trivially on macOS/Linux; on the Windows job they are the proof.
 */

import { describe, expect, it } from 'vitest';

import { describeCommandFailure, runCommandSync } from '../scripts/lib/run-command.mjs';

const MISSING = 'lt-definitely-not-installed-command';

function failureOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the command to fail');
}

describe('runCommandSync', () => {
  it('starts the npm shim and returns its stdout', () => {
    expect(runCommandSync('npm', ['--version']).trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('starts the pnpm shim and returns its stdout', () => {
    expect(runCommandSync('pnpm', ['--version']).trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('passes arguments with spaces through as one argument', () => {
    const out = runCommandSync(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'a b', 'c']);
    expect(JSON.parse(out)).toEqual(['a b', 'c']);
  });

  it('names the command and the spawn error when the command cannot start', () => {
    const error = failureOf(() => runCommandSync(MISSING, ['--flag'])) as Error & { code?: string };

    expect(error.message).toContain(`${MISSING} --flag`);
    expect(error.message).toContain('could not start');
    expect(error.code).toBe('ENOENT');
  });

  it('names the command and the exit status on a non-zero exit, and keeps the output', () => {
    const error = failureOf(() =>
      runCommandSync(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(3)']),
    ) as Error & { status?: number; stderr?: string };

    expect(error.message).toContain('exited with status 3');
    expect(error.status).toBe(3);
    expect(error.stderr).toBe('boom');
  });
});

describe('describeCommandFailure', () => {
  it('is never empty for a command that produced no output', () => {
    const report = describeCommandFailure(failureOf(() => runCommandSync(MISSING)));

    expect(report).toContain(MISSING);
    expect(report).toContain('ENOENT');
  });

  it('appends the tail of the command output', () => {
    const report = describeCommandFailure(
      failureOf(() => runCommandSync(process.execPath, ['-e', 'console.log("1\\n2\\n3"); process.exit(1)'])),
      2,
    );

    expect(report).toMatch(/exited with status 1\n2\n3$/);
  });
});
