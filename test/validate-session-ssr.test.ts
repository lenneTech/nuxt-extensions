// @vitest-environment node
/**
 * Regression: `validateSession()` must never hang the server run.
 *
 * Better Auth's session atom refuses to fetch when `window` is undefined
 * (`better-auth/dist/client/query.mjs`: `if (isServer()) return;`), so on the server
 * `isPending` stays `true` forever. The old code awaited it with no guard and no
 * timeout: the call — and any SSR response awaiting it — never settled.
 *
 * Deliberately runs in the `node` environment against the REAL Better Auth client:
 * a mocked `useSession()` could not show what the library does without a `window`.
 * Every outcome is measured as a race against an external timer, so a regression
 * fails the assertion instead of hanging the test run. `fetch` is a recording stub:
 * the server cases assert that no request leaves at all, the client control asserts
 * that the same harness does resolve once requests are possible.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetLtAuthClientSingleton } from '../src/runtime/lib/auth-client';
import { resetStubReactiveStores, resetStubRequestHeaders, resetStubRuntimeConfig, setStubRequestHeaders, useCookie } from './stubs/imports';
import { resetTestRenderScope, setTestRenderScope } from './stubs/render-scope';

const PENDING = 'PENDING';
const USER = { id: 'u1', email: 'a@example.com' };
const AUTH_STATE_COOKIE = `lt-auth-state=${encodeURIComponent(JSON.stringify({ user: USER, authMode: 'cookie' }))}`;

let requests: string[] = [];

/** Recording fetch stub. `respond` decides the backend's answer per request. */
function stubFetch(respond: (url: string) => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String((input as { url?: string })?.url ?? input);
      requests.push(url);
      return respond(url);
    }),
  );
}

function json(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status: 200 }));
}

/** Resolves with the call's result, or with `PENDING` if `ms` elapse first. */
function race<T>(promise: Promise<T>, ms: number): Promise<T | typeof PENDING> {
  return Promise.race([promise, new Promise<typeof PENDING>((resolve) => setTimeout(() => resolve(PENDING), ms))]);
}

async function loadAuth() {
  // The auth client is a module-level singleton; rebuild it per test. (Not
  // `vi.resetModules()`: that would hand the source a fresh `#imports` stub the
  // setters above never reach.)
  resetLtAuthClientSingleton();
  const { useLtAuth } = await import('../src/runtime/composables/auth/use-lt-auth');
  return useLtAuth();
}

/** Makes Better Auth's `isServer()` false, i.e. a browser run. */
function stubBrowser(cookie: string): void {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { cookie });
}

beforeEach(() => {
  requests = [];
  resetStubRuntimeConfig();
  resetStubReactiveStores();
  resetStubRequestHeaders();
});

afterEach(() => {
  resetTestRenderScope();
  resetStubRequestHeaders();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('validateSession() during SSR', () => {
  beforeEach(() => {
    setTestRenderScope('server');
    stubFetch(() => json({ session: { id: 's1' }, user: USER }));
  });

  it('runs without a window, like the server', () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
  });

  it('settles at once from the request cookie and sends no request', async () => {
    setStubRequestHeaders({ cookie: AUTH_STATE_COOKIE });
    const auth = await loadAuth();

    await expect(race(auth.validateSession(), 200)).resolves.toBe(true);
    expect(requests).toEqual([]);
  });

  it('settles at once with false when the request carries no user', async () => {
    const auth = await loadAuth();

    await expect(race(auth.validateSession(), 200)).resolves.toBe(false);
    expect(requests).toEqual([]);
  });

  it('reads the resolved cookie view, not the raw useCookie ref', async () => {
    // The `useCookie` stub holds null here while the Cookie header carries the user —
    // the collapsed-twin case `resolvedAuthState` exists for. Nothing on the server
    // reconciles the two, so reading the raw ref would answer "logged out".
    setStubRequestHeaders({ cookie: AUTH_STATE_COOKIE });
    const auth = await loadAuth();
    expect(useCookie('lt-auth-state').value).toBeNull();

    await expect(race(auth.validateSession(), 200)).resolves.toBe(true);
  });
});

describe('validateSession() in the browser (control)', () => {
  it('resolves after the session request with the real client', async () => {
    stubBrowser('');
    stubFetch(() => json({ session: { id: 's1' }, user: USER }));
    const auth = await loadAuth();

    await expect(race(auth.validateSession(), 2000)).resolves.toBe(true);
    expect(requests.some((url) => url.endsWith('/get-session'))).toBe(true);
  });

  it('falls back to the resolved cookie view when the session returns no user', async () => {
    stubBrowser(AUTH_STATE_COOKIE);
    stubFetch(() => json(null));
    const auth = await loadAuth();
    // Simulate a collapsed twin after init: the raw ref says "no user", the browser
    // cookies still carry one.
    useCookie('lt-auth-state').value = { user: null };

    await expect(race(auth.validateSession(), 2000)).resolves.toBe(true);
  });

  it('stops waiting after the timeout and falls back to the cached user', async () => {
    vi.useFakeTimers();
    stubBrowser(AUTH_STATE_COOKIE);
    stubFetch(() => new Promise<Response>(() => {})); // backend never answers
    const auth = await loadAuth();

    const result = race(auth.validateSession(), 11_000);
    await vi.advanceTimersByTimeAsync(11_000);

    await expect(result).resolves.toBe(true);
    expect(requests.some((url) => url.endsWith('/get-session'))).toBe(true);
  });
});
