/**
 * An API that hands out no JWT is never asked for one.
 *
 * nest-server with `betterAuth.jwt: false` reports `jwt: false` in `GET /iam/features`, and its
 * `/iam/token` answers 404. `useLtAuth()` used to ask for a JWT anyway after every sign-in and
 * session check, and `ltAuthFetch` after every 401: one or two 404s with a console error on every
 * page load of a cookie-only project. `requestLtJwt()`, the one place a JWT is fetched, now returns
 * `null` without a request once the features said `jwt: false`, and waits for features still on
 * their way, because at app start `validateSession()` asks for the JWT while they are.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { ltAuthFetch, noteLtJwtServedBy, requestLtJwt, resetLtJwtServedState } from '../src/runtime/lib/auth-state';
import { clearAllCookies } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';

const API = 'https://api.example.com';
const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';
const USER = { email: 'someone@test.com', id: 'user-1', name: 'Someone' };

const signInEmail = vi.fn();
const social = vi.fn();

vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: { email: signInEmail, social },
    signOut: async () => ({}),
    signUp: { email: vi.fn() },
    twoFactor: { verifyBackupCode: vi.fn(), verifyTotp: vi.fn() },
    useSession: () => ({ value: { data: null, isPending: false } }),
  }),
}));

let fetchSpy: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
let featuresSpy: Mock<() => Promise<unknown>>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

const requestsTo = (path: string) => fetchSpy.mock.calls.filter(([url]) => new URL(String(url)).pathname === path);
const tokenRequests = () => requestsTo('/iam/token');

/** What `GET /iam/features` answers (`$fetch`, as the composable reads it). */
function features(answer: () => Promise<unknown>): void {
  featuresSpy.mockImplementation(answer);
}

/** Lets the fire-and-forget JWT requests of the composable run to their end. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function auth() {
  const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
  return useLtAuth();
}

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  clearAllCookies();
  setStubRuntimeConfig({ public: { apiUrl: API, ltExtensions: { auth: { basePath: '/iam' } } } });
  // The API: `/iam/token` mints a JWT, every other route answers 401.
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => (new URL(String(input)).pathname === '/iam/token' ? json(200, { token: JWT }) : json(401, {})));
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  featuresSpy = vi.fn(async () => ({}));
  (globalThis as Record<string, unknown>).$fetch = featuresSpy;
  // Module scope survives the tests of this file: start from "nobody said anything about JWT".
  resetLtJwtServedState();
  signInEmail.mockReset();
  social.mockReset();
});

afterEach(() => {
  clearAllCookies();
  resetTestRenderScope();
  delete (globalThis as Record<string, unknown>).$fetch;
  vi.restoreAllMocks();
});

describe('an API that reports jwt: false in /iam/features', () => {
  it('gets no /token request after an email sign-in, and the user stays on the cookie session', async () => {
    features(async () => ({ jwt: false, passkey: true }));
    signInEmail.mockResolvedValue({ data: { user: USER } });
    const lt = await auth();

    await lt.signIn.email({ email: USER.email, password: 'secret-password' });
    await settle();

    expect(tokenRequests()).toHaveLength(0);
    expect(lt.user.value?.id).toBe('user-1');
    expect(lt.authMode.value).toBe('cookie');
  });

  it('gets no /token request when a forwarded sign-in (ID token, 2FA) completes', async () => {
    features(async () => ({ jwt: false }));
    social.mockResolvedValue({ data: { redirect: false, user: USER }, error: null });
    const lt = await auth();

    await lt.signIn.social({ idToken: { token: 'provider-id-token' }, provider: 'microsoft' });

    expect(tokenRequests()).toHaveLength(0);
    expect(lt.isAuthenticated.value).toBe(true);
    expect(lt.authMode.value).toBe('cookie');
  });

  it('waits for features still on their way instead of racing them (the JWT request at app start)', async () => {
    let answerFeatures: (value: unknown) => void = () => {};
    features(() => new Promise((resolve) => (answerFeatures = resolve)));
    const lt = await auth();

    const switching = lt.switchToJwtMode();
    await settle();
    expect(tokenRequests()).toHaveLength(0);

    answerFeatures({ jwt: false });

    expect(await switching).toBe(false);
    expect(tokenRequests()).toHaveLength(0);
  });

  it('passes a 401 to the caller without asking /token, in ltAuthFetch and in fetchWithAuth', async () => {
    features(async () => ({ jwt: false }));
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    await lt.fetchFeatures();

    const viaLib = await ltAuthFetch(`${API}/measures`, { method: 'GET' });
    const viaComposable = await lt.fetchWithAuth(`${API}/measures`, { method: 'GET' });

    expect(viaLib.status).toBe(401);
    expect(viaComposable.status).toBe(401);
    // Each sent once: no retry, since there is no JWT to retry with
    expect(requestsTo('/measures')).toHaveLength(2);
    expect(tokenRequests()).toHaveLength(0);
  });

  it('keeps an earlier jwt: false when a later features request fails', async () => {
    features(async () => ({ jwt: false }));
    const lt = await auth();
    await lt.fetchFeatures();
    features(async () => {
      throw new Error('offline');
    });
    await lt.fetchFeatures();

    expect(await lt.switchToJwtMode()).toBe(false);
    expect(tokenRequests()).toHaveLength(0);
  });

  it('takes the flag from features an SSR render fetched, which the client does not fetch again', async () => {
    // What nuxt-base-starter's register page does: `await fetchFeatures()` during SSR, so the
    // features and `lt-auth-features-fetched` reach the client in the payload.
    features(async () => ({ jwt: false, signUpChecks: true }));
    setTestRenderScope('server');
    await (await auth()).fetchFeatures();
    resetTestRenderScope();
    featuresSpy.mockClear();
    signInEmail.mockResolvedValue({ data: { user: USER } });

    const lt = await auth();
    await lt.signIn.email({ email: USER.email, password: 'secret-password' });
    await settle();

    expect(featuresSpy).not.toHaveBeenCalled();
    expect(tokenRequests()).toHaveLength(0);
    expect(lt.user.value?.id).toBe('user-1');
  });

  it('a second useLtAuth() call does not replace features still on their way with the empty state', async () => {
    let answerFeatures: (value: unknown) => void = () => {};
    features(() => new Promise((resolve) => (answerFeatures = resolve)));
    const first = await auth();
    // `lt-auth-features-fetched` is already true here, the features state still empty
    await auth();

    const switching = first.switchToJwtMode();
    answerFeatures({ jwt: false });

    expect(await switching).toBe(false);
    expect(tokenRequests()).toHaveLength(0);
  });
});

const fetchedAsBefore: Array<[string, () => Promise<unknown>]> = [
  ['jwt: true', async () => ({ jwt: true })],
  ['no jwt flag (an API before it)', async () => ({ passkey: true })],
  [
    'a failed request',
    async () => {
      throw new Error('offline');
    },
  ],
];

describe('the JWT is fetched as before', () => {
  it.each(fetchedAsBefore)('when /iam/features answers with %s', async (_label, answer) => {
    features(answer);
    const lt = await auth();
    lt.setUser(USER, 'cookie');
    await lt.fetchFeatures();

    expect(await lt.switchToJwtMode()).toBe(true);
    expect(tokenRequests()).toHaveLength(1);
    expect(lt.jwtToken.value).toBe(JWT);
  });

  it('on the server, where the module scope is shared across requests and holds no answer', async () => {
    setTestRenderScope('server');
    noteLtJwtServedBy(Promise.resolve({ jwt: false }));

    expect(await requestLtJwt()).toBe(JWT);
    expect(tokenRequests()).toHaveLength(1);
  });
});
