/**
 * `fetchWithAuth` credentials mode — which requests still need the cookie.
 *
 * In JWT mode the wrapper deliberately omits cookies: the bearer token is the
 * credential, and sending the session cookie alongside it would be redundant.
 * A few Better-Auth endpoints are the exception, and `/get-session` is the one
 * that bites hardest when it is forgotten.
 *
 * Better Auth resolves `/get-session` from the session COOKIE alone. The JWT
 * handed out by `/token` is not a session token, so a bearer-only request does
 * not fail loudly — it answers `200` with a `null` body, byte for byte what a
 * signed-out visitor gets. Anything probing that endpoint to find out whether a
 * session is still alive (the auth interceptor does, before logging anyone out)
 * therefore concluded "session is dead" for every authenticated user in JWT
 * mode. Since every successful login pre-fetches a JWT and flips `authMode`,
 * that was effectively every user — and a single 401 from a mere permission
 * error ended their session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllCookies } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';

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

const API_BASE = 'https://api.example.com/iam';

let fetchSpy: ReturnType<typeof vi.fn>;

/** Put the composable into JWT mode with a signed-in user. */
function signedInWithJwt(): void {
  document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: 'jwt', user: { email: 'someone@example.com', id: 'u1' } }))}`;
  document.cookie = 'lt-jwt-token=a.b.c';
}

/** The `credentials` value the wrapper used for the last request. */
function lastCredentials(): string | undefined {
  const init = fetchSpy.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  return init?.credentials;
}

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  clearAllCookies();
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com', ltExtensions: { auth: { basePath: '/iam' } } } });
  fetchSpy = vi.fn(async () => ({ json: async () => ({}), ok: true, status: 200 }));
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  clearAllCookies();
  vi.restoreAllMocks();
});

describe('fetchWithAuth — cookies in JWT mode', () => {
  it('sends the session cookie to /get-session, or the probe reads every session as dead', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    signedInWithJwt();
    const { fetchWithAuth } = useLtAuth();

    await fetchWithAuth(`${API_BASE}/get-session`, { method: 'GET' });

    expect(lastCredentials()).toBe('include');
  });

  it('still omits cookies for ordinary endpoints in JWT mode', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    signedInWithJwt();
    const { fetchWithAuth } = useLtAuth();

    await fetchWithAuth('https://api.example.com/measures', { method: 'GET' });

    expect(lastCredentials()).toBe('omit');
  });

  it('keeps sending cookies for passkey and two-factor flows', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    signedInWithJwt();
    const { fetchWithAuth } = useLtAuth();

    await fetchWithAuth(`${API_BASE}/passkey/generate-authenticate-options`, { method: 'POST' });
    expect(lastCredentials()).toBe('include');

    await fetchWithAuth(`${API_BASE}/two-factor/verify-totp`, { method: 'POST' });
    expect(lastCredentials()).toBe('include');
  });

  it('sends cookies for everything in cookie mode', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: 'cookie', user: { email: 'someone@example.com', id: 'u1' } }))}`;
    const { fetchWithAuth } = useLtAuth();

    await fetchWithAuth('https://api.example.com/measures', { method: 'GET' });

    expect(lastCredentials()).toBe('include');
  });
});
