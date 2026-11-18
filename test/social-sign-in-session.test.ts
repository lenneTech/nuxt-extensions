/**
 * `useLtAuth().signIn.social` ends in a signed-in user where the answer already carries one.
 *
 * The redirect shape answers `{ url, redirect: true }` and leaves the page, so there is nothing to
 * store: the user arrives with `validateSession()` on the page the provider sends the browser back
 * to. The ID-token shape answers `{ user }` on the spot (an app inside Microsoft Teams, where the
 * host already knows the user), and the composable has to do what it does after `signIn.email`:
 * keep the user, and fetch the JWT from `/iam/token` rather than take anything from the body that
 * is not one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllCookies } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig, useCookie } from './stubs/imports';

/** An opaque Better-Auth session token, as `/sign-in/social` with an `idToken` puts it into the body. */
const SESSION_TOKEN = 'XqvQpZ8R2b1sD4fG6hJ7kL9mN0pQrStU';
const JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';
const USER = { email: 'someone@test.com', id: 'user-1', name: 'Someone' };

const social = vi.fn();

vi.mock('../src/runtime/composables/use-lt-auth-client', () => ({
  useLtAuthClient: () => ({
    changePassword: () => {},
    passkey: {},
    signIn: { email: vi.fn(), social },
    signOut: async () => ({}),
    signUp: { email: vi.fn() },
    twoFactor: { verifyBackupCode: vi.fn(), verifyTotp: vi.fn() },
    useSession: () => ({ value: { data: null, isPending: false } }),
  }),
}));

let fetchSpy: ReturnType<typeof vi.fn>;

const tokenCookie = () => useCookie<string | null>('lt-jwt-token');
const tokenRequests = () => fetchSpy.mock.calls.filter(([url]) => new URL(String(url)).pathname === '/iam/token');

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  clearAllCookies();
  setStubRuntimeConfig({ public: { apiUrl: 'https://api.example.com', ltExtensions: { auth: { basePath: '/iam' } } } });
  fetchSpy = vi.fn(async () => ({ json: async () => ({ token: JWT }), ok: true, status: 200 }));
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  social.mockReset();
});

afterEach(() => {
  clearAllCookies();
  vi.restoreAllMocks();
});

async function auth() {
  const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
  return useLtAuth();
}

describe('useLtAuth().signIn.social', () => {
  it('hands the parameters on and stores nothing when the answer is a redirect', async () => {
    social.mockResolvedValue({ data: { redirect: true, url: 'https://login.example.com/authorize' }, error: null });
    const lt = await auth();
    const params = { additionalParams: { prompt: 'none' }, callbackURL: 'https://app.example.com/auth/callback', provider: 'microsoft' };

    const result = (await lt.signIn.social(params)) as { data: { url: string } };

    expect(social).toHaveBeenCalledWith(params, undefined);
    expect(result.data.url).toBe('https://login.example.com/authorize');
    expect(lt.user.value).toBeNull();
    expect(tokenRequests()).toHaveLength(0);
  });

  it('signs the user in on an ID-token answer and fetches the JWT from /iam/token', async () => {
    social.mockResolvedValue({ data: { redirect: false, user: USER }, error: null });
    const lt = await auth();

    await lt.signIn.social({ idToken: { token: 'provider-id-token' }, provider: 'microsoft' });

    expect(lt.user.value?.id).toBe('user-1');
    expect(lt.isAuthenticated.value).toBe(true);
    expect(tokenRequests()).toHaveLength(1);
    expect(tokenCookie().value).toBe(JWT);
  });

  it('never takes a session token from the answer for the JWT', async () => {
    // What a client without the wrapper in `auth-client.ts` would hand on.
    social.mockResolvedValue({ data: { redirect: false, token: SESSION_TOKEN, user: USER }, error: null });
    const lt = await auth();

    await lt.signIn.social({ idToken: { token: 'provider-id-token' }, provider: 'microsoft' });

    expect(tokenCookie().value).toBe(JWT);
    expect(document.cookie).not.toContain(SESSION_TOKEN);
  });

  it.each([
    ['the session token', { token: SESSION_TOKEN }],
    ['an empty body', {}],
  ])('stays on the cookie session when /iam/token answers %s instead of a JWT, and stores nothing readable', async (_label, tokenAnswer) => {
    // No JWT arrives to overwrite whatever was written before, so the cookie shows what the sign-in stored itself.
    fetchSpy = vi.fn(async () => ({ json: async () => tokenAnswer, ok: true, status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    social.mockResolvedValue({ data: { redirect: false, token: SESSION_TOKEN, user: USER }, error: null });
    const lt = await auth();

    await lt.signIn.social({ idToken: { token: 'provider-id-token' }, provider: 'microsoft' });

    expect(tokenCookie().value).toBeNull();
    expect(document.cookie).not.toContain(SESSION_TOKEN);
    expect(lt.authMode.value).toBe('cookie');
    expect(lt.user.value?.id).toBe('user-1');
    expect(tokenRequests()).toHaveLength(1);
  });

  it('takes a JWT the server put into the answer', async () => {
    social.mockResolvedValue({ data: { redirect: false, token: JWT, user: USER }, error: null });
    const lt = await auth();

    await lt.signIn.social({ idToken: { token: 'provider-id-token' }, provider: 'microsoft' });

    expect(tokenCookie().value).toBe(JWT);
    expect(lt.user.value?.id).toBe('user-1');
    expect(tokenRequests()).toHaveLength(0);
  });

  it('stores nothing after a refused sign-in and clears the loading flag', async () => {
    social.mockResolvedValue({ data: null, error: { message: 'signup disabled', status: 401 } });
    const lt = await auth();

    const result = (await lt.signIn.social({ idToken: { token: 'provider-id-token' }, provider: 'microsoft' })) as { error: { status: number } };

    expect(result.error.status).toBe(401);
    expect(lt.user.value).toBeNull();
    expect(lt.isLoading.value).toBe(false);
    expect(tokenRequests()).toHaveLength(0);
  });
});
