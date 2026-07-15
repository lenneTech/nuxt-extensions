import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { clearAllCookies } from './stubs/cookies';
import { resetStubRuntimeConfig, setStubRuntimeConfig, setStubRuntimeConfigThrows } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';

let warnSpy: MockInstance<(...args: unknown[]) => void>;

async function loadAuthState() {
  return import('../src/runtime/lib/auth-state');
}

beforeEach(async () => {
  resetStubRuntimeConfig();
  resetTestRenderScope();
  clearAllCookies();
  // Module-scope warn-once state outlives individual tests (no vi.resetModules()),
  // so without this every assertion below would depend on test order.
  const { resetLtWarnOnceState } = await loadAuthState();
  resetLtWarnOnceState();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  resetTestRenderScope();
  resetStubRuntimeConfig();
  clearAllCookies();
});

describe('buildLtApiUrl — missing API URL warning', () => {
  it('warns exactly once on the client no matter how many URLs are built', async () => {
    const { buildLtApiUrl } = await loadAuthState();

    expect(buildLtApiUrl('/iam')).toBe('/iam');
    expect(buildLtApiUrl('/system-setup/status')).toBe('/system-setup/status');
    expect(buildLtApiUrl('/i18n/errors/de')).toBe('/i18n/errors/de');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('Set NUXT_PUBLIC_API_URL');
  });

  it('names the app origin and the 404 consequence in the client warning', async () => {
    const { buildLtApiUrl } = await loadAuthState();
    buildLtApiUrl('/iam');

    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain('app origin');
    expect(message).toContain('404');
    // The server-only env var must never be suggested to a browser.
    expect(message).not.toContain('NUXT_API_URL');
  });

  it('warns with the SSR-specific message and env vars on the server', async () => {
    setTestRenderScope('server');
    const { buildLtApiUrl } = await loadAuthState();

    expect(buildLtApiUrl('/iam')).toBe('/iam');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain('Set NUXT_API_URL or NUXT_PUBLIC_API_URL');
    // SSR has no app origin: $fetch 404s against Nitro, global fetch rejects the URL.
    expect(message).not.toContain('app origin');
    expect(message).toContain('Nitro');
  });

  it('tracks the client and server warnings under separate keys', async () => {
    const { buildLtApiUrl } = await loadAuthState();

    buildLtApiUrl('/iam');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    setTestRenderScope('server');
    buildLtApiUrl('/iam');
    expect(warnSpy).toHaveBeenCalledTimes(2);

    // …but neither scope repeats itself.
    buildLtApiUrl('/iam');
    setTestRenderScope('client');
    buildLtApiUrl('/iam');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('warns again after resetLtWarnOnceState()', async () => {
    const { buildLtApiUrl, resetLtWarnOnceState } = await loadAuthState();

    buildLtApiUrl('/iam');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    resetLtWarnOnceState();
    buildLtApiUrl('/iam');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('stays silent when a public API URL is configured', async () => {
    setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com' } });
    const { buildLtApiUrl } = await loadAuthState();

    expect(buildLtApiUrl('/iam')).toBe('https://api.example.com/iam');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('strips trailing slashes from the configured base URL', async () => {
    setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com///' } });
    const { buildLtApiUrl } = await loadAuthState();

    expect(buildLtApiUrl('/iam')).toBe('https://api.example.com/iam');
  });

  it('prefers the server-only apiUrl over the public one during SSR', async () => {
    setTestRenderScope('server');
    setStubRuntimeConfig({ apiUrl: 'http://api.svc.cluster.local', public: { apiUrl: 'https://api.example.com' } });
    const { buildLtApiUrl } = await loadAuthState();

    expect(buildLtApiUrl('/iam')).toBe('http://api.svc.cluster.local/iam');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to auth.baseURL before warning', async () => {
    setStubRuntimeConfig({ public: { ltExtensions: { auth: { baseURL: 'https://legacy.example.com/' } } } });
    const { buildLtApiUrl } = await loadAuthState();

    expect(buildLtApiUrl('/iam')).toBe('https://legacy.example.com/iam');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn about a missing URL in proxy mode', async () => {
    setStubRuntimeConfig({ public: { apiProxy: true } });
    const { buildLtApiUrl } = await loadAuthState();

    expect(buildLtApiUrl('/iam')).toBe('/api/iam');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('resolveLtApiBaseUrl', () => {
  it('reports the missing URL without logging', async () => {
    const { resolveLtApiBaseUrl } = await loadAuthState();

    expect(resolveLtApiBaseUrl()).toEqual({ baseUrl: '', missing: true, proxy: false, scope: 'client' });
    expect(resolveLtApiBaseUrl()).toEqual({ baseUrl: '', missing: true, proxy: false, scope: 'client' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reports proxy mode', async () => {
    setStubRuntimeConfig({ public: { apiProxy: 'true' } });
    const { resolveLtApiBaseUrl } = await loadAuthState();

    expect(resolveLtApiBaseUrl()).toEqual({ baseUrl: '/api', missing: false, proxy: true, scope: 'client' });
  });

  it('reports the server scope when rendering on the server', async () => {
    setTestRenderScope('server');
    setStubRuntimeConfig({ apiUrl: 'http://internal:3000/', public: {} });
    const { resolveLtApiBaseUrl } = await loadAuthState();

    expect(resolveLtApiBaseUrl()).toEqual({ baseUrl: 'http://internal:3000', missing: false, proxy: false, scope: 'server' });
  });

  it('falls back to the public URL on the server when no server apiUrl is set', async () => {
    setTestRenderScope('server');
    setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com' } });
    const { resolveLtApiBaseUrl } = await loadAuthState();

    expect(resolveLtApiBaseUrl()).toEqual({ baseUrl: 'https://api.example.com', missing: false, proxy: false, scope: 'server' });
  });

  it('falls back to auth.baseURL on the server when neither apiUrl is set', async () => {
    setTestRenderScope('server');
    setStubRuntimeConfig({ public: { ltExtensions: { auth: { baseURL: 'https://legacy.example.com/' } } } });
    const { resolveLtApiBaseUrl } = await loadAuthState();

    expect(resolveLtApiBaseUrl()).toEqual({ baseUrl: 'https://legacy.example.com', missing: false, proxy: false, scope: 'server' });
  });
});

describe('isLocalDevApiProxy — implicit dev fallback warning', () => {
  it('warns exactly once when the proxy is activated implicitly', async () => {
    setStubRuntimeConfig({ app: { buildId: 'dev' }, public: {} });
    const { isLocalDevApiProxy } = await loadAuthState();

    expect(isLocalDevApiProxy()).toBe(true);
    expect(isLocalDevApiProxy()).toBe(true);
    expect(isLocalDevApiProxy()).toBe(true);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('NUXT_PUBLIC_API_PROXY=true');
  });

  it('shares the one-shot reset with the API URL warnings', async () => {
    setStubRuntimeConfig({ app: { buildId: 'dev' }, public: {} });
    const { isLocalDevApiProxy, resetLtWarnOnceState } = await loadAuthState();

    isLocalDevApiProxy();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    resetLtWarnOnceState();
    isLocalDevApiProxy();
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('never proxies during SSR', async () => {
    setTestRenderScope('server');
    setStubRuntimeConfig({ app: { buildId: 'dev' }, public: { apiProxy: true } });
    const { isLocalDevApiProxy } = await loadAuthState();

    expect(isLocalDevApiProxy()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('honours the explicit opt-out even under nuxt dev (boolean false)', async () => {
    setStubRuntimeConfig({ app: { buildId: 'dev' }, public: { apiProxy: false } });
    const { isLocalDevApiProxy } = await loadAuthState();

    expect(isLocalDevApiProxy()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('honours the explicit opt-out even under nuxt dev (string "false")', async () => {
    setStubRuntimeConfig({ app: { buildId: 'dev' }, public: { apiProxy: 'false' } });
    const { isLocalDevApiProxy } = await loadAuthState();

    expect(isLocalDevApiProxy()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('swallow-on-error contracts', () => {
  it('buildLtApiUrl returns the raw path and stays silent when runtimeConfig is unavailable', async () => {
    const { buildLtApiUrl } = await loadAuthState();
    setStubRuntimeConfigThrows();

    expect(buildLtApiUrl('/iam')).toBe('/iam');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('getLtAuthCookieNames falls back to the defaults when runtimeConfig is unavailable', async () => {
    const { getLtAuthCookieNames } = await loadAuthState();
    setStubRuntimeConfigThrows();

    expect(getLtAuthCookieNames()).toEqual({ state: 'lt-auth-state', token: 'lt-jwt-token' });
  });
});

describe('lt-config-check plugin', () => {
  async function loadConfigCheckPlugin() {
    const mod = await import('../src/runtime/plugins/lt-config-check');
    // The `#imports` stub's `defineNuxtPlugin` is a pass-through, so the default
    // export IS the setup function — invoke it directly to exercise the wiring.
    return mod.default as unknown as () => void;
  }

  it('warns once with the client scope when the API URL is missing', async () => {
    const runConfigCheck = await loadConfigCheckPlugin();

    runConfigCheck();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('Set NUXT_PUBLIC_API_URL');
  });

  it('warns with the server scope during SSR', async () => {
    setTestRenderScope('server');
    const runConfigCheck = await loadConfigCheckPlugin();

    runConfigCheck();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('Set NUXT_API_URL or NUXT_PUBLIC_API_URL');
  });

  it('shares the one-shot key with buildLtApiUrl (no double-report)', async () => {
    const runConfigCheck = await loadConfigCheckPlugin();
    const { buildLtApiUrl } = await loadAuthState();

    runConfigCheck();
    buildLtApiUrl('/iam');
    buildLtApiUrl('/system-setup/status');

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the API URL is configured', async () => {
    setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com' } });
    const runConfigCheck = await loadConfigCheckPlugin();

    runConfigCheck();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays silent in proxy mode', async () => {
    setStubRuntimeConfig({ public: { apiProxy: true } });
    const runConfigCheck = await loadConfigCheckPlugin();

    runConfigCheck();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('swallows a resolution error without throwing or warning', async () => {
    const runConfigCheck = await loadConfigCheckPlugin();
    setStubRuntimeConfigThrows();

    expect(() => runConfigCheck()).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('SSR-scope early returns (now reachable via the render-scope shim)', () => {
  it('getLtAuthMode returns cookie mode on the server without reading document.cookie', async () => {
    setTestRenderScope('server');
    document.cookie = 'lt-auth-state=' + encodeURIComponent(JSON.stringify({ authMode: 'jwt', user: { id: '1' } })) + '; path=/';
    const { getLtAuthMode } = await loadAuthState();

    expect(getLtAuthMode()).toBe('cookie');
  });

  it('isLtAuthenticated is false on the server even with a user-bearing cookie', async () => {
    setTestRenderScope('server');
    document.cookie = 'lt-auth-state=' + encodeURIComponent(JSON.stringify({ user: { id: '1' } })) + '; path=/';
    const { isLtAuthenticated } = await loadAuthState();

    expect(isLtAuthenticated()).toBe(false);
  });

  it('getLtJwtToken returns null on the server', async () => {
    setTestRenderScope('server');
    document.cookie = 'lt-jwt-token=' + encodeURIComponent(JSON.stringify('server-token')) + '; path=/';
    const { getLtJwtToken } = await loadAuthState();

    expect(getLtJwtToken()).toBeNull();
  });

  it('setLtJwtToken is a no-op on the server', async () => {
    setTestRenderScope('server');
    const { setLtJwtToken, getLtJwtToken } = await loadAuthState();

    setLtJwtToken('should-not-persist');

    // Switch to the client scope to read: the server write must have done nothing.
    resetTestRenderScope();
    expect(getLtJwtToken()).toBeNull();
  });
});
