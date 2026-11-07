import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetStubRuntimeConfig, setStubRuntimeConfig, setStubRuntimeConfigThrows } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';
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
  resetTestRenderScope();
  vi.unstubAllGlobals();
});

describe('useLtFile file base path', () => {
  it('derives /files from the default /files/upload endpoint', () => {
    configureEndpoint('/files/upload');

    expect(useLtFile().getFileUrl('abc')).toBe('/files/id/abc');
  });

  it('keeps a custom prefix in front of an /upload endpoint', () => {
    configureEndpoint('/api/files/upload');

    expect(useLtFile().getFileUrl('abc')).toBe('/api/files/id/abc');
    expect(useLtFile().getDownloadUrl('abc', 'a b.pdf')).toBe('/api/files/id/abc');
  });

  it('does not derive the file routes from a TUS endpoint without /upload', () => {
    configureEndpoint('/tus');

    expect(useLtFile().getFileUrl('abc')).toBe('/files/id/abc');
  });

  it("keeps the file routes at /files with the module default /tus", () => {
    configureEndpoint('/tus');

    expect(useLtFile().getFileUrl('abc')).toBe('/files/abc');
  });

  it('falls back to /files when no endpoint is configured', () => {
    configureEndpoint(undefined);

    expect(useLtFile().getFileUrl('abc')).toBe('/files/id/abc');
  });
});

/**
 * The file routes are API routes (DEV-4073). TUS uploads go to the API since 1.19.0; file links and
 * the info request went to the app origin, which only works behind a same-origin proxy. They now
 * follow the rule of the auth, AI and TUS requests: `NUXT_PUBLIC_API_URL` + path, or the `/api`
 * dev-proxy prefix. `tus.resolveAgainstApi: false` keeps the project's own same-origin proxy.
 *
 * Links (`getFileUrl`, `getDownloadUrl`) are rendered on the server and then followed by the
 * browser, so they use the public URL there too: never the server-only `NUXT_API_URL`, and the
 * same string on both sides, or the `<img :src>` would differ between SSR and hydration.
 */
describe('useLtFile against the API', () => {
  const API = 'https://api.example.com';

  function configure(options: { apiProxy?: boolean; resolveAgainstApi?: boolean; serverApiUrl?: string } = {}): void {
    setStubRuntimeConfig({
      apiUrl: options.serverApiUrl,
      public: {
        apiProxy: options.apiProxy,
        apiUrl: API,
        ltExtensions: { tus: { defaultEndpoint: '/files/upload', resolveAgainstApi: options.resolveAgainstApi } },
      },
    });
  }

  it('builds the links on the API origin', () => {
    configure();

    expect(useLtFile().getFileUrl('abc')).toBe(`${API}/files/id/abc`);
    expect(useLtFile().getDownloadUrl('abc', 'a b.pdf')).toBe(`${API}/files/id/abc`);
  });

  it('uses the /api prefix while the dev proxy is on', () => {
    configure({ apiProxy: true });

    expect(useLtFile().getFileUrl('abc')).toBe('/api/files/id/abc');
    expect(useLtFile().getDownloadUrl('abc')).toBe('/api/files/id/abc');
  });

  it('renders the same public links during SSR: no NUXT_API_URL, no hydration mismatch', () => {
    configure({ serverApiUrl: 'http://api.internal:3000' });
    setTestRenderScope('server');

    expect(useLtFile().getFileUrl('abc')).toBe(`${API}/files/id/abc`);
    expect(useLtFile().getDownloadUrl('abc')).toBe(`${API}/files/id/abc`);
  });

  it('keeps the dev-proxy prefix during SSR, as the browser will request it', () => {
    configure({ apiProxy: true, serverApiUrl: 'http://api.internal:3000' });
    setTestRenderScope('server');

    expect(useLtFile().getFileUrl('abc')).toBe('/api/files/id/abc');
  });

  it("links to nest-server's GET /files/id/:id, the only route that streams a file by its id", () => {
    configure();

    // `/files/<id>` would be read as a file name (GET /files/:filename) and answer 404; nest-server
    // names the download after the stored file and has no rename parameter
    expect(useLtFile().getFileUrl('0123456789abcdef01234567')).toBe(`${API}/files/id/0123456789abcdef01234567`);
    expect(useLtFile().getDownloadUrl('0123456789abcdef01234567', 'a b.pdf')).toBe(`${API}/files/id/0123456789abcdef01234567`);
    expect(useLtFile().getFileUrl('a/b?c')).toBe(`${API}/files/id/a%2Fb%3Fc`);
  });

  it('leaves the links relative with tus.resolveAgainstApi: false (own same-origin proxy)', () => {
    configure({ resolveAgainstApi: false });

    expect(useLtFile().getFileUrl('abc')).toBe('/files/id/abc');
    expect(useLtFile().getDownloadUrl('abc')).toBe('/files/id/abc');
  });

  it('never rewrites an absolute file base', () => {
    setStubRuntimeConfig({ public: { apiUrl: API, ltExtensions: { tus: { defaultEndpoint: 'https://files.example.com/files/upload' } } } });

    expect(useLtFile().getFileUrl('abc')).toBe('https://files.example.com/files/id/abc');
  });

  it('keeps the API links after an await during SSR, where the Nuxt context (and useRuntimeConfig) is gone', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: unknown) => ({}));
    vi.stubGlobal('$fetch', fetchMock);
    configure({ serverApiUrl: 'http://api.internal:3000' });
    setTestRenderScope('server');
    // Created in setup, used in a useAsyncData handler after its first await
    const file = useLtFile();
    setStubRuntimeConfigThrows();

    expect(file.getFileUrl('abc')).toBe(`${API}/files/id/abc`);
    await file.getFileInfo('0123456789abcdef01234567');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.internal:3000/files/info/0123456789abcdef01234567');
  });

  it('fetches the file info from the API, during SSR from the server-side API URL', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: unknown) => ({ id: '0123456789abcdef01234567' }));
    vi.stubGlobal('$fetch', fetchMock);
    const id = '0123456789abcdef01234567';

    configure();
    await useLtFile().getFileInfo(id);
    configure({ serverApiUrl: 'http://api.internal:3000' });
    setTestRenderScope('server');
    await useLtFile().getFileInfo(id);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${API}/files/info/${id}`, `http://api.internal:3000/files/info/${id}`]);
  });
});
