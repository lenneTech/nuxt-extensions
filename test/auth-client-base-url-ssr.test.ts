// @vitest-environment node
/**
 * Regression: during SSR the Better-Auth client must call the backend through the
 * server-only `runtimeConfig.apiUrl` (`NUXT_API_URL`) when one is set.
 *
 * `useLtAuthClient()` read `runtimeConfig.public.apiUrl` only — the one place in the
 * module without the SSR precedence `resolveLtApiBaseUrl()` has (see
 * `api-url-warnings.test.ts`). The client IS built on the server (`useLtAuth()`
 * creates it in setup), and a consumer's `getSession()` from a middleware or
 * `useAsyncData` went to the public name. On Windows `*.localhost` resolves only in
 * Chromium, so Node got ENOTFOUND where `lt dev` sets the internal URL to
 * `http://127.0.0.1:<port>`.
 *
 * Asserts on the URL of the request that actually leaves (recording `fetch` stub),
 * not on the config handed to the factory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetLtAuthClientSingleton } from '../src/runtime/lib/auth-client';
import { resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';

const INTERNAL = 'http://127.0.0.1:3000';
const PUBLIC = 'https://api.projekt.localhost';

let requests: string[] = [];

async function getSessionUrls(): Promise<string[]> {
  resetLtAuthClientSingleton();
  const { useLtAuthClient } = await import('../src/runtime/composables/use-lt-auth-client');
  await useLtAuthClient().getSession();
  return requests;
}

beforeEach(() => {
  requests = [];
  resetStubRuntimeConfig();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      requests.push(String((input as { url?: string })?.url ?? input));
      return new Response('null', { headers: { 'content-type': 'application/json' }, status: 200 });
    }),
  );
});

afterEach(() => {
  resetTestRenderScope();
  resetStubRuntimeConfig();
  resetLtAuthClientSingleton();
  vi.unstubAllGlobals();
});

describe('useLtAuthClient() baseURL during SSR', () => {
  beforeEach(() => setTestRenderScope('server'));

  it('prefers the server-only apiUrl over the public one', async () => {
    setStubRuntimeConfig({ apiUrl: `${INTERNAL}/`, public: { apiUrl: PUBLIC } });

    expect(await getSessionUrls()).toEqual([`${INTERNAL}/iam/get-session`]);
  });

  it('falls back to the public apiUrl when no server apiUrl is set', async () => {
    setStubRuntimeConfig({ public: { apiUrl: PUBLIC } });

    expect(await getSessionUrls()).toEqual([`${PUBLIC}/iam/get-session`]);
  });

  it('falls back to auth.baseURL when neither apiUrl is set', async () => {
    setStubRuntimeConfig({ public: { ltExtensions: { auth: { baseURL: 'https://legacy.example.com/' } } } });

    expect(await getSessionUrls()).toEqual(['https://legacy.example.com/iam/get-session']);
  });
});

describe('useLtAuthClient() baseURL in the browser', () => {
  it('never uses the server-only apiUrl, even if one is visible', async () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { cookie: '' });
    setStubRuntimeConfig({ apiProxy: false, apiUrl: INTERNAL, public: { apiProxy: false, apiUrl: PUBLIC } });

    expect(await getSessionUrls()).toEqual([`${PUBLIC}/iam/get-session`]);
  });
});
