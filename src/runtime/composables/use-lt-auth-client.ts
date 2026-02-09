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

import { useNuxtApp } from "#imports";

import {
  getOrCreateLtAuthClient,
  resetLtAuthClientSingleton,
  type LtAuthClient,
} from "../lib/auth-client";
import { isLtDevMode } from "../lib/auth-state";

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
 * IMPORTANT: In dev mode, the basePath is automatically prefixed with '/api'
 * to leverage Nuxt's server proxy. This is required for WebAuthn/Passkey
 * to work correctly (same-origin policy).
 */
export function useLtAuthClient(): LtAuthClient {
  // Get config from RuntimeConfig if available
  try {
    const nuxtApp = useNuxtApp();
    const config = nuxtApp.$config?.public?.ltExtensions?.auth || {};

    // In dev mode, ensure basePath starts with /api for Nuxt server proxy
    // This is required for WebAuthn/Passkey to work (same-origin policy)
    const isDev = isLtDevMode();
    let basePath = config.basePath || "/iam";

    // In dev mode, prefix with /api if not already prefixed
    if (isDev && basePath && !basePath.startsWith("/api")) {
      basePath = `/api${basePath}`;
    }

    return getOrCreateLtAuthClient({
      baseURL: isDev ? "" : config.baseURL,
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
