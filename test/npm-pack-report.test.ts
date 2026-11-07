// @vitest-environment node
/**
 * `check:manifest` reads the `npm pack --dry-run --json` report with `packedFilePaths()`.
 *
 * npm 12 changed that report from an array to an object keyed by package name, and the old
 * `JSON.parse(raw)[0]` stopped `check:manifest` with a TypeError under npm 12 (publish.yml installs
 * npm 12 for Trusted Publishing, DEV-3143). Both fixtures have the shape npm 11.21 and npm 12.2
 * printed for this package, reduced to the fields that are read.
 */

import { describe, expect, it } from 'vitest';

import { packedFilePaths } from '../scripts/lib/npm-pack-report.mjs';

const NAME = '@lenne.tech/nuxt-extensions';
const FILES = [{ path: 'CLAUDE.md' }, { path: 'dist/module.mjs' }, { path: 'package.json' }];
const PATHS = ['CLAUDE.md', 'dist/module.mjs', 'package.json'];

describe('packedFilePaths', () => {
  it('reads the npm 11 report, an array of packages', () => {
    expect(packedFilePaths(JSON.stringify([{ files: FILES, name: NAME }]), NAME)).toEqual(PATHS);
  });

  it('reads the npm 12 report, an object keyed by package name', () => {
    expect(packedFilePaths(JSON.stringify({ [NAME]: { files: FILES, name: NAME } }), NAME)).toEqual(PATHS);
  });

  it('reads the entry of the named package, not the first one', () => {
    const report = [{ files: [{ path: 'other.js' }], name: 'other' }, { files: FILES, name: NAME }];

    expect(packedFilePaths(JSON.stringify(report), NAME)).toEqual(PATHS);
  });

  it('names the package when the report has no file list for it, instead of a TypeError', () => {
    expect(() => packedFilePaths(JSON.stringify({ other: { files: FILES, name: 'other' } }), NAME)).toThrow(`no file list for ${NAME}`);
    expect(() => packedFilePaths('null', NAME)).toThrow(`no file list for ${NAME}`);
  });
});
