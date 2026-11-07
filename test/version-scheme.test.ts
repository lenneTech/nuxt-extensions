import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The version scheme (since 4.0.0, `.claude/rules/versioning.md`): MAJOR is the Nuxt major, a MINOR
 * is a change a project has to act on and ships a migration guide, a PATCH is drop-in.
 *
 * Rule 0 is the one ordinary semver reflexes break: a breaking change "deserves" a major. Here a
 * major the Nuxt peer does not carry fails, and so does a Nuxt peer that moved without the major.
 * Rule 1: a release that is not a PATCH names a migration guide in its CHANGELOG section, and the
 * file exists. Before 4.0.0 the major was offset (1.x was Nuxt 4), which is why these checks start
 * there.
 */

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  version: string;
};

/** `^4.0.0`, `>=4.0.0`, `4.6.4` → 4. A range with several majors (`^4.0.0 || ^5.0.0`) has none. */
function singleMajor(range: string): number | null {
  const majors = new Set([...range.matchAll(/(?:^|[\s^~>=<|])(\d+)\.\d+(?:\.\d+)?/g)].map((match) => Number(match[1])));
  return majors.size === 1 ? [...majors][0]! : null;
}

/** The CHANGELOG section of `version`: from its heading to the next `## [`. */
function changelogSection(changelog: string, version: string): string | null {
  const start = changelog.indexOf(`## [${version}]`);
  if (start === -1) {
    return null;
  }
  const next = changelog.indexOf('\n## [', start + 1);
  return changelog.slice(start, next === -1 ? undefined : next);
}

describe('version scheme', () => {
  const [major, minor, patch] = pkg.version.split('.').map(Number) as [number, number, number];

  it('reads a plain MAJOR.MINOR.PATCH version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('MAJOR is the Nuxt major of the nuxt peer and of @nuxt/kit (rule 0)', () => {
    expect(singleMajor(pkg.peerDependencies.nuxt ?? ''), 'peerDependencies.nuxt names one Nuxt major').toBe(major);
    expect(singleMajor(pkg.dependencies['@nuxt/kit'] ?? ''), "dependencies['@nuxt/kit'] names one Nuxt major").toBe(major);
  });

  it('a release that is not a PATCH names a migration guide that exists (rule 1)', () => {
    if (patch !== 0) {
      return;
    }
    const changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8');
    const section = changelogSection(changelog, pkg.version);
    expect(section, `CHANGELOG.md has a section for ${pkg.version}`).toBeTruthy();

    const guides = [...(section ?? '').matchAll(/migration-guides\/([\w.-]+\.md)/g)].map((match) => match[1]!);
    expect(guides, `the ${pkg.version} section names its migration guide (migration-guides/<from>-to-${major}.${minor}.0.md)`).not.toEqual([]);
    for (const guide of guides) {
      expect(existsSync(resolve(ROOT, 'migration-guides', guide)), `migration-guides/${guide} exists`).toBe(true);
    }
  });

  it('reads one major from the range forms this package uses', () => {
    expect(singleMajor('^4.0.0')).toBe(4);
    expect(singleMajor('>=4.0.0')).toBe(4);
    expect(singleMajor('4.6.4')).toBe(4);
    expect(singleMajor('^4.0.0 || ^5.0.0')).toBeNull();
  });
});
