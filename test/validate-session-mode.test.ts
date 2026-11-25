/**
 * `validateSession()` keeps the auth mode the session was in (since 4.0.6).
 *
 * Up to 4.0.5 every successful re-validation (app start, hard reload) set the user with
 * `'cookie'` and then fetched a JWT from `GET /iam/token`. In JWT mode that left a window after
 * each page load in which requests went out without the stored JWT: measured in the starter's
 * auth E2E (nest-server 12.11.2, `cookies: false`, COOKIE_PREFIX), `POST /iam/two-factor/disable`
 * was sent with no `Authorization` header while `acme-jwt-token` held a valid JWT. It passed only
 * because nest-server reads the JWT cookie when no bearer comes (Strategy 2); against an API
 * before 12.11.2, or with prefixes that differ between API and app, it fails with 401. And
 * `/iam/token` itself is a cookie-only request, so in JWT-only mode it depends on the same
 * fallback.
 *
 * The get-session answer proves the session, not the transport: the signed-in user keeps JWT mode
 * while a JWT is stored, as ng-base does since 22.0.0 (`LtAuthStore.validateSession()`). The JWT is
 * still renewed in the background: ng-base renews before sending, this module has only the page
 * load and the 401 path, and with `cookies: false` the 401 path cannot pay for an expired JWT.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isLtSignedOutAtValidation, setLtSignedOutAtValidation } from '../src/runtime/lib/auth-state';
import { clearAllCookies } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig, useCookie } from './stubs/imports';

const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';
const FRESH_JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEiLCJuIjoyfQ.c2lnbmF0dXJlMg';
const USER = { email: 'someone@test.com', id: 'user-1', name: 'Someone' };

let session: { data: { user: Record<string, unknown> } | null; error?: unknown; isPending: boolean };
/** What a direct `GET /iam/get-session` answers (the probe before a sign-out). */
let probeAnswer: { body: unknown; status: number } | 'never';

vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: { email: async () => ({}) },
    signOut: async () => ({}),
    signUp: { email: async () => ({}) },
    twoFactor: {},
    useSession: () => ({ value: session }),
  }),
}));

let fetchSpy: ReturnType<typeof vi.fn>;

const tokenRequests = () => fetchSpy.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/iam/token');
const probeRequests = () => fetchSpy.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/iam/get-session');
/** The stored auth mode. `adoptJwt()` writes it through `useCookie`, which in Nuxt reaches document.cookie; the stub does not. */
const storedMode = () => useCookie<{ authMode?: string }>('lt-auth-state').value?.authMode;

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  clearAllCookies();
  setLtSignedOutAtValidation(false);
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com', ltExtensions: { auth: { basePath: '/iam' } } } });
  session = { data: { user: USER }, isPending: false };
  probeAnswer = { body: null, status: 200 };
  fetchSpy = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/iam/get-session') {
      const answer = probeAnswer;
      if (answer === 'never') {
        return new Promise(() => {});
      }
      return { json: async () => answer.body, ok: answer.status < 400, status: answer.status };
    }
    const body = path === '/iam/token' ? { token: FRESH_JWT } : {};
    return { json: async () => body, ok: true, status: 200 };
  });
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.useRealTimers();
  clearAllCookies();
  vi.restoreAllMocks();
});

async function auth() {
  const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
  return useLtAuth();
}

/** Lets a fire-and-forget `switchToJwtMode()` settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('useLtAuth().validateSession() — the auth mode after a page load', () => {
  it('keeps JWT mode for the signed-in user while a JWT is stored, and still renews the JWT in the background', async () => {
    const lt = await auth();
    lt.jwtToken.value = JWT;
    lt.setUser(USER, 'jwt');

    expect(await lt.validateSession()).toBe(true);

    // The very next request carries the stored JWT, without waiting for /iam/token.
    expect(lt.authMode.value).toBe('jwt');
    expect(lt.jwtToken.value).toBe(JWT);

    // The renewal stays: with `cookies: false` there is no session cookie, and /iam/token can only
    // be paid for by a JWT cookie that is still valid. Without it a sign-in would end with its first
    // JWT (15 minutes), however often the page is loaded.
    await settle();
    expect(tokenRequests()).toHaveLength(1);
    expect(lt.jwtToken.value).toBe(FRESH_JWT);
    expect(lt.authMode.value).toBe('jwt');
  });

  it('still fetches the JWT in cookie mode', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');

    expect(await lt.validateSession()).toBe(true);
    await settle();

    expect(tokenRequests()).toHaveLength(1);
    expect(lt.jwtToken.value).toBe(FRESH_JWT);
    expect(storedMode()).toBe('jwt');
  });

  it('falls back to the cookie session and fetches a JWT when JWT mode has none stored', async () => {
    const lt = await auth();
    lt.jwtToken.value = JWT;
    lt.setUser(USER, 'jwt');
    lt.jwtToken.value = null;

    expect(await lt.validateSession()).toBe(true);
    await settle();

    expect(tokenRequests()).toHaveLength(1);
    expect(lt.jwtToken.value).toBe(FRESH_JWT);
  });

  it('never keeps JWT mode when the session belongs to another user', async () => {
    const lt = await auth();
    lt.jwtToken.value = JWT;
    lt.setUser(USER, 'jwt');
    session = { data: { user: { email: 'other@test.com', id: 'user-2', name: 'Other' } }, isPending: false };

    expect(await lt.validateSession()).toBe(true);

    // The stored JWT is the previous user's: start on the cookie session and fetch the new one.
    expect(lt.user.value?.id).toBe('user-2');
    expect(lt.authMode.value).toBe('cookie');
    await settle();
    expect(tokenRequests()).toHaveLength(1);
  });
});

/**
 * Better Auth has no session any more, but `lt-auth-state` still holds the user (an expired
 * 7-day session, a session deleted on the server). Up to 4.0.5 `validateSession()` returned `true`
 * for the cached user: the page greeted the user by name while every protected request failed,
 * until one of them happened to answer 401 (an API that answers 403 there never logs out). Now an
 * empty `get-session` answer signs out on the page load, after a direct `get-session` confirmed
 * it: the session atom can be stale (a sign-in that does not refetch it), and a sign-in must
 * never be undone by a cached answer. The probe follows the 401 interceptor's rules.
 */
describe('useLtAuth().validateSession() — Better Auth has no session any more', () => {
  const answeredNoSession = () => {
    session = { data: null, error: null, isPending: false };
  };

  it('signs out a cached user in cookie mode when get-session confirms that no session exists', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    answeredNoSession();

    expect(await lt.validateSession()).toBe(false);

    expect(lt.user.value).toBeNull();
    expect(lt.isAuthenticated.value).toBe(false);
    expect(probeRequests()).toHaveLength(1);
    await settle();
    expect(tokenRequests()).toHaveLength(0);
  });

  it('signs out when the probe answers 401', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    answeredNoSession();
    probeAnswer = { body: { code: 'UNAUTHORIZED' }, status: 401 };

    expect(await lt.validateSession()).toBe(false);
    expect(lt.user.value).toBeNull();
  });

  it('keeps the user when the direct get-session still finds the session (a stale session atom)', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    answeredNoSession();
    probeAnswer = { body: { session: { id: 's-1' }, user: USER }, status: 200 };

    expect(await lt.validateSession()).toBe(true);
    expect(lt.user.value?.id).toBe('user-1');
  });

  it('keeps the user when the probe cannot decide (5xx)', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    answeredNoSession();
    probeAnswer = { body: null, status: 503 };

    expect(await lt.validateSession()).toBe(true);
    expect(lt.user.value?.id).toBe('user-1');
  });

  it('keeps the user, and aborts the request, when the confirming get-session does not answer in time', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    answeredNoSession();
    probeAnswer = 'never';
    vi.useFakeTimers();

    // Up to 4.0.5 this branch returned at once; a probe without a limit would hold every caller
    // that awaits validateSession() (the starter's social callback page) for good.
    const result = lt.validateSession();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBe(true);
    expect(lt.user.value?.id).toBe('user-1');
    const [, init] = probeRequests()[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(true);
  });

  it('keeps the user in JWT mode with a stored JWT, where the cookie session may be absent', async () => {
    const lt = await auth();
    lt.jwtToken.value = JWT;
    lt.setUser(USER, 'jwt');
    answeredNoSession();

    expect(await lt.validateSession()).toBe(true);

    expect(lt.user.value?.id).toBe('user-1');
    expect(lt.authMode.value).toBe('jwt');
    expect(probeRequests()).toHaveLength(0);
  });

  it('keeps the user when get-session failed instead of answering', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    session = { data: null, error: new TypeError('Failed to fetch'), isPending: false };

    expect(await lt.validateSession()).toBe(true);

    expect(lt.user.value?.id).toBe('user-1');
    expect(probeRequests()).toHaveLength(0);
  });
});

/**
 * The sign-out on the page load must not cost the redirect to the login page (since 4.0.7).
 *
 * Up to 4.0.5 the cached user stayed, and the first protected request that answered 401 made the
 * interceptor confirm the dead session and send the browser to the login page. In 4.0.6 the user
 * is already gone when that 401 arrives, and the interceptor ignores a 401 without a signed-in
 * user: the visitor stayed on the protected page, shown as signed out, with every request failing
 * (found by ng-base's review of the same change in 22.1.4). `validateSession()` therefore notes
 * the sign-out, and the interceptor treats the next 401 as it did for the cached user.
 */
describe('useLtAuth().validateSession() — the next 401 still leads to the login page', () => {
  const answeredNoSession = () => {
    session = { data: null, error: null, isPending: false };
  };

  it('notes the sign-out when get-session confirmed that no session exists', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    answeredNoSession();

    expect(await lt.validateSession()).toBe(false);

    expect(isLtSignedOutAtValidation()).toBe(true);
  });

  it('notes nothing when the probe gives no verdict and the user stays', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    answeredNoSession();
    probeAnswer = { body: null, status: 503 };

    expect(await lt.validateSession()).toBe(true);

    expect(isLtSignedOutAtValidation()).toBe(false);
  });

  it('forgets the note on the next sign-in and on an explicit sign-out', async () => {
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    answeredNoSession();
    await lt.validateSession();

    lt.setUser(USER, 'cookie');
    expect(isLtSignedOutAtValidation()).toBe(false);

    setLtSignedOutAtValidation(true);
    lt.clearUser();
    expect(isLtSignedOutAtValidation()).toBe(false);
  });
});
