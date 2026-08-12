/**
 * Auth-interceptor 401 hardening tests.
 *
 * A 401 from a domain endpoint is not proof of an expired session: backends may
 * mislabel permission errors (authenticated user, missing rights — semantically
 * 403) as 401. The interceptor therefore probes the session endpoint before
 * logging out:
 *  - session alive   → keep the user logged in (permission error, no logout)
 *  - session dead    → clear state + redirect to login (real expiry)
 *  - probe undecided → keep the user logged in (API unreachable ≠ logged out)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable stand-in for useLtAuth(). `isJwtMode` / `switchToJwtMode` are
// read by the probe: a live COOKIE session while the failing request carried a
// BEARER means the bearer is stale, so the probe mints a fresh one.
const authStub = vi.hoisted(() => ({
  clearUser: vi.fn(),
  fetchWithAuth: vi.fn(),
  isAuthenticated: { value: true },
  isJwtMode: { value: false },
  switchToJwtMode: vi.fn(async () => true),
}));

vi.mock('../src/runtime/composables/auth/use-lt-auth', () => ({
  useLtAuth: () => authStub,
}));

// Pin the API base so the probe URL is deterministic; keep all other exports.
vi.mock('../src/runtime/lib/auth-state', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLtApiBase: () => 'https://api.example.com/iam',
}));

type UnauthorizedHandler = (requestUrl?: string) => Promise<void>;

/**
 * Run the plugin against a stubbed NuxtApp and hand back the
 * `ltHandleUnauthorized` handler it provides — calling it directly keeps the
 * tests deterministic (no racing through the fetch wrappers).
 */
async function setupInterceptor(currentPath = '/app/board'): Promise<UnauthorizedHandler> {
  const provide = vi.fn();
  const nuxtApp = {
    $config: { public: { ltExtensions: { auth: {} } } },
    $router: { currentRoute: { value: { fullPath: currentPath, path: currentPath } } },
    provide,
  };
  const plugin = (await import('../src/runtime/plugins/auth-interceptor.client')).default;
  plugin(nuxtApp as never);
  const handler = provide.mock.calls.find(([name]) => name === 'ltHandleUnauthorized')?.[1];
  expect(handler).toBeTypeOf('function');
  return handler as UnauthorizedHandler;
}

/**
 * Stub a probe response. `status` matters: only 401/403 is a verdict about the
 * session — every other non-ok status (429, 5xx) means "no verdict".
 */
function probeResolvesWith(body: unknown, status = 200): void {
  authStub.fetchWithAuth.mockResolvedValue({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  });
}

beforeEach(() => {
  authStub.clearUser.mockReset();
  authStub.fetchWithAuth.mockReset();
  authStub.switchToJwtMode.mockClear();
  authStub.isAuthenticated.value = true;
  authStub.isJwtMode.value = false;
  window.location.href = 'https://app.example.com/app/board';
});

describe('auth interceptor — 401 handling probes the session before logging out', () => {
  it('keeps the user logged in when the session is still alive (mislabeled permission error)', async () => {
    const handleUnauthorized = await setupInterceptor();
    probeResolvesWith({ session: { id: 's1' }, user: { id: 'u1' } });

    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.fetchWithAuth).toHaveBeenCalledWith('https://api.example.com/iam/get-session', { method: 'GET' });
    expect(authStub.clearUser).not.toHaveBeenCalled();
  });

  it('logs out and redirects to login when the session endpoint returns an empty session (real expiry)', async () => {
    const handleUnauthorized = await setupInterceptor();
    // Better Auth answers 200 with a null body when there is no session
    probeResolvesWith(null);

    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.clearUser).toHaveBeenCalledTimes(1);
    // The decision to log out is only half of it — assert where the user lands,
    // so a wrong loginPath, a missing encodeURIComponent or a broken
    // redirect-loop guard cannot ship green.
    expect(window.location.href).toBe('https://app.example.com/auth/login?redirect=%2Fapp%2Fboard');
  });

  it('logs out when the session endpoint itself rejects the request (401)', async () => {
    const handleUnauthorized = await setupInterceptor();
    probeResolvesWith(null, 401);

    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.clearUser).toHaveBeenCalledTimes(1);
  });

  it('keeps the user logged in when the probe cannot be completed (API unreachable)', async () => {
    const handleUnauthorized = await setupInterceptor();
    authStub.fetchWithAuth.mockRejectedValue(new Error('network down'));

    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.clearUser).not.toHaveBeenCalled();
  });

  it('ignores 401s from auth endpoints without probing (expected failures, e.g. wrong password)', async () => {
    const handleUnauthorized = await setupInterceptor();

    await handleUnauthorized('https://api.example.com/iam/sign-in/email');

    expect(authStub.fetchWithAuth).not.toHaveBeenCalled();
    expect(authStub.clearUser).not.toHaveBeenCalled();
  });

  it('does nothing when no user is authenticated (no probe, no logout)', async () => {
    const handleUnauthorized = await setupInterceptor();
    authStub.isAuthenticated.value = false;

    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.fetchWithAuth).not.toHaveBeenCalled();
    expect(authStub.clearUser).not.toHaveBeenCalled();
  });
});

/**
 * The re-entrancy guard must cover a logout in progress — and nothing else.
 *
 * It exists so a burst of parallel 401s produces ONE redirect. But a 401 the
 * interceptor decided NOT to act on is not a logout in progress, and holding
 * the guard for those swallows every 401 arriving behind them. That window is
 * exactly where a real expiry hides: on the first page load the earliest API
 * call can land before the auth plugin has restored the user from the cookie,
 * so it is a no-op — and the requests milliseconds behind it, which would have
 * proven the session dead, were then ignored. The app stayed on a page that
 * silently rendered as "nothing here for you" instead of asking for a login.
 */
describe('auth interceptor — the 401 guard only blocks while logging out', () => {
  it('still evaluates a 401 that follows one arriving before the user was hydrated', async () => {
    const handleUnauthorized = await setupInterceptor();
    probeResolvesWith(null);

    // Auth state not restored yet → no-op, and it must stay one.
    authStub.isAuthenticated.value = false;
    await handleUnauthorized('https://api.example.com/measures');
    expect(authStub.clearUser).not.toHaveBeenCalled();

    // The auth plugin has since restored the user from the cookie.
    authStub.isAuthenticated.value = true;
    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.clearUser).toHaveBeenCalledTimes(1);
  });

  it('re-probes the next 401 after a probe that gave no verdict', async () => {
    const handleUnauthorized = await setupInterceptor();

    // API unreachable → no verdict → no logout...
    authStub.fetchWithAuth.mockRejectedValueOnce(new Error('network down'));
    await handleUnauthorized('https://api.example.com/measures');
    expect(authStub.clearUser).not.toHaveBeenCalled();

    // ...but the next 401 deserves its own verdict rather than being dropped.
    probeResolvesWith(null);
    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.clearUser).toHaveBeenCalledTimes(1);
  });

  it('re-probes the next 401 after one that was a mere permission error, once the verdict has aged out', async () => {
    vi.useFakeTimers();
    try {
      const handleUnauthorized = await setupInterceptor();

      probeResolvesWith({ session: { id: 's1' }, user: { id: 'u1' } });
      await handleUnauthorized('https://api.example.com/measures');
      expect(authStub.clearUser).not.toHaveBeenCalled();

      // The session dies while the user keeps working. Within the verdict TTL
      // the cached "alive" answer still stands — a bounded delay, deliberate.
      probeResolvesWith(null);
      await handleUnauthorized('https://api.example.com/measures');
      expect(authStub.clearUser).not.toHaveBeenCalled();

      // Past the TTL the next 401 gets a fresh verdict, and the death is noticed.
      vi.advanceTimersByTime(1001);
      await handleUnauthorized('https://api.example.com/measures');

      expect(authStub.clearUser).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('collapses a burst of parallel 401s into a single logout', async () => {
    const handleUnauthorized = await setupInterceptor();
    probeResolvesWith(null);

    await Promise.all([
      handleUnauthorized('https://api.example.com/measures'),
      handleUnauthorized('https://api.example.com/tasks'),
      handleUnauthorized('https://api.example.com/reports'),
    ]);

    expect(authStub.clearUser).toHaveBeenCalledTimes(1);
  });
});

/**
 * The probe's verdict decides whether someone stays signed in, so it must only
 * be drawn from an answer that actually says something about the session.
 */
describe('auth interceptor — what counts as a verdict about the session', () => {
  it.each([
    ['rate limited', 429],
    ['bad gateway', 502],
    ['service unavailable', 503],
  ])('does not log out when the session endpoint answers %s (%i)', async (_label, status) => {
    const handleUnauthorized = await setupInterceptor();
    probeResolvesWith(null, status);

    await handleUnauthorized('https://api.example.com/measures');

    // A deploy, a cold start or Better Auth's rate limiter says nothing about
    // whether the user is still signed in. Reading it as "dead" would end a
    // perfectly good session over a transient backend hiccup.
    expect(authStub.clearUser).not.toHaveBeenCalled();
  });

  it('reuses a positive verdict instead of re-probing for every 401 in a burst', async () => {
    const handleUnauthorized = await setupInterceptor();
    probeResolvesWith({ session: { id: 's1' }, user: { id: 'u1' } });

    // Sequential 401s — the guard does not collapse these, only the verdict
    // cache does. Without it a page full of forbidden widgets probes once per
    // request; a polled forbidden endpoint doubles its request rate forever.
    for (const path of ['/measures', '/tasks', '/reports', '/exports']) {
      await handleUnauthorized(`https://api.example.com${path}`);
    }

    expect(authStub.fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(authStub.clearUser).not.toHaveBeenCalled();
  });

  it('mints a fresh JWT when the cookie session is alive but the bearer got the 401', async () => {
    const handleUnauthorized = await setupInterceptor();
    authStub.isJwtMode.value = true;
    probeResolvesWith({ session: { id: 's1' }, user: { id: 'u1' } });

    await handleUnauthorized('https://api.example.com/measures');

    // The 401 came from the bearer; the verdict came from the session COOKIE.
    // "Alive" therefore means the bearer is stale — not that the caller is
    // fine. Without a refresh every following request 401s again while the
    // probe keeps answering "alive": a loop with the UI still showing a login.
    expect(authStub.switchToJwtMode).toHaveBeenCalledTimes(1);
    expect(authStub.clearUser).not.toHaveBeenCalled();
  });

  it('does not touch the JWT when the app runs in cookie mode', async () => {
    const handleUnauthorized = await setupInterceptor();
    authStub.isJwtMode.value = false;
    probeResolvesWith({ session: { id: 's1' }, user: { id: 'u1' } });

    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.switchToJwtMode).not.toHaveBeenCalled();
  });
});

/**
 * The same behaviour, driven through the wrapper the app actually hits.
 *
 * Every test above calls the provided `ltHandleUnauthorized` directly, which is
 * deterministic but skips the two `globalThis.fetch` / `$fetch` wrappers that
 * decide WHETHER the handler is reached at all. Those wrappers are what a real
 * 401 travels through, and nothing else in this suite covers them: a wrapper
 * that stopped calling the handler, or called it with the wrong URL, would pass
 * every test above. Adapted from the project where this bug was found.
 */
describe('auth interceptor — a real 401 reaches the handler through the fetch wrapper', () => {
  /** Install a fresh wrapper: the plugin only wraps once per global marker. */
  async function installWrapper(): Promise<void> {
    (globalThis as Record<string, unknown>).__ltAuthFetchWrapped = false;
    vi.resetModules();
    const plugin = (await import('../src/runtime/plugins/auth-interceptor.client')).default;
    plugin({
      $config: { public: { ltExtensions: { auth: {} } } },
      $router: { currentRoute: { value: { fullPath: '/app/board', path: '/app/board' } } },
      provide: vi.fn(),
    } as never);
  }

  /** Let the handler's await-chain (probe + verdict) settle. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('logs out and redirects when a 401 from native fetch proves the session is dead', async () => {
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({}), ok: false, status: 401 })) as never;
    await installWrapper();
    probeResolvesWith(null);

    await globalThis.fetch('https://api.example.com/measures');
    await settle();

    expect(authStub.clearUser).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('https://app.example.com/auth/login?redirect=%2Fapp%2Fboard');
  });

  it('leaves a successful response untouched', async () => {
    const payload = { items: [] };
    globalThis.fetch = vi.fn(async () => ({ json: async () => payload, ok: true, status: 200 })) as never;
    await installWrapper();

    const response = await globalThis.fetch('https://api.example.com/measures');

    expect(await response.json()).toBe(payload);
    expect(authStub.fetchWithAuth).not.toHaveBeenCalled();
    expect(authStub.clearUser).not.toHaveBeenCalled();
  });
});
