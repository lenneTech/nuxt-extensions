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

import { createLtAuthClient, type LtAuthClient } from "../lib/auth-client";

// Singleton instance
let authClientInstance: LtAuthClient | null = null;

/**
 * Returns the Better-Auth client singleton
 *
 * The client is created once and reused across all calls.
 * Configuration is read from RuntimeConfig on first call.
 */
export function useLtAuthClient(): LtAuthClient {
  if (!authClientInstance) {
    // Get config from RuntimeConfig if available
    try {
      const nuxtApp = useNuxtApp();
      const config = nuxtApp.$config?.public?.ltExtensions?.auth || {};

      authClientInstance = createLtAuthClient({
        baseURL: config.baseURL,
        basePath: config.basePath,
        twoFactorRedirectPath: config.twoFactorRedirectPath,
        enableAdmin: config.enableAdmin,
        enableTwoFactor: config.enableTwoFactor,
        enablePasskey: config.enablePasskey,
      });
    } catch {
      // Fallback: create with defaults if RuntimeConfig not available
      authClientInstance = createLtAuthClient();
    }
  }

  return authClientInstance;
}

// Also export as ltAuthClient for direct import convenience
export const ltAuthClient = {
  get instance(): LtAuthClient {
    return useLtAuthClient();
  },
};
