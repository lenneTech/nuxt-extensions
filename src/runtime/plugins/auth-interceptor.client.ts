/**
 * Auth Interceptor Plugin
 *
 * This plugin intercepts all API responses and handles session expiration.
 * When a 401 (Unauthorized) response is received, it verifies against the
 * session endpoint that the session is genuinely dead and then automatically:
 * 1. Clears the user session state
 * 2. Redirects to the login page
 *
 * The verification step exists because a 401 from a domain endpoint is not
 * proof of an expired session: backends may mislabel permission errors
 * (authenticated user, missing rights — semantically 403) as 401. Logging out
 * on those would kick a logged-in user out of the app for a mere missing
 * right. Only a dead session may clear state.
 *
 * Note: This is a client-only plugin (.client.ts) since auth state
 * management only makes sense in the browser context.
 */

import type { NuxtApp } from '#app';

import { useLtAuth } from '../composables/auth/use-lt-auth';
import { getLtApiBase } from '../lib/auth-state';

export default (nuxtApp: NuxtApp): void => {
  // Only run on client side
  if (import.meta.server) return;

  // IMPORTANT: Do NOT call useLtAuth() here at the top level!
  // User plugins that register custom auth plugins run AFTER module plugins.
  // We must defer useLtAuth() calls to when they're actually needed.
  let _authInstance: ReturnType<typeof useLtAuth> | null = null;

  function getAuth() {
    if (!_authInstance) {
      _authInstance = useLtAuth();
    }
    return _authInstance;
  }

  // Get configuration from runtime config
  const runtimeConfig = nuxtApp.$config?.public?.ltExtensions?.auth || {};
  const loginPath = runtimeConfig.loginPath || '/auth/login';
  const configuredPublicPaths = runtimeConfig.interceptor?.publicPaths || [];

  // Guard against a burst of parallel 401s producing several redirects.
  //
  // It is deliberately claimed as LATE as possible and released as EARLY as
  // possible: it must cover the logout + navigation, and nothing else. A 401
  // the interceptor decided not to act on (auth endpoint, public route, user
  // not hydrated yet, session probe without a verdict) must leave the window
  // open — otherwise that no-op swallows the 401s arriving right behind it,
  // and a genuinely expired session goes unnoticed until the next navigation.
  let isHandling401 = false;

  // Default paths that should not trigger auto-logout on 401
  // (public auth endpoints where 401 is expected)
  const defaultPublicPaths = ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/2fa', '/auth/setup'];
  const publicAuthPaths = [...new Set([...defaultPublicPaths, ...configuredPublicPaths])];

  /**
   * Check if current route is a public auth route
   */
  function isPublicAuthRoute(): boolean {
    const router = nuxtApp.$router as { currentRoute?: { value?: { path?: string } } } | undefined;
    const route = router?.currentRoute?.value;
    if (!route?.path) return false;
    return publicAuthPaths.some((path) => route.path!.startsWith(path));
  }

  /**
   * Check if URL is an auth-related endpoint that shouldn't trigger logout
   * (e.g., login, register, password reset, passkey endpoints)
   * These endpoints use the authFetch wrapper which handles JWT fallback
   */
  function isAuthEndpoint(url: string): boolean {
    const authEndpoints = [
      '/sign-in',
      '/sign-up',
      '/sign-out',
      '/forgot-password',
      '/reset-password',
      '/verify-email',
      // Better Auth's session routes, spelled out. A generic '/session' entry
      // used to stand here and never matched anything: the routes are
      // `get-session`, `list-sessions`, `revoke-session`, … — in every one of
      // them the character before `session` is `-`, not `/`, so `url.includes`
      // returned false. `/get-session` matters most: it is the URL the session
      // probe below calls, and exempting it is what keeps a 401 from the probe
      // out of this handler.
      '/get-session',
      '/list-sessions',
      '/revoke-session',
      '/revoke-other-sessions',
      '/token',
      // Passkey endpoints - handled by authFetch with JWT fallback
      '/passkey/',
      '/list-user-passkeys',
      '/generate-register-options',
      '/verify-registration',
      '/generate-authenticate-options',
      '/verify-authentication',
      // Two-factor endpoints
      '/two-factor/',
    ];
    return authEndpoints.some((endpoint) => url.includes(endpoint));
  }

  /**
   * How long a positive ("session is alive") verdict stays reusable.
   *
   * Releasing the guard immediately on the no-logout path (see the `finally`
   * below) means sequential 401s each probe on their own: a page firing N
   * requests the user lacks rights for costs N probes, where the old blanket
   * 1s guard hold cost one. Caching the *positive* verdict restores that saving
   * without giving the bug back, because ONLY `true` is ever cached:
   *
   * - `false` leads straight to logout + navigation — caching it is pointless.
   * - `null` (no verdict) must NEVER be cached. Suppressing re-probes after a
   *   network blip is precisely the swallowing this whole change removes.
   *
   * The worst case for a cached `true` is bounded and small: a session dying
   * inside the window is noticed up to one TTL late, never missed — unlike the
   * old guard, which could drop the verdict permanently.
   */
  const ALIVE_VERDICT_TTL_MS = 1000;
  let aliveVerdictValidUntil = 0;

  /**
   * Probe the session endpoint to decide whether the session is genuinely dead.
   *
   * Returns `true` when the session is still alive, `false` when the backend
   * confirms it is gone, and `null` when no verdict could be reached (network
   * error, rate limit, backend error).
   *
   * Recursion-safe on two layers: `isHandling401` is claimed for the whole
   * duration of the probe — the re-entrant call from the fetch wrapper runs
   * while this frame is still suspended — AND the probe URL is listed in
   * {@link isAuthEndpoint}. Keep both: the guard is the only thing standing
   * between a 401-ing session endpoint and an unbounded probe loop.
   */
  async function isSessionStillAlive(): Promise<boolean | null> {
    try {
      const { fetchWithAuth, isJwtMode, switchToJwtMode } = getAuth();
      const response = await fetchWithAuth(`${getLtApiBase()}/get-session`, { method: 'GET' });

      // Only an authentication rejection is a verdict about the session. A 429
      // (rate limit), 5xx (deploy, gateway restart, cold start) or any other
      // non-ok status says nothing about whether the user is still signed in —
      // reading those as "dead" logs people out over a transient hiccup, and
      // the immediate guard release above makes hitting one measurably likelier.
      if (response.status === 401 || response.status === 403) {
        return false;
      }
      if (!response.ok) {
        return null;
      }

      // Better Auth returns 200 with a null body when there is no session.
      // NOTE: this is also what a cookie-less request gets, which is why
      // `/get-session` must keep sending cookies (PATHS_REQUIRING_COOKIES).
      // The two cases are indistinguishable from here — the session cookie is
      // httpOnly — so an empty body has to count as "dead", or a genuinely
      // expired session would never log anyone out.
      const data = (await response.json().catch(() => null)) as { session?: unknown; user?: unknown } | null;
      const alive = Boolean(data && (data.user || data.session));

      // In JWT mode the 401 came from the bearer, but this verdict came from
      // the session COOKIE. A live cookie session therefore does not mean the
      // caller is fine — it means the bearer is stale. Without minting a fresh
      // one, every following request 401s again and the probe keeps answering
      // "alive": a loop with the UI still showing the user as signed in.
      if (alive && isJwtMode.value) {
        await switchToJwtMode().catch(() => false);
      }

      return alive;
    } catch {
      return null;
    }
  }

  /**
   * {@link isSessionStillAlive} with the positive verdict memoised.
   * See {@link ALIVE_VERDICT_TTL_MS} for why only `true` is cached.
   */
  async function probeSessionAlive(): Promise<boolean | null> {
    if (Date.now() < aliveVerdictValidUntil) {
      return true;
    }

    const verdict = await isSessionStillAlive();
    if (verdict === true) {
      aliveVerdictValidUntil = Date.now() + ALIVE_VERDICT_TTL_MS;
    }
    return verdict;
  }

  /**
   * Handle 401 Unauthorized responses
   * Verifies the session is genuinely dead, then clears user state and
   * redirects to the login page
   */
  async function handleUnauthorized(requestUrl?: string): Promise<void> {
    // Prevent multiple simultaneous 401 handling
    if (isHandling401) {
      return;
    }

    // Don't handle 401 for auth endpoints (expected behavior)
    if (requestUrl && isAuthEndpoint(requestUrl)) {
      return;
    }

    // Don't handle 401 on public auth pages
    if (isPublicAuthRoute()) {
      return;
    }

    // Only handle if user was authenticated (prevents redirect loops).
    //
    // Checked BEFORE the guard is claimed: at app start the first API call can
    // land before the auth plugin has restored the user from the cookie. That
    // 401 is a no-op here — and must stay one, so the requests right behind it
    // are still evaluated once the user IS hydrated.
    const { clearUser, isAuthenticated } = getAuth();
    if (!isAuthenticated.value) {
      return;
    }

    isHandling401 = true;
    let loggingOut = false;

    try {
      // A 401 from a domain endpoint is not proof of an expired session:
      // backends may mislabel permission errors as 401 instead of 403. Only
      // log out when the session endpoint confirms the session is dead — an
      // unverifiable probe (API unreachable) must not log the user out either.
      const sessionAlive = await probeSessionAlive();
      if (sessionAlive !== false) {
        console.debug(
          sessionAlive
            ? `[LtAuth Interceptor] 401 from ${requestUrl ?? 'unknown URL'} but session is still valid — treating it as a permission error, not logging out`
            : '[LtAuth Interceptor] 401 received but session state could not be verified — not logging out',
        );
        return;
      }

      console.debug('[LtAuth Interceptor] Session expired, logging out...');
      loggingOut = true;

      // Clear user state
      clearUser();

      // Redirect to login page with return URL
      const router = nuxtApp.$router as { currentRoute?: { value?: { fullPath?: string } } } | undefined;
      const currentPath = router?.currentRoute?.value?.fullPath;
      const redirectQuery = currentPath && currentPath !== loginPath ? `?redirect=${encodeURIComponent(currentPath)}` : '';

      // Use window.location for redirect to avoid Nuxt router issues
      window.location.href = loginPath + redirectQuery;
    } finally {
      if (loggingOut) {
        // Hold the guard until the navigation has had a chance to complete, so
        // parallel 401s from the same page load cannot redirect a second time.
        setTimeout(() => {
          isHandling401 = false;
        }, 1000);
      } else {
        // No logout happened (permission error, or no verdict from the probe).
        // Release immediately — the next 401 deserves its own verdict.
        isHandling401 = false;
      }
    }
  }

  // Guard against double-wrapping on HMR / repeated plugin invocation. Without
  // this, `originalFetch` / `originalNativeFetch` become the *previous wrapper*
  // on each reload — stack growth + duplicated 401 handlers (double redirect).
  const wrapMarker = '__ltAuthFetchWrapped';
  if (!(globalThis as any)[wrapMarker]) {
    (globalThis as any)[wrapMarker] = true;

    // Override the default $fetch to add response error handling.
    // $fetch's type embeds Nuxt's generated route union; calling it with a plain
    // string url makes vue-tsc instantiate that deeply-nested conditional type and
    // fail with "Excessive stack depth". Cast to a loose callable — the wrapper
    // below is reassigned `as typeof globalThis.$fetch`, so the public type is kept.
    const originalFetch = globalThis.$fetch as any;

    // Use a wrapper to intercept responses
    globalThis.$fetch = ((url: string, options?: any) => {
      return originalFetch(url, {
        ...options,
        onResponseError: (context: any) => {
          // Call original onResponseError if provided
          if (options?.onResponseError) {
            options.onResponseError(context);
          }

          // Handle 401 errors
          if (context.response?.status === 401) {
            handleUnauthorized(url);
          }
        },
      });
    }) as typeof globalThis.$fetch;

    // Also intercept native fetch for manual API calls
    const originalNativeFetch = globalThis.fetch;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalNativeFetch(input, init);

      // Handle 401 errors from native fetch
      if (response.status === 401) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        handleUnauthorized(url);
      }

      return response;
    };
  }

  // Provide a manual method to trigger logout on 401
  nuxtApp.provide('ltHandleUnauthorized', handleUnauthorized);
};
