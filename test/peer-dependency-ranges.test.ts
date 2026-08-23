import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the invariant that the peer range this package PUBLISHES is one the suite
// actually TESTS against.
//
// The bug this prevents is the one 1.15.0 exists to correct, in its general form:
// `peerDependencies.better-auth` said `>=1.0.0` while the code only ever ran against
// the version in `devDependencies`. The manifest asserted something about versions
// nobody had exercised, and nothing anywhere disagreed.
//
// Measured before this file existed — a peer range of `>=1.9.0 <1.10.0` against a
// devDependency of `1.7.1` produced:
//
//   vitest          260 passed
//   check:manifest  exit 0
//   check:consumer  exit 0   (npm resolves an unmet peer of a file: dep with a WARNING)
//   pnpm install    exit 0   (pnpm-workspace.yaml sets strictPeerDependencies: false)
//
// So the full guard inventory for the published range was: nothing. Hence this test.
//
// It covers OPTIONAL peers too. `check-consumer-build.mjs` deliberately omits those
// (correctly — its job is proving the build survives their absence), which left
// `@better-auth/passkey` as the half no process in the repo ever looked at.

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

/**
 * Minimal semver range check for the shapes this manifest uses.
 *
 * Deliberately NOT a new dependency: the ranges here are hand-written and simple
 * (`>=x.y.z`, `<x.y.z`, `^x.y.z`, and conjunctions of those). A parser that only
 * understands what we write is easier to audit than one that understands everything.
 * It THROWS on a range shape it does not know, so a future exotic range fails loudly
 * instead of being silently reported as satisfied.
 */
function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    throw new Error(`Cannot parse version "${version}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0 as 0 | 1 | 2; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);

  return range
    .trim()
    .split(/\s+/)
    .every((clause) => {
      if (clause.startsWith('>=')) {
        return compare(v, parseVersion(clause.slice(2))) >= 0;
      }
      if (clause.startsWith('<=')) {
        return compare(v, parseVersion(clause.slice(2))) <= 0;
      }
      if (clause.startsWith('<')) {
        return compare(v, parseVersion(clause.slice(1))) < 0;
      }
      if (clause.startsWith('>')) {
        return compare(v, parseVersion(clause.slice(1))) > 0;
      }
      if (clause.startsWith('^')) {
        const lower = parseVersion(clause.slice(1));
        if (compare(v, lower) < 0) {
          return false;
        }
        // ^0.x.y is caret-pinned to the MINOR, ^x.y.z to the major.
        return lower[0] === 0 ? v[0] === 0 && v[1] === lower[1] : v[0] === lower[0];
      }
      throw new Error(`Unsupported range clause "${clause}" in "${range}" — extend this parser deliberately.`);
    });
}

describe('peer dependency ranges', () => {
  // Sanity-checks the comparator itself. Without these, a comparator that always
  // returned `true` would make every assertion below vacuous.
  describe('range parser', () => {
    it('accepts versions inside a bounded range', () => {
      expect(satisfies('1.7.1', '>=1.7.1 <1.8.0')).toBe(true);
      expect(satisfies('1.7.9', '>=1.7.1 <1.8.0')).toBe(true);
    });

    it('rejects versions outside a bounded range', () => {
      expect(satisfies('1.7.0', '>=1.7.1 <1.8.0')).toBe(false);
      expect(satisfies('1.8.0', '>=1.7.1 <1.8.0')).toBe(false);
      expect(satisfies('1.6.26', '>=1.7.1 <1.8.0')).toBe(false);
    });

    it('handles caret ranges', () => {
      expect(satisfies('4.5.2', '^4.0.0')).toBe(true);
      expect(satisfies('5.0.0', '^4.0.0')).toBe(false);
    });

    it('throws on a range shape it does not understand', () => {
      expect(() => satisfies('1.0.0', '1.x')).toThrow(/Unsupported range clause/);
    });
  });

  it('declares at least one peer dependency (non-vacuity)', () => {
    expect(Object.keys(pkg.peerDependencies ?? {}).length).toBeGreaterThan(0);
  });

  it('every peer range is satisfied by the devDependency the suite runs against', () => {
    const checked: string[] = [];

    for (const [name, range] of Object.entries(pkg.peerDependencies as Record<string, string>)) {
      const installed = pkg.devDependencies?.[name];

      // A peer with no devDependency is never exercised here; `check-consumer-build.mjs`
      // is what covers those. Nothing to compare.
      if (!installed) {
        continue;
      }

      checked.push(name);
      expect(
        satisfies(installed, range),
        `devDependency ${name}@${installed} is OUTSIDE the published peer range "${range}". ` +
          'Either the range is wrong, or this package is tested against a version it does not declare.',
      ).toBe(true);
    }

    // Guards against the assertion loop silently covering nothing — e.g. if the
    // devDependencies were renamed or the peer block restructured.
    expect(checked).toContain('better-auth');
    expect(checked).toContain('@better-auth/passkey');
  });

  it('keeps better-auth and @better-auth/passkey on the same range', () => {
    // They are two halves of one protocol client. A split range lets a consumer
    // install a combination neither package was built against.
    expect(pkg.peerDependencies['@better-auth/passkey']).toBe(pkg.peerDependencies['better-auth']);
  });

  it('does not bless a better-auth version that @better-auth/passkey rejects', async () => {
    // @better-auth/passkey peer-requires a better-auth version of its own. Our range
    // must not admit a `better-auth` that the passkey package would refuse, or we
    // publish a combination that cannot install cleanly.
    //
    // Concretely caught here: `>=1.7.0` admitted better-auth 1.7.0, while
    // @better-auth/passkey@1.7.1 requires `^1.7.1`.
    const passkeyPkg = JSON.parse(readFileSync(resolve(ROOT, 'node_modules/@better-auth/passkey/package.json'), 'utf8'));
    const required: string = passkeyPkg.peerDependencies?.['better-auth'];
    expect(required, 'expected @better-auth/passkey to declare a better-auth peer').toBeTruthy();

    const ourRange: string = pkg.peerDependencies['better-auth'];
    const ourFloor = /(?:^|\s)>=\s*(\d+\.\d+\.\d+)/.exec(ourRange)?.[1];
    expect(ourFloor, `expected a ">=" floor in "${ourRange}"`).toBeTruthy();

    expect(
      satisfies(ourFloor as string, required),
      `our peer floor better-auth@${ourFloor} is rejected by @better-auth/passkey@${passkeyPkg.version}, ` +
        `which requires "${required}". Raise the floor so every version we bless can actually install.`,
    ).toBe(true);
  });
});
