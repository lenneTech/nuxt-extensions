import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';

function setCookieNamesConfig(state?: string, token?: string): void {
  setStubRuntimeConfig({
    public: {
      ltExtensions: {
        auth: {
          cookieNames: {
            ...(state !== undefined ? { state } : {}),
            ...(token !== undefined ? { token } : {}),
          },
        },
      },
    },
  });
}

function clearAllCookies(): void {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  }
}

beforeEach(() => {
  resetStubRuntimeConfig();
  clearAllCookies();
});

afterEach(() => {
  clearAllCookies();
  resetStubRuntimeConfig();
});

describe('auth cookie name configuration', () => {
  describe('getLtAuthCookieNames', () => {
    it('returns defaults when no config is provided', async () => {
      const { getLtAuthCookieNames, LT_AUTH_STATE_COOKIE_DEFAULT, LT_JWT_TOKEN_COOKIE_DEFAULT } = await import(
        '../src/runtime/lib/auth-state'
      );
      expect(LT_AUTH_STATE_COOKIE_DEFAULT).toBe('lt-auth-state');
      expect(LT_JWT_TOKEN_COOKIE_DEFAULT).toBe('lt-jwt-token');
      expect(getLtAuthCookieNames()).toEqual({ state: 'lt-auth-state', token: 'lt-jwt-token' });
    });

    it('honours both keys when both are configured', async () => {
      const { getLtAuthCookieNames } = await import('../src/runtime/lib/auth-state');
      setCookieNamesConfig('foo-state', 'foo-token');
      expect(getLtAuthCookieNames()).toEqual({ state: 'foo-state', token: 'foo-token' });
    });

    it('keeps the token default when only state is configured', async () => {
      const { getLtAuthCookieNames } = await import('../src/runtime/lib/auth-state');
      setCookieNamesConfig('only-state', undefined);
      expect(getLtAuthCookieNames()).toEqual({ state: 'only-state', token: 'lt-jwt-token' });
    });

    it('keeps the state default when only token is configured', async () => {
      const { getLtAuthCookieNames } = await import('../src/runtime/lib/auth-state');
      setCookieNamesConfig(undefined, 'only-token');
      expect(getLtAuthCookieNames()).toEqual({ state: 'lt-auth-state', token: 'only-token' });
    });

    it('falls back to defaults when runtime config is unavailable', async () => {
      const { getLtAuthCookieNames } = await import('../src/runtime/lib/auth-state');
      // Force the public getter to throw to mimic the non-Nuxt context branch.
      setStubRuntimeConfig({
        get public(): Record<string, any> {
          throw new Error('not in nuxt context');
        },
      } as any);
      expect(getLtAuthCookieNames()).toEqual({ state: 'lt-auth-state', token: 'lt-jwt-token' });
    });
  });

  describe('auth-state helpers honour configured names', () => {
    it('isLtAuthenticated reads the default cookie when no config is set', async () => {
      const { isLtAuthenticated } = await import('../src/runtime/lib/auth-state');
      document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ user: { id: '1' } }))}; path=/`;
      expect(isLtAuthenticated()).toBe(true);
    });

    it('isLtAuthenticated reads the configured state cookie name', async () => {
      const { isLtAuthenticated } = await import('../src/runtime/lib/auth-state');
      setCookieNamesConfig('custom-auth', 'custom-jwt');
      // Default cookie set — should NOT be considered, custom one missing.
      document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ user: { id: 'x' } }))}; path=/`;
      expect(isLtAuthenticated()).toBe(false);
      // Now set the configured cookie.
      document.cookie = `custom-auth=${encodeURIComponent(JSON.stringify({ user: { id: '1' } }))}; path=/`;
      expect(isLtAuthenticated()).toBe(true);
    });

    it('getLtJwtToken / setLtJwtToken use the default token cookie name without config', async () => {
      const { getLtJwtToken, setLtJwtToken } = await import('../src/runtime/lib/auth-state');
      setLtJwtToken('abc123');
      expect(document.cookie).toContain('lt-jwt-token=');
      expect(getLtJwtToken()).toBe('abc123');
    });

    it('getLtJwtToken / setLtJwtToken use the configured token cookie name', async () => {
      const { getLtJwtToken, setLtJwtToken } = await import('../src/runtime/lib/auth-state');
      setCookieNamesConfig(undefined, 'my-jwt');
      setLtJwtToken('zzz');
      expect(document.cookie).toContain('my-jwt=');
      // The default cookie must not be re-introduced with a value.
      expect(document.cookie).not.toMatch(/(?:^|; )lt-jwt-token=[^;]+/);
      expect(getLtJwtToken()).toBe('zzz');
    });

    it('setLtAuthMode writes to the configured state cookie', async () => {
      const { setLtAuthMode, getLtAuthMode } = await import('../src/runtime/lib/auth-state');
      setCookieNamesConfig('app-state', 'app-jwt');
      setLtAuthMode('jwt');
      expect(document.cookie).toContain('app-state=');
      expect(getLtAuthMode()).toBe('jwt');
    });

    it('only configuring state keeps jwt cookie at default', async () => {
      const { setLtJwtToken } = await import('../src/runtime/lib/auth-state');
      setCookieNamesConfig('only-state', undefined);
      setLtJwtToken('partial');
      expect(document.cookie).toContain('lt-jwt-token=');
    });

    it('only configuring token keeps state cookie at default', async () => {
      const { isLtAuthenticated } = await import('../src/runtime/lib/auth-state');
      setCookieNamesConfig(undefined, 'only-token');
      document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ user: { id: '7' } }))}; path=/`;
      expect(isLtAuthenticated()).toBe(true);
    });
  });
});
