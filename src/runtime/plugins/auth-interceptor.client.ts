/**
 * Auth Interceptor Plugin
 *
 * This plugin intercepts all API responses and handles session expiration.
 * When a 401 (Unauthorized) response is received, it automatically:
 * 1. Clears the user session state
 * 2. Redirects to the login page
 *
 * Note: This is a client-only plugin (.client.ts) since auth state
 * management only makes sense in the browser context.
 */

import type { NuxtApp } from "#app";

import { useLtAuth } from "../composables/auth/use-lt-auth";

export default (nuxtApp: NuxtApp): void => {
  // Only run on client side
  if (import.meta.server) return;

  const { clearUser, isAuthenticated } = useLtAuth();

  // Get configuration from runtime config
  const runtimeConfig = nuxtApp.$config?.public?.ltExtensions?.auth || {};
  const loginPath = runtimeConfig.loginPath || "/auth/login";
  const configuredPublicPaths = runtimeConfig.interceptor?.publicPaths || [];

  // Track if we're already handling a 401 to prevent multiple redirects
  let isHandling401 = false;

  // Default paths that should not trigger auto-logout on 401
  // (public auth endpoints where 401 is expected)
  const defaultPublicPaths = [
    "/auth/login",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/2fa",
  ];
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
      "/sign-in",
      "/sign-up",
      "/sign-out",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/session",
      "/token",
      // Passkey endpoints - handled by authFetch with JWT fallback
      "/passkey/",
      "/list-user-passkeys",
      "/generate-register-options",
      "/verify-registration",
      "/generate-authenticate-options",
      "/verify-authentication",
      // Two-factor endpoints
      "/two-factor/",
    ];
    return authEndpoints.some((endpoint) => url.includes(endpoint));
  }

  /**
   * Handle 401 Unauthorized responses
   * Clears user state and redirects to login page
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
      if (isAuthenticated.value) {
        console.debug("[LtAuth Interceptor] Session expired, logging out...");

        // Clear user state
        clearUser();

        // Redirect to login page with return URL
        const router = nuxtApp.$router as
          | { currentRoute?: { value?: { fullPath?: string } } }
          | undefined;
        const currentPath = router?.currentRoute?.value?.fullPath;
        const redirectQuery =
          currentPath && currentPath !== loginPath
            ? `?redirect=${encodeURIComponent(currentPath)}`
            : "";

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

  // Override the default $fetch to add response error handling
  const originalFetch = globalThis.$fetch;

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
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      handleUnauthorized(url);
    }

    return response;
  };

  // Provide a manual method to trigger logout on 401
  nuxtApp.provide("ltHandleUnauthorized", handleUnauthorized);
};
