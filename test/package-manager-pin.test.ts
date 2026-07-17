import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard the "packageManager as single source of truth" contract: Node >= 25 no
// longer ships corepack, so the exact pnpm version must be pinned as
// `packageManager` in the root package.json and provisioned everywhere via
// `npm install -g "$(node -p "require('./package.json').packageManager.split('+')[0]")"`.
// CI must not carry its own pnpm version (pnpm/action-setup reads the field
// automatically) — a duplicate pin drifts silently and breaks builds the day
// the next pnpm major releases.

const ROOT = process.cwd();
const WORKFLOWS = resolve(ROOT, '.github/workflows');

const PIN_PATTERN = /^pnpm@(\d+)\.\d+\.\d+\+sha512\.[A-Za-z0-9]+$/;

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  engines?: Record<string, string>;
  packageManager?: string;
};

describe('packageManager pin contract', () => {
  it('root package.json pins an exact pnpm version with integrity hash', () => {
    expect(pkg.packageManager, 'root package.json must declare "packageManager"').toBeDefined();
    expect(pkg.packageManager).toMatch(PIN_PATTERN);
  });

  it('engines.pnpm matches the pinned major version', () => {
    const major = pkg.packageManager?.match(PIN_PATTERN)?.[1];
    expect(major, 'packageManager must expose a parsable major version').toBeDefined();
    expect(pkg.engines?.pnpm).toBe(`^${major}.0.0`);
  });

  it('workflows rely on the packageManager field instead of a duplicate pnpm version', () => {
    const workflowFiles = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    expect(workflowFiles.length).toBeGreaterThan(0);

    for (const file of workflowFiles) {
      const src = readFileSync(resolve(WORKFLOWS, file), 'utf8');

      // Split into steps so `node-version:` of other steps cannot false-positive.
      for (const step of src.split(/\n(?=\s*- (?:name|uses):)/)) {
        if (!step.includes('pnpm/action-setup')) continue;
        expect(step, `${file}: pnpm/action-setup must not carry a 'version:' input`).not.toMatch(/^\s*version:/m);
      }

      expect(src, `${file}: hardcoded 'npm install -g pnpm@<version>' duplicates the pin`).not.toMatch(
        /npm install -g pnpm@\d/,
      );
    }
  });

  // Functional proof of the provisioning chain: derive the pin from package.json
  // and install it into a throwaway npm prefix. Needs network and ~10 MB, so it
  // only runs in CI or when PIN_PROVISION_TEST is set.
  it.runIf(process.env.CI || process.env.PIN_PROVISION_TEST)(
    'derive-line provisions exactly the pinned pnpm version',
    { timeout: 180_000 },
    () => {
      const pinned = pkg.packageManager?.split('+')[0];
      expect(pinned).toBeDefined();

      const derived = execSync(`node -p "require('./package.json').packageManager.split('+')[0]"`, {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
      expect(derived).toBe(pinned);

      const prefix = mkdtempSync(join(tmpdir(), 'pnpm-pin-'));
      try {
        execSync(`npm install -g --prefix "${prefix}" "${derived}"`, { encoding: 'utf8', stdio: 'pipe' });
        const version = execSync(`"${join(prefix, 'bin', 'pnpm')}" --version`, { encoding: 'utf8' }).trim();
        expect(`pnpm@${version}`).toBe(pinned);
      } finally {
        rmSync(prefix, { force: true, recursive: true });
      }
    },
  );
});
