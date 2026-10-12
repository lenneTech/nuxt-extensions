import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { useLtFile } from '../src/runtime/composables/use-lt-file';

/**
 * `useLtFile()` URL helpers — where the file base path comes from.
 *
 * The base path was derived from the TUS endpoint by cutting `/upload` out of it, so
 * `'/files/upload'` gave `'/files'`. nest-server serves TUS at `/tus`, and an endpoint set to that
 * gave a file base of `'/tus'` — every file link pointed into the upload route. The base is now
 * only derived from an endpoint that actually ends in `/upload` (unchanged for every existing
 * configuration); any other endpoint leaves the file routes at `/files`.
 */

function configureEndpoint(defaultEndpoint?: string): void {
  setStubRuntimeConfig({ public: { ltExtensions: { tus: { defaultEndpoint } } } });
}

beforeEach(() => {
  resetStubRuntimeConfig();
});

afterEach(() => {
  resetStubRuntimeConfig();
});

describe('useLtFile file base path', () => {
  it('derives /files from the default /files/upload endpoint', () => {
    configureEndpoint('/files/upload');

    expect(useLtFile().getFileUrl('abc')).toBe('/files/abc');
  });

  it('keeps a custom prefix in front of an /upload endpoint', () => {
    configureEndpoint('/api/files/upload');

    expect(useLtFile().getFileUrl('abc')).toBe('/api/files/abc');
    expect(useLtFile().getDownloadUrl('abc', 'a b.pdf')).toBe('/api/files/download/abc?filename=a%20b.pdf');
  });

  it('does not derive the file routes from a TUS endpoint without /upload', () => {
    configureEndpoint('/tus');

    expect(useLtFile().getFileUrl('abc')).toBe('/files/abc');
  });

  it('falls back to /files when no endpoint is configured', () => {
    configureEndpoint(undefined);

    expect(useLtFile().getFileUrl('abc')).toBe('/files/abc');
  });
});
