/**
 * Logout cookie-cleanup tests.
 *
 * Covers the regression where `clearUser()` used to overwrite the auth-state
 * cookie with an empty `{ user: null }` payload + 7-day max-age — leaving an
 * orphan "logged out" cookie sitting in the jar for a week. After the fix,
 * `clearUser()` (and the underlying `clearLtAuthCookies()` helper) hard-deletes
 * the cookie with `max-age=0` so the browser drops it.
 *
 * Note on happy-dom: the test runtime (happy-dom 20.x) does NOT remove cookies
 * with `max-age=0` from `document.cookie` — it leaves an empty stub like
 * `name=` in the cookie string. Real browsers remove the cookie entirely. The
 * spec explicitly accepts both shapes: "Either the cookie is gone, or only an
 * expired stub remains". The assertion therefore checks for the absence of a
 * live JSON payload (`name=<non-empty>`), not the cookie name itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllCookies, readCookieValue } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';

// Stub the Better-Auth client so we can instantiate `useLtAuth()` without
// pulling in the real client + its peer-deps. Only the surface read by the
// composable's destructure / pass-through needs to exist.
vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: { email: async () => ({}) },
    signOut: async () => ({}),
    signUp: { email: async () => ({}) },
    twoFactor: {},
    useSession: () => ({ value: { data: null, isPending: false } }),
  }),
}));

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
  resetStubReactiveStores();
  clearAllCookies();
});

afterEach(() => {
  clearAllCookies();
  resetStubRuntimeConfig();
  resetStubReactiveStores();
});

describe('clearLtAuthCookies()', () => {
  it('hard-deletes the default auth-state cookie (no live payload remains)', async () => {
    const { clearLtAuthCookies } = await import('../src/runtime/lib/auth-state');
    // Seed: an existing logged-in cookie with real JSON payload.
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ user: { id: '1' } }))}; path=/`;
    expect(readCookieValue('lt-auth-state')).toBeTruthy();

    clearLtAuthCookies();

    // Either the cookie is gone (real browsers) or only an empty stub remains
    // (happy-dom). Both states satisfy "no orphan logged-out cookie".
    const value = readCookieValue('lt-auth-state');
    expect(value === undefined || value === '').toBe(true);
  });

  it('hard-deletes the configured custom auth-state cookie and leaves the default name absent', async () => {
    const { clearLtAuthCookies } = await import('../src/runtime/lib/auth-state');
    setCookieNamesConfig('my-state', 'my-token');

    document.cookie = `my-state=${encodeURIComponent(JSON.stringify({ user: { id: '7' } }))}; path=/`;
    expect(readCookieValue('my-state')).toBeTruthy();

    clearLtAuthCookies();

    const customValue = readCookieValue('my-state');
    expect(customValue === undefined || customValue === '').toBe(true);
    // Nothing wrote `lt-auth-state` under custom config, so no live payload
    // for the default name may exist (an empty stub from a sibling test's
    // teardown is acceptable — happy-dom keeps those entries around).
    const defaultValue = readCookieValue('lt-auth-state');
    expect(defaultValue === undefined || defaultValue === '').toBe(true);
  });

  it('hard-deletes the JWT token cookie alongside the state cookie', async () => {
    const { clearLtAuthCookies, setLtJwtToken } = await import('../src/runtime/lib/auth-state');
    setLtJwtToken('abc');
    expect(readCookieValue('lt-jwt-token')).toBeTruthy();

    clearLtAuthCookies();

    const value = readCookieValue('lt-jwt-token');
    expect(value === undefined || value === '').toBe(true);
  });
});

describe('useLtAuth().clearUser()', () => {
  it('drops the live lt-auth-state payload under the default cookie name', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const { clearUser, setUser } = useLtAuth();

    setUser({ id: 'u1', email: 't@example.com', name: 'Test' });
    expect(readCookieValue('lt-auth-state')).toBeTruthy();

    clearUser();

    const value = readCookieValue('lt-auth-state');
    expect(value === undefined || value === '').toBe(true);
  });

  it('drops the live custom state cookie and never resurrects the default name', async () => {
    setCookieNamesConfig('my-state', 'my-token');

    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const { clearUser, setUser } = useLtAuth();

    setUser({ id: 'u2', email: 't@example.com', name: 'Test' });
    expect(readCookieValue('my-state')).toBeTruthy();

    clearUser();

    const customValue = readCookieValue('my-state');
    expect(customValue === undefined || customValue === '').toBe(true);
    // The default name was never written under the custom config — no live
    // payload may exist for it (an empty stub left by happy-dom's teardown is
    // acceptable; the live JSON payload from setUser would not be).
    const defaultValue = readCookieValue('lt-auth-state');
    expect(defaultValue === undefined || defaultValue === '').toBe(true);
  });

  it('resets the reactive auth-state ref to { user: null, authMode: "cookie" } (regression guard)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    const auth = useLtAuth();

    auth.setUser({ id: 'u3', email: 't@example.com', name: 'Test' });
    expect(auth.user.value).toMatchObject({ id: 'u3' });
    expect(auth.isAuthenticated.value).toBe(true);

    auth.clearUser();

    expect(auth.user.value).toBeNull();
    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.authMode.value).toBe('cookie');
  });
});
