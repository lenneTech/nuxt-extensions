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

// Controllable stand-in for useLtAuth(): the interceptor only reads
// isAuthenticated, clearUser and fetchWithAuth.
const authStub = vi.hoisted(() => ({
  clearUser: vi.fn(),
  fetchWithAuth: vi.fn(),
  isAuthenticated: { value: true },
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
async function setupInterceptor(): Promise<UnauthorizedHandler> {
  const provide = vi.fn();
  const nuxtApp = {
    $config: { public: { ltExtensions: { auth: {} } } },
    $router: { currentRoute: { value: { fullPath: '/app/board', path: '/app/board' } } },
    provide,
  };
  const plugin = (await import('../src/runtime/plugins/auth-interceptor.client')).default;
  plugin(nuxtApp as never);
  const handler = provide.mock.calls.find(([name]) => name === 'ltHandleUnauthorized')?.[1];
  expect(handler).toBeTypeOf('function');
  return handler as UnauthorizedHandler;
}

function probeResolvesWith(body: unknown, ok = true): void {
  authStub.fetchWithAuth.mockResolvedValue({
    ok,
    json: async () => body,
  });
}

beforeEach(() => {
  authStub.clearUser.mockReset();
  authStub.fetchWithAuth.mockReset();
  authStub.isAuthenticated.value = true;
});

describe('auth interceptor — 401 handling probes the session before logging out', () => {
  it('keeps the user logged in when the session is still alive (mislabeled permission error)', async () => {
    const handleUnauthorized = await setupInterceptor();
    probeResolvesWith({ session: { id: 's1' }, user: { id: 'u1' } });

    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.fetchWithAuth).toHaveBeenCalledWith('https://api.example.com/iam/get-session', { method: 'GET' });
    expect(authStub.clearUser).not.toHaveBeenCalled();
  });

  it('logs out when the session endpoint returns an empty session (real expiry)', async () => {
    const handleUnauthorized = await setupInterceptor();
    // Better Auth answers 200 with a null body when there is no session
    probeResolvesWith(null);

    await handleUnauthorized('https://api.example.com/measures');

    expect(authStub.clearUser).toHaveBeenCalledTimes(1);
  });

  it('logs out when the session endpoint itself rejects the request', async () => {
    const handleUnauthorized = await setupInterceptor();
    probeResolvesWith(null, false);

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
