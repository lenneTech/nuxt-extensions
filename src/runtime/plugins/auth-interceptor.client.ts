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

  // Track if we're already handling a 401 to prevent multiple redirects
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
      '/session',
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
   * Probe the session endpoint to decide whether the session is genuinely dead.
   *
   * Returns `true` when the session is still alive, `false` when the backend
   * confirms it is gone, and `null` when the probe could not be completed
   * (e.g. network error / API unreachable — no verdict).
   *
   * Recursion-safe: the session URL matches {@link isAuthEndpoint}, so a 401
   * from the probe itself never re-enters {@link handleUnauthorized} (and
   * `isHandling401` is set while the probe runs).
   */
  async function isSessionStillAlive(): Promise<boolean | null> {
    try {
      const { fetchWithAuth } = getAuth();
      const response = await fetchWithAuth(`${getLtApiBase()}/get-session`, { method: 'GET' });
      if (!response.ok) {
        // The session endpoint itself rejects us → genuinely unauthenticated
        return false;
      }
      // Better Auth returns 200 with a null body when there is no session
      const data = (await response.json().catch(() => null)) as { session?: unknown; user?: unknown } | null;
      return Boolean(data && (data.user || data.session));
    } catch {
      return null;
    }
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

    isHandling401 = true;

    try {
      // Only handle if user was authenticated (prevents redirect loops)
      const { clearUser, isAuthenticated } = getAuth();
      if (isAuthenticated.value) {
        // A 401 from a domain endpoint is not proof of an expired session:
        // backends may mislabel permission errors as 401 instead of 403. Only
        // log out when the session endpoint confirms the session is dead — an
        // unverifiable probe (API unreachable) must not log the user out either.
        const sessionAlive = await isSessionStillAlive();
        if (sessionAlive !== false) {
          console.debug(
            sessionAlive
              ? `[LtAuth Interceptor] 401 from ${requestUrl ?? 'unknown URL'} but session is still valid — treating it as a permission error, not logging out`
              : '[LtAuth Interceptor] 401 received but session state could not be verified — not logging out',
          );
          return;
        }

        console.debug('[LtAuth Interceptor] Session expired, logging out...');

        // Clear user state
        clearUser();

        // Redirect to login page with return URL
        const router = nuxtApp.$router as { currentRoute?: { value?: { fullPath?: string } } } | undefined;
        const currentPath = router?.currentRoute?.value?.fullPath;
        const redirectQuery = currentPath && currentPath !== loginPath ? `?redirect=${encodeURIComponent(currentPath)}` : '';

        // Use window.location for redirect to avoid Nuxt router issues
        window.location.href = loginPath + redirectQuery;
      }
    } finally {
      // Reset flag after a short delay to allow navigation to complete
      setTimeout(() => {
        isHandling401 = false;
      }, 1000);
    }
  }

  // Guard against double-wrapping on HMR / repeated plugin invocation. Without
  // this, `originalFetch` / `originalNativeFetch` become the *previous wrapper*
  // on each reload — stack growth + duplicated 401 handlers (double redirect).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapMarker = '__ltAuthFetchWrapped';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(globalThis as any)[wrapMarker]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any)[wrapMarker] = true;

    // Override the default $fetch to add response error handling.
    // $fetch's type embeds Nuxt's generated route union; calling it with a plain
    // string url makes vue-tsc instantiate that deeply-nested conditional type and
    // fail with "Excessive stack depth". Cast to a loose callable — the wrapper
    // below is reassigned `as typeof globalThis.$fetch`, so the public type is kept.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalFetch = globalThis.$fetch as any;

    // Use a wrapper to intercept responses
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.$fetch = ((url: string, options?: any) => {
      return originalFetch(url, {
        ...options,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
