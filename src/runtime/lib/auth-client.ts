/**
 * Better-Auth Client Factory
 *
 * Creates a configured Better-Auth client with automatic password hashing
 * for compatibility with @lenne.tech/nest-server IAM module.
 *
 * SECURITY: Passwords are hashed with SHA256 client-side to prevent
 * plain text password transmission over the network.
 */

import { passkeyClient } from "@better-auth/passkey/client";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/vue";

import { navigateTo } from "#imports";
import type { LtAuthClientConfig } from "../types";

import { ltSha256 } from "../utils/crypto";
import { createLtAuthFetch, isLtDevMode } from "./auth-state";

// =============================================================================
// Plugin Registry & Singleton Management
// =============================================================================

/**
 * Internal plugin registry for external Better Auth plugins.
 *
 * Plugins cannot be passed through RuntimeConfig (not JSON-serializable),
 * so users register them before the auth client is created.
 */
let _ltAuthPluginRegistry: unknown[] = [];

/**
 * Flag to track if plugins were registered after client creation.
 * When true, the client needs to be recreated on next access.
 */
let _pluginsChangedAfterCreation = false;

/**
 * Singleton instance of the auth client.
 * Managed here to allow registerLtAuthPlugins to reset it directly.
 * Type is inferred at runtime to avoid circular reference issues.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _authClientSingleton: any = null;

/**
 * Stored config for recreating the client when plugins change.
 */
let _lastClientConfig: LtAuthClientConfig | null = null;

/**
 * Register additional Better Auth plugins before auth client initialization.
 *
 * Call this in a Nuxt plugin (client-side) or in app.vue setup before
 * the auth client is used.
 *
 * If the auth client was already created, it will be automatically recreated
 * with the new plugins on next access.
 *
 * @example
 * ```typescript
 * // plugins/auth-plugins.client.ts
 * import { registerLtAuthPlugins } from '@lenne.tech/nuxt-extensions/lib';
 * import { organizationClient, magicLinkClient } from 'better-auth/client/plugins';
 *
 * export default defineNuxtPlugin(() => {
 *   registerLtAuthPlugins([
 *     organizationClient(),
 *     magicLinkClient(),
 *   ]);
 * });
 * ```
 */
export function registerLtAuthPlugins(plugins: unknown[]): void {
  _ltAuthPluginRegistry = [..._ltAuthPluginRegistry, ...plugins];

  // If auth client was already created, mark for recreation
  if (_authClientSingleton) {
    _pluginsChangedAfterCreation = true;
  }
}

/**
 * Get the current plugin registry.
 * Used internally by createLtAuthClient.
 */
export function getLtAuthPluginRegistry(): unknown[] {
  return _ltAuthPluginRegistry;
}

/**
 * Clear the plugin registry.
 * Useful for testing or resetting state.
 */
export function clearLtAuthPluginRegistry(): void {
  _ltAuthPluginRegistry = [];
}

/**
 * Reset the auth client singleton.
 * The client will be recreated on next access.
 */
export function resetLtAuthClientSingleton(): void {
  _authClientSingleton = null;
  _pluginsChangedAfterCreation = false;
}

/**
 * Get or create the auth client singleton.
 * This is the main entry point for accessing the auth client.
 * If plugins were registered after initial creation, the client is recreated.
 */
export function getOrCreateLtAuthClient(config?: LtAuthClientConfig): LtAuthClient {
  // Store config for potential recreation
  if (config) {
    _lastClientConfig = config;
  }

  // Recreate if plugins changed after creation
  if (_pluginsChangedAfterCreation && _authClientSingleton) {
    _authClientSingleton = null;
    _pluginsChangedAfterCreation = false;
  }

  // Create if not exists
  if (!_authClientSingleton) {
    _authClientSingleton = createLtAuthClient(_lastClientConfig || {});
  }

  return _authClientSingleton;
}

// =============================================================================
// Auth Client Factory
// =============================================================================

/**
 * Creates a configured Better-Auth client with password hashing
 *
 * This factory function allows creating auth clients with custom configuration,
 * making it reusable across different projects.
 *
 * @example
 * ```typescript
 * // Default configuration (works with nest-server defaults)
 * const authClient = createLtAuthClient();
 *
 * // Custom configuration
 * const authClient = createLtAuthClient({
 *   baseURL: 'https://api.example.com',
 *   basePath: '/auth',
 *   twoFactorRedirectPath: '/login/2fa',
 * });
 * ```
 *
 * SECURITY: Passwords are hashed with SHA256 client-side to prevent
 * plain text password transmission over the network.
 */
export function createLtAuthClient(config: LtAuthClientConfig = {}) {
  // In development, use empty baseURL and /api/iam path to leverage Nuxt server proxy
  // This is REQUIRED for WebAuthn/Passkey to work correctly because:
  // - Frontend runs on localhost:3002, API on localhost:3000
  // - WebAuthn validates the origin, which must be consistent
  // - The Nuxt server proxy ensures requests come from the frontend origin
  // Note: We use isLtDevMode() for runtime detection instead of import.meta.dev
  // which is evaluated at build time and doesn't work for pre-built modules.
  const isDev = isLtDevMode();
  const defaultBaseURL = isDev
    ? ""
    : import.meta.env?.VITE_API_URL || process.env.API_URL || "http://localhost:3000";
  const defaultBasePath = isDev ? "/api/iam" : "/iam";

  const {
    baseURL = defaultBaseURL,
    basePath = defaultBasePath,
    twoFactorRedirectPath = "/auth/2fa",
    enableAdmin = true,
    enableTwoFactor = true,
    enablePasskey = true,
    plugins: externalPlugins = [],
  } = config;

  // Build plugins array based on configuration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugins: any[] = [];

  if (enableAdmin) {
    plugins.push(adminClient());
  }

  if (enableTwoFactor) {
    plugins.push(
      twoFactorClient({
        onTwoFactorRedirect() {
          navigateTo(twoFactorRedirectPath);
        },
      }),
    );
  }

  if (enablePasskey) {
    plugins.push(passkeyClient());
  }

  // Add external plugins from config parameter
  plugins.push(...externalPlugins);

  // Add plugins from global registry (registered via registerLtAuthPlugins)
  plugins.push(..._ltAuthPluginRegistry);

  // Create custom auth fetch that handles JWT fallback
  const authFetch = createLtAuthFetch(basePath.replace("/api", ""));

  // Create base client with configuration
  // Uses authFetch for automatic Cookie/JWT dual-mode authentication
  const baseClient = createAuthClient({
    basePath,
    baseURL,
    fetchOptions: {
      customFetchImpl: authFetch,
    },
    plugins,
  });

  // Return extended client with password hashing
  return {
    // Spread all base client properties and methods
    ...baseClient,

    // Explicitly pass through methods not captured by spread operator
    useSession: baseClient.useSession,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    passkey: (baseClient as any).passkey,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    admin: (baseClient as any).admin,
    $Infer: baseClient.$Infer,
    $fetch: baseClient.$fetch,
    $store: baseClient.$store,

    /**
     * Change password for an authenticated user (both passwords are hashed)
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    changePassword: async (
      params: { currentPassword: string; newPassword: string },
      options?: any,
    ) => {
      const [hashedCurrent, hashedNew] = await Promise.all([
        ltSha256(params.currentPassword),
        ltSha256(params.newPassword),
      ]);
      return baseClient.changePassword?.(
        { currentPassword: hashedCurrent, newPassword: hashedNew },
        options,
      );
    },

    /**
     * Reset password with token (new password is hashed before sending)
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resetPassword: async (params: { newPassword: string; token: string }, options?: any) => {
      const hashedPassword = await ltSha256(params.newPassword);
      return baseClient.resetPassword?.(
        { newPassword: hashedPassword, token: params.token },
        options,
      );
    },

    // Override signIn to hash password (keep passkey method from plugin)
    signIn: {
      ...baseClient.signIn,
      /**
       * Sign in with email and password (password is hashed before sending)
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      email: async (
        params: { email: string; password: string; rememberMe?: boolean },
        options?: any,
      ) => {
        const hashedPassword = await ltSha256(params.password);
        return baseClient.signIn.email({ ...params, password: hashedPassword }, options);
      },
      /**
       * Sign in with passkey (pass through to base client - provided by passkeyClient plugin)
       * @see https://www.better-auth.com/docs/plugins/passkey
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      passkey: (baseClient.signIn as any).passkey,
    },

    // Explicitly pass through signOut (not captured by spread operator)
    signOut: baseClient.signOut,

    // Override signUp to hash password
    signUp: {
      ...baseClient.signUp,
      /**
       * Sign up with email and password (password is hashed before sending)
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      email: async (
        params: { email: string; name: string; password: string } & Record<string, unknown>,
        options?: any,
      ) => {
        const hashedPassword = await ltSha256(params.password);
        return baseClient.signUp.email({ ...params, password: hashedPassword }, options);
      },
    },

    // Override twoFactor to hash passwords (provided by twoFactorClient plugin)
    twoFactor: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(baseClient as any).twoFactor,
      /**
       * Disable 2FA (password is hashed before sending)
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      disable: async (params: { password: string }, options?: any) => {
        const hashedPassword = await ltSha256(params.password);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (baseClient as any).twoFactor.disable({ password: hashedPassword }, options);
      },
      /**
       * Enable 2FA (password is hashed before sending)
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enable: async (params: { password: string }, options?: any) => {
        const hashedPassword = await ltSha256(params.password);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (baseClient as any).twoFactor.enable({ password: hashedPassword }, options);
      },
      /**
       * Generate backup codes (password is hashed before sending)
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generateBackupCodes: async (params: { password: string }, options?: any) => {
        const hashedPassword = await ltSha256(params.password);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (baseClient as any).twoFactor.generateBackupCodes(
          { password: hashedPassword },
          options,
        );
      },
      /**
       * Verify TOTP code (pass through to base client)
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      verifyTotp: (baseClient as any).twoFactor.verifyTotp,
      /**
       * Verify backup code (pass through to base client)
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      verifyBackupCode: (baseClient as any).twoFactor.verifyBackupCode,
    },
  };
}

// Type export for the auth client
export type LtAuthClient = ReturnType<typeof createLtAuthClient>;
