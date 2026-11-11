// @vitest-environment node
/**
 * No server-only API address in server-rendered HTML.
 *
 * During SSR `buildLtApiUrl()` returns `NUXT_API_URL`: the server's own route to the API, in a
 * cluster an internal address such as `http://api:3000`. A project built image `src` attributes with
 * it, and every visitor got an `<img>` pointing at an address their browser cannot reach. It broke
 * in production only, where the internal and the public address differ (vendored core 1.5.3,
 * 2026-11-11). File links of `useLtFile()` use `buildLtPublicApiUrl()` since 4.0.0, and that
 * function is auto-imported now, so the right builder is as close at hand as the wrong one.
 *
 * Rendered here in the server scope with an internal NUXT_API_URL and a public
 * NUXT_PUBLIC_API_URL. Nothing this module puts into HTML or into the SSR payload may contain the
 * internal address. The first test proves the setup: `buildLtApiUrl()` really returns it.
 * `scripts/check-consumer-build.mjs` renders the same through a real Nuxt server
 * (`pnpm run release`).
 */

import { renderToString } from '@vue/server-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h } from 'vue';

import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig, useState } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';
import { useLtAiStatus } from '../src/runtime/composables/use-lt-ai-status';
import { useLtFile } from '../src/runtime/composables/use-lt-file';
import { buildLtApiUrl, buildLtPublicApiUrl } from '../src/runtime/lib/auth-state';

const INTERNAL_HOST = 'api:3000';
const INTERNAL = `http://${INTERNAL_HOST}`;
const PUBLIC = 'https://api.example.com';

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  setTestRenderScope('server');
  setStubRuntimeConfig({
    apiUrl: INTERNAL,
    public: { apiProxy: false, apiUrl: PUBLIC, ltExtensions: { ai: { basePath: '/ai' }, tus: { defaultEndpoint: '/tus' } } },
  });
});

afterEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetTestRenderScope();
  vi.unstubAllGlobals();
});

describe('server-rendered HTML never contains the server-only API address', () => {
  it('uses a setup in which buildLtApiUrl() returns the internal address during SSR', () => {
    expect(buildLtApiUrl('/files/id/abc')).toBe(`${INTERNAL}/files/id/abc`);
    expect(buildLtPublicApiUrl('/files/id/abc')).toBe(`${PUBLIC}/files/id/abc`);
  });

  it('renders file links, images and srcset of the module with the public address', async () => {
    const html = await renderToString(
      createSSRApp({
        setup() {
          const file = useLtFile();
          return () =>
            h('div', [
              h('img', { alt: '', src: file.getFileUrl('abc') }),
              h('a', { href: file.getDownloadUrl('abc', 'report.pdf') }, 'download'),
              h('img', {
                alt: '',
                src: buildLtPublicApiUrl('/users/1/avatar'),
                srcset: `${buildLtPublicApiUrl('/users/1/avatar?size=2')} 2x`,
              }),
            ]);
        },
      }),
    );

    expect(html).not.toContain(INTERNAL_HOST);
    expect(html).toContain(`src="${PUBLIC}/files/id/abc"`);
    expect(html).toContain(`href="${PUBLIC}/files/id/abc"`);
    expect(html).toContain(`srcset="${PUBLIC}/users/1/avatar?size=2 2x"`);
  });

  it('keeps the internal address out of the SSR payload when a server request to it fails', async () => {
    // Node's fetch names the request URL in some of its errors; the AI status state is serialized
    // into every visitor's HTML.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(`Failed to parse URL from ${INTERNAL}/ai/status`)));

    await useLtAiStatus().load();

    const payload = JSON.stringify(useState('lt-ai-status').value);
    expect(payload).toContain('"loaded":true');
    expect(payload).not.toContain(INTERNAL_HOST);
  });
});
