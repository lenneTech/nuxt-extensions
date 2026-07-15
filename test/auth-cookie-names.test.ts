import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearAllCookies } from './stubs/cookies';
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

  describe('resolveLtCookiePrefix (opt-in cookiePrefix only)', () => {
    it('returns "" (default) for empty / missing config', async () => {
      const { resolveLtCookiePrefix } = await import('../src/runtime/lib/auth-state');
      expect(resolveLtCookiePrefix(undefined)).toBe('');
      expect(resolveLtCookiePrefix(null)).toBe('');
      expect(resolveLtCookiePrefix({})).toBe('');
      expect(resolveLtCookiePrefix({ cookiePrefix: '' })).toBe('');
    });

    it('returns the configured cookiePrefix', async () => {
      const { resolveLtCookiePrefix } = await import('../src/runtime/lib/auth-state');
      expect(resolveLtCookiePrefix({ cookiePrefix: 'acme' })).toBe('acme');
    });

    it('IGNORES storagePrefix entirely (backward-compatible — no silent rename)', async () => {
      const { resolveLtCookiePrefix } = await import('../src/runtime/lib/auth-state');
      // The whole point: a localStorage namespacing prefix must NOT change cookies.
      expect(resolveLtCookiePrefix({ storagePrefix: 'myapp-prod' })).toBe('');
      expect(resolveLtCookiePrefix({ cookiePrefix: 'acme', storagePrefix: 'myapp-prod' })).toBe('acme');
    });

    it('trims surrounding whitespace', async () => {
      const { resolveLtCookiePrefix } = await import('../src/runtime/lib/auth-state');
      expect(resolveLtCookiePrefix({ cookiePrefix: '  acme  ' })).toBe('acme');
      expect(resolveLtCookiePrefix({ cookiePrefix: '   ' })).toBe('');
    });

    it('sanitises illegal cookie-name characters (space, ;, =, etc.)', async () => {
      const { resolveLtCookiePrefix } = await import('../src/runtime/lib/auth-state');
      expect(resolveLtCookiePrefix({ cookiePrefix: 'ac me' })).toBe('acme');
      expect(resolveLtCookiePrefix({ cookiePrefix: 'a;b=c' })).toBe('abc');
      expect(resolveLtCookiePrefix({ cookiePrefix: 'my.app_1-2' })).toBe('my.app_1-2');
      expect(resolveLtCookiePrefix({ cookiePrefix: '€€€' })).toBe('');
    });

    it('ignores non-string values defensively', async () => {
      const { resolveLtCookiePrefix } = await import('../src/runtime/lib/auth-state');
      expect(resolveLtCookiePrefix({ cookiePrefix: 123 as unknown as string })).toBe('');
      expect(resolveLtCookiePrefix({ cookiePrefix: {} as unknown as string })).toBe('');
    });
  });

  describe('getLtAuthCookieNames (cookiePrefix derivation)', () => {
    it('derives <cookiePrefix>-auth-state / -jwt-token', async () => {
      const { getLtAuthCookieNames } = await import('../src/runtime/lib/auth-state');
      setStubRuntimeConfig({ public: { cookiePrefix: 'acme' } });
      expect(getLtAuthCookieNames()).toEqual({ state: 'acme-auth-state', token: 'acme-jwt-token' });
    });

    it('keeps legacy defaults when only storagePrefix is set (no silent rename on upgrade)', async () => {
      const { getLtAuthCookieNames } = await import('../src/runtime/lib/auth-state');
      setStubRuntimeConfig({ public: { storagePrefix: 'myapp-prod' } });
      expect(getLtAuthCookieNames()).toEqual({ state: 'lt-auth-state', token: 'lt-jwt-token' });
    });

    it('explicit cookieNames win over cookiePrefix', async () => {
      const { getLtAuthCookieNames } = await import('../src/runtime/lib/auth-state');
      setStubRuntimeConfig({
        public: {
          cookiePrefix: 'acme',
          ltExtensions: { auth: { cookieNames: { state: 'exact-state', token: 'exact-token' } } },
        },
      });
      expect(getLtAuthCookieNames()).toEqual({ state: 'exact-state', token: 'exact-token' });
    });
  });

  describe('resolveLtAuthState (duplicate-tolerant twin resolution)', () => {
    it('returns null for empty / no-match cookie strings', async () => {
      const { resolveLtAuthState } = await import('../src/runtime/lib/auth-state');
      expect(resolveLtAuthState('')).toBeNull();
      expect(resolveLtAuthState('other=1; foo=bar')).toBeNull();
    });

    it('reads a single user-bearing cookie', async () => {
      const { resolveLtAuthState } = await import('../src/runtime/lib/auth-state');
      const v = encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: { id: '1' } }));
      expect(resolveLtAuthState(`lt-auth-state=${v}`)?.user).toEqual({ id: '1' });
    });

    it('PREFERS the user-bearing twin over a stale { user: null } twin (any order)', async () => {
      const { resolveLtAuthState } = await import('../src/runtime/lib/auth-state');
      const userC = encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: { id: '7' } }));
      const nullC = encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: null }));
      expect(resolveLtAuthState(`lt-auth-state=${nullC}; lt-auth-state=${userC}`)?.user).toEqual({ id: '7' });
      expect(resolveLtAuthState(`lt-auth-state=${userC}; lt-auth-state=${nullC}`)?.user).toEqual({ id: '7' });
    });

    it('falls back to the { user: null } state when no twin carries a user', async () => {
      const { resolveLtAuthState } = await import('../src/runtime/lib/auth-state');
      const nullC = encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: null }));
      const state = resolveLtAuthState(`lt-auth-state=${nullC}`);
      expect(state).not.toBeNull();
      expect(state?.user).toBeNull();
    });

    it('skips malformed entries and still finds a valid user-bearing twin', async () => {
      const { resolveLtAuthState } = await import('../src/runtime/lib/auth-state');
      const userC = encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: { id: '9' } }));
      expect(resolveLtAuthState(`lt-auth-state=%7Bnot-json; lt-auth-state=${userC}`)?.user).toEqual({ id: '9' });
    });

    it('honours an explicit cookie name argument', async () => {
      const { resolveLtAuthState } = await import('../src/runtime/lib/auth-state');
      const v = encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: { id: '1' } }));
      // Default name absent; custom name present.
      expect(resolveLtAuthState(`acme-auth-state=${v}`, 'acme-auth-state')?.user).toEqual({ id: '1' });
      expect(resolveLtAuthState(`acme-auth-state=${v}`, 'lt-auth-state')).toBeNull();
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
