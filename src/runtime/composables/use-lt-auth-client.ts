/**
 * Auth Client Composable
 *
 * Provides access to the Better-Auth client singleton.
 * Use this when you need direct access to the auth client API
 * (e.g., for 2FA management, passkey operations).
 *
 * @example
 * ```typescript
 * const authClient = useLtAuthClient();
 *
 * // Access 2FA methods
 * await authClient.twoFactor.enable({ password: 'test' });
 *
 * // Access passkey methods
 * await authClient.passkey.listUserPasskeys();
 * ```
 */

import { useRuntimeConfig } from "#imports";

import {
  getOrCreateLtAuthClient,
  resetLtAuthClientSingleton,
  type LtAuthClient,
} from "../lib/auth-client";
import { isLocalDevApiProxy } from "../lib/auth-state";

/**
 * Reset the auth client singleton (useful for testing or config changes)
 */
export function resetLtAuthClient(): void {
  resetLtAuthClientSingleton();
}

/**
 * Returns the Better-Auth client singleton
 *
 * The client is created once and reused across all calls.
 * Configuration is read from RuntimeConfig on first call.
 *
 * ## baseURL resolution
 * Prefers `runtimeConfig.public.apiUrl` (set at runtime via `NUXT_PUBLIC_API_URL`)
 * over `ltExtensions.auth.baseURL` (baked at build time from nuxt.config.ts).
 * This ensures Docker containers can be reconfigured without rebuilding.
 * Trailing slashes are automatically stripped.
 *
 * ## Proxy mode (`NUXT_PUBLIC_API_PROXY=true`)
 * When enabled, `baseURL` is set to `""` (same-origin) and `basePath` is
 * prefixed with `/api` (e.g., `/api/iam`). The Vite dev proxy forwards
 * these requests to the backend. This is required for same-origin cookies
 * and WebAuthn/Passkey to work in local development.
 */
export function useLtAuthClient(): LtAuthClient {
  // Get config from RuntimeConfig if available
  try {
    const runtimeConfig = useRuntimeConfig();
    const config = runtimeConfig.public?.ltExtensions?.auth || {};
    const publicApiUrl = String(runtimeConfig.public?.apiUrl || "");

    // When proxy is enabled, prefix basePath with /api for Vite dev proxy
    const useProxy = isLocalDevApiProxy();
    let basePath = config.basePath || "/iam";

    // Prefix with /api if proxy is active and not already prefixed
    if (useProxy && basePath && !basePath.startsWith("/api")) {
      basePath = `/api${basePath}`;
    }

    // Resolve baseURL: prefer runtimeConfig.public.apiUrl (properly overridden
    // at runtime by NUXT_PUBLIC_API_URL) over ltExtensions.auth.baseURL (which
    // is baked at build time and may contain localhost fallbacks).
    const authBaseURL = (publicApiUrl || config.baseURL || "").replace(/\/+$/, "");

    return getOrCreateLtAuthClient({
      baseURL: useProxy ? "" : authBaseURL,
      basePath,
      twoFactorRedirectPath: config.twoFactorRedirectPath,
      enableAdmin: config.enableAdmin,
      enableTwoFactor: config.enableTwoFactor,
      enablePasskey: config.enablePasskey,
    });
  } catch {
    // Fallback: create with defaults if RuntimeConfig not available
    return getOrCreateLtAuthClient();
  }
}

// Also export as ltAuthClient for direct import convenience
export const ltAuthClient = {
  get instance(): LtAuthClient {
    return useLtAuthClient();
  },
};
