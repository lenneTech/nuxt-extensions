/**
 * One authenticated fetch for every caller (DEV-4074).
 *
 * `useLtAuth().fetchWithAuth` and `ltAuthFetch` / `createLtAuthFetch` used to be two copies of the
 * Cookie/JWT logic. Only the first renewed an expired JWT; the second, which the Better-Auth client,
 * the AI composables, offline sync and the sync hints use, knew only the switch from cookie to JWT,
 * and it fetched that JWT from `/iam` whatever `auth.basePath` said. Both now run through the same
 * implementation in `lib/auth-state.ts`; this file holds the behaviour for `ltAuthFetch` and for the
 * AI and sync calls on top of it. `auth-fetch-cookies.test.ts` holds it for `fetchWithAuth`.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ltAiRequest } from '../src/runtime/lib/ai';
import { attemptLtJwtSwitch, createLtAuthFetch, getLtJwtToken, ltAuthFetch } from '../src/runtime/lib/auth-state';
import { createLtSyncEngine, resetLtSyncEngines } from '../src/runtime/lib/sync';
import { deleteLtSyncDatabase } from '../src/runtime/lib/sync-store';
import { clearAllCookies } from './stubs/cookies';
import { resetStubReactiveStores, resetStubRuntimeConfig, setStubRuntimeConfig } from './stubs/imports';
import { FakeSyncServer } from './fixtures/sync-server';

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

const API = 'https://api.example.com';
/** JWT-shaped, as the token cookie accepts nothing else (session-token-guard.test.ts). */
const STALE = 'eyJhbGciOiJFZERTQSJ9.eyJzdGFsZSI6dHJ1ZX0.c3RhbGU';
const FRESH = 'eyJhbGciOiJFZERTQSJ9.eyJmcmVzaCI6dHJ1ZX0.ZnJlc2g';

let fetchSpy: ReturnType<typeof vi.fn>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

/** A signed-in user; in JWT mode with the expired token in the token cookie. */
function signedIn(mode: 'cookie' | 'jwt'): void {
  document.cookie = `lt-auth-state=${encodeURIComponent(JSON.stringify({ authMode: mode, user: { email: 'someone@test.com', id: 'u1' } }))}; path=/`;
  if (mode === 'jwt') {
    document.cookie = `lt-jwt-token=${encodeURIComponent(JSON.stringify(STALE))}; path=/`;
  }
}

/**
 * The API: `<basePath>/token` mints {@link FRESH} (or refuses), every other route answers only a
 * request that carries the fresh bearer and 401 otherwise.
 */
function backend(options: { mint?: boolean; onAuthorized?: (url: string, init: RequestInit) => Promise<Response> | Response } = {}): void {
  const { mint = true, onAuthorized = () => json(200, { ok: true }) } = options;
  fetchSpy.mockImplementation(async (input: string, init: RequestInit = {}) => {
    if (input.endsWith('/token')) {
      return mint ? json(200, { token: FRESH }) : json(401, {});
    }
    return new Headers(init.headers).get('Authorization') === `Bearer ${FRESH}` ? onAuthorized(input, init) : json(401, {});
  });
}

function callsTo(predicate: (url: string) => boolean): RequestInit[] {
  return fetchSpy.mock.calls.filter(([url]) => predicate(String(url))).map(([, init]) => (init ?? {}) as RequestInit);
}

const tokenCalls = () => callsTo((url) => url.endsWith('/token'));

beforeEach(() => {
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  clearAllCookies();
  setStubRuntimeConfig({ public: { apiUrl: API, ltExtensions: { auth: { basePath: '/iam' } } } });
  fetchSpy = vi.fn(async () => json(200, {}));
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  clearAllCookies();
  vi.restoreAllMocks();
});

describe('ltAuthFetch — an expired JWT', () => {
  it('mints a fresh token after a 401 in JWT mode and retries the request once with it', async () => {
    signedIn('jwt');
    backend();

    const response = await ltAuthFetch(`${API}/measures`, { body: '{"a":1}', method: 'POST' });

    expect(response.status).toBe(200);
    expect(tokenCalls()).toHaveLength(1);
    expect(fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/token'))?.[0]).toBe(`${API}/iam/token`);
    expect(tokenCalls()[0]?.credentials).toBe('include');
    const attempts = callsTo((url) => url === `${API}/measures`);
    expect(attempts).toHaveLength(2);
    expect(new Headers(attempts[0]?.headers).get('Authorization')).toBe(`Bearer ${STALE}`);
    expect(new Headers(attempts[1]?.headers).get('Authorization')).toBe(`Bearer ${FRESH}`);
    expect(attempts[1]?.body).toBe('{"a":1}');
    // The session cookie stays on both attempts: nest-server falls back to it when a bearer fails
    expect(attempts.map((init) => init.credentials)).toEqual(['include', 'include']);
    // Stored, so the next request starts with the fresh token
    expect(getLtJwtToken()).toBe(FRESH);
  });

  it('returns the original 401 without a retry when no new token can be minted', async () => {
    signedIn('jwt');
    backend({ mint: false });

    const response = await ltAuthFetch(`${API}/measures`, { method: 'GET' });

    expect(response.status).toBe(401);
    expect(callsTo((url) => url === `${API}/measures`)).toHaveLength(1);
    expect(getLtJwtToken()).toBe(STALE);
  });

  it('retries only once: a 401 that survives a fresh token reaches the caller unchanged', async () => {
    signedIn('jwt');
    backend({ onAuthorized: () => json(401, { message: 'forbidden for this user' }) });

    const response = await ltAuthFetch(`${API}/measures`, { method: 'GET' });

    expect(response.status).toBe(401);
    expect(callsTo((url) => url === `${API}/measures`)).toHaveLength(2);
    expect(tokenCalls()).toHaveLength(1);
  });

  it('leaves a 401 alone when nobody is signed in', async () => {
    backend();

    const response = await ltAuthFetch(`${API}/measures`, { method: 'GET' });

    expect(response.status).toBe(401);
    expect(tokenCalls()).toHaveLength(0);
  });

  it('shares one /token call between ltAuthFetch and fetchWithAuth when a burst of requests fails', async () => {
    const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
    signedIn('jwt');
    backend();
    const { fetchWithAuth } = useLtAuth();

    const responses = await Promise.all([
      ltAuthFetch(`${API}/ai/prompts`, { method: 'GET' }),
      fetchWithAuth(`${API}/measures`, { method: 'GET' }),
      ltAuthFetch(`${API}/sync/note`, { method: 'GET' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(tokenCalls()).toHaveLength(1);
  });
});

describe('ltAuthFetch — the switch from cookie to JWT', () => {
  it('switches to JWT after a 401 in cookie mode and retries with the token, one /token call for the whole burst', async () => {
    signedIn('cookie');
    backend();

    const responses = await Promise.all([ltAuthFetch(`${API}/a`, { method: 'GET' }), ltAuthFetch(`${API}/b`, { method: 'GET' })]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(tokenCalls()).toHaveLength(1);
    expect(new Headers(callsTo((url) => url === `${API}/a`)[0]?.headers).has('Authorization')).toBe(false);
    expect(getLtJwtToken()).toBe(FRESH);
  });
});

describe('auth.basePath', () => {
  beforeEach(() => {
    setStubRuntimeConfig({ public: { apiUrl: API, ltExtensions: { auth: { basePath: '/auth' } } } });
  });

  it('ltAuthFetch fetches the token from the configured basePath, not from /iam', async () => {
    signedIn('jwt');
    backend();

    await ltAuthFetch(`${API}/measures`, { method: 'GET' });

    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/token')).map(([url]) => url)).toEqual([`${API}/auth/token`]);
  });

  it('attemptLtJwtSwitch() without an argument follows auth.basePath', async () => {
    signedIn('cookie');
    backend();

    expect(await attemptLtJwtSwitch()).toBe(true);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([`${API}/auth/token`]);
  });

  it('keeps a basePath passed explicitly', async () => {
    signedIn('jwt');
    backend();

    await createLtAuthFetch('/iam')(`${API}/measures`, { method: 'GET' });

    expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/token')).map(([url]) => url)).toEqual([`${API}/iam/token`]);
  });
});

describe('AI and sync calls with an expired JWT', () => {
  it('an AI request renews the token and gets its answer instead of a 401', async () => {
    signedIn('jwt');
    backend({ onAuthorized: () => json(200, { mcpConfirmation: true }) });

    await expect(ltAiRequest('GET', '/settings')).resolves.toEqual({ mcpConfirmation: true });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([`${API}/ai/settings`, `${API}/iam/token`, `${API}/ai/settings`]);
  });

  describe('offline sync', () => {
    let server: FakeSyncServer;

    beforeEach(() => {
      setStubRuntimeConfig({ public: { apiUrl: API, ltExtensions: { auth: { basePath: '/iam' }, sync: { basePath: '/sync', enabled: true } } } });
      server = new FakeSyncServer();
    });

    afterEach(async () => {
      resetLtSyncEngines();
      await deleteLtSyncDatabase();
    });

    it('a push with the default fetch renews the token instead of reporting a lost session', async () => {
      signedIn('jwt');
      backend({ onAuthorized: (url, init) => server.fetch(url, init) });
      // No `fetch` option: the engine's default transport is what this test is about
      const client = createLtSyncEngine<{ title: string }>({ model: 'note' });
      await client.create({ title: 'A' });

      const result = await client.sync();

      expect(result).toMatchObject({ applied: 1, needsLogin: false });
      expect(server.live()).toMatchObject([{ data: { title: 'A' } }]);
      expect(tokenCalls()).toHaveLength(1);
    });
  });
});
