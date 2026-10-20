/**
 * `checkSetupStatus()` during SSR when no API URL is configured.
 *
 * The global setup middleware calls it on every server render. Without
 * `NUXT_API_URL` / `NUXT_PUBLIC_API_URL`, `buildLtApiUrl` returns the bare path,
 * and a server-side `$fetch('/system-setup/status')` goes to Nitro itself: Nitro
 * renders that path as a page, the middleware runs again in the new request with
 * `needsSetup === null`, and fetches the same path again. The recursion has no
 * bottom — a production server without the env vars died of out-of-memory on its
 * first request (reproduced against a built nuxt-base-template, ~2.5 s at 256 MB).
 *
 * A relative path never reaches the backend from the server, not even behind a
 * same-origin reverse proxy, so skipping the fetch there loses nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetTestRenderScope();
  const { resetLtWarnOnceState } = await import('../src/runtime/lib/auth-state');
  resetLtWarnOnceState();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchSpy = vi.fn(async () => ({ needsSetup: true }));
  globalThis.$fetch = fetchSpy as unknown as typeof globalThis.$fetch;
});

afterEach(() => {
  resetTestRenderScope();
  resetStubRuntimeConfig();
  vi.restoreAllMocks();
});

describe('checkSetupStatus — SSR without an API URL', () => {
  it('does not fetch the relative path on the server, which would call Nitro itself', async () => {
    setTestRenderScope('server');
    const { useSystemSetup } = await import('../src/runtime/composables/auth/use-system-setup');
    const { checkSetupStatus, needsSetup } = useSystemSetup();

    await expect(checkSetupStatus()).resolves.toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
    // Left undecided, so the client checks again once it can resolve the URL.
    expect(needsSetup.value).toBeNull();
  });

  it('still fetches on the server when an API URL is configured', async () => {
    setTestRenderScope('server');
    setStubRuntimeConfig({ apiUrl: 'http://api.internal:3000', public: {} });
    const { useSystemSetup } = await import('../src/runtime/composables/auth/use-system-setup');
    const { checkSetupStatus, needsSetup } = useSystemSetup();

    await expect(checkSetupStatus()).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith('http://api.internal:3000/system-setup/status');
    expect(needsSetup.value).toBe(true);
  });

  it('still fetches on the client without an API URL, where the path resolves against the app origin', async () => {
    const { useSystemSetup } = await import('../src/runtime/composables/auth/use-system-setup');
    const { checkSetupStatus } = useSystemSetup();

    await expect(checkSetupStatus()).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith('/system-setup/status');
  });
});
