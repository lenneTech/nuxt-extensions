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
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubCookieRefsPerCall, setStubRuntimeConfig } from './stubs/imports';

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

/**
 * A JWT expires long before the session behind it (Better Auth's JWT plugin
 * defaults to 15 minutes, the session to 7 days), and nothing refreshes it
 * while the user works inside the app. Without a retry, the first request after
 * the expiry fails with 401 although the session cookie would mint a new token
 * at once — once every 15 minutes a save is lost.
 */
describe('fetchWithAuth — stale JWT in JWT mode', () => {
  /** Answer `/token` with a fresh token and `/measures` with 401 for the stale one. */
  function backendWithStaleBearer(tokenResponse: { ok: boolean; status: number; token?: string }): void {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === `${API_BASE}/token`) {
        return { json: async () => ({ token: tokenResponse.token }), ok: tokenResponse.ok, status: tokenResponse.status };
      }
      const bearer = new Headers(init?.headers).get('Authorization');
      return bearer === 'Bearer fresh.jwt.token' ? { json: async () => ({}), ok: true, status: 200 } : { json: async () => ({}), ok: false, status: 401 };
    });
  }

  function callsTo(url: string): RequestInit[] {
    return fetchSpy.mock.calls.filter(([calledUrl]) => calledUrl === url).map(([, init]) => init as RequestInit);
  }

  it('mints a fresh token from the session cookie and retries the request once', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    signedInWithJwt();
    backendWithStaleBearer({ ok: true, status: 200, token: 'fresh.jwt.token' });
    const { fetchWithAuth } = useLtAuth();

    const response = await fetchWithAuth('https://api.example.com/measures', { body: '{"a":1}', method: 'POST' });

    expect(response.status).toBe(200);
    expect(callsTo(`${API_BASE}/token`)).toHaveLength(1);
    expect(callsTo(`${API_BASE}/token`)[0]?.credentials).toBe('include');
    const attempts = callsTo('https://api.example.com/measures');
    expect(attempts).toHaveLength(2);
    expect(new Headers(attempts[1]?.headers).get('Authorization')).toBe('Bearer fresh.jwt.token');
    expect(attempts[1]?.credentials).toBe('omit');
    expect(attempts[1]?.body).toBe('{"a":1}');
  });

  it('returns the original 401 without a retry when no new token can be minted (session really gone)', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    signedInWithJwt();
    backendWithStaleBearer({ ok: false, status: 401 });
    const { fetchWithAuth } = useLtAuth();

    const response = await fetchWithAuth('https://api.example.com/measures', { method: 'GET' });

    expect(response.status).toBe(401);
    expect(callsTo('https://api.example.com/measures')).toHaveLength(1);
  });

  it('retries only once — a 401 that survives a fresh token is a permission error, not a stale bearer', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    signedInWithJwt();
    fetchSpy.mockImplementation(async (url: string) =>
      url === `${API_BASE}/token` ? { json: async () => ({ token: 'fresh.jwt.token' }), ok: true, status: 200 } : { json: async () => ({}), ok: false, status: 401 },
    );
    const { fetchWithAuth } = useLtAuth();

    const response = await fetchWithAuth('https://api.example.com/measures', { method: 'GET' });

    expect(response.status).toBe(401);
    expect(callsTo('https://api.example.com/measures')).toHaveLength(2);
    expect(callsTo(`${API_BASE}/token`)).toHaveLength(1);
  });

  it('mints one token for a burst of parallel 401s, not one per request', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    signedInWithJwt();
    backendWithStaleBearer({ ok: true, status: 200, token: 'fresh.jwt.token' });
    const { fetchWithAuth } = useLtAuth();

    const responses = await Promise.all([
      fetchWithAuth('https://api.example.com/measures', { method: 'GET' }),
      fetchWithAuth('https://api.example.com/measures', { method: 'GET' }),
      fetchWithAuth('https://api.example.com/measures', { method: 'GET' }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(callsTo(`${API_BASE}/token`)).toHaveLength(1);
  });

  /**
   * The burst usually spans components, each with its own `useLtAuth()`. In
   * Nuxt every `useCookie()` call owns its own ref, and the others learn about a
   * write only on a later task — so an instance that joined another one's
   * refresh found the expired token still in its own ref and retried with it.
   */
  it('hands the fresh token to every instance in the burst, not just the one that minted it', async () => {
    setStubCookieRefsPerCall(true);
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    signedInWithJwt();
    backendWithStaleBearer({ ok: true, status: 200, token: 'fresh.jwt.token' });
    const page = useLtAuth();
    const widget = useLtAuth();

    const responses = await Promise.all([
      page.fetchWithAuth('https://api.example.com/measures', { method: 'GET' }),
      widget.fetchWithAuth('https://api.example.com/measures', { body: '{"a":1}', method: 'POST' }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(callsTo(`${API_BASE}/token`)).toHaveLength(1);
    // Adopted, so the widget's next request does not start with the expired bearer.
    expect(widget.jwtToken.value).toBe('fresh.jwt.token');
  });
});
