/**
 * Better-Auth Client Factory
 *
 * Creates a configured Better-Auth client with automatic password hashing
 * for compatibility with @lenne.tech/nest-server IAM module.
 *
 * SECURITY: Passwords are hashed with SHA256 client-side to prevent
 * plain text password transmission over the network.
 *
 * ---
 *
 * A HASHING WRAPPER REPLACES ONE FIELD — IT IS NEVER A WHITELIST.
 *
 * This is the invariant every wrapper below shares, and it has been broken twice, so it
 * lives here rather than beside one method that a refactor could delete.
 *
 * Each wrapper exists to substitute ONE field with its SHA256 digest. It must forward
 * everything else the caller passed, untouched:
 *
 *     { ...params, password: hashedPassword }   // correct
 *     { password: hashedPassword }              // WRONG — drops every other option
 *     { password: hashedPassword, ...params }   // WRONG — puts the PLAINTEXT back
 *
 * The first mistake is silent data loss: `changePassword` dropped `revokeOtherSessions`,
 * so callers who set it after a suspected compromise got a successful password change and
 * every other session left open. `twoFactor.enable` dropped `method` and `issuer`, so
 * `method: 'otp'` quietly enabled TOTP instead.
 *
 * The second is worse and looks almost identical: `params` still carries the raw value, so
 * a trailing spread overwrites the digest and the plaintext password goes on the wire.
 * Trailing-spread is the more common JS idiom, which is exactly why this warning is here.
 *
 * Both are pinned by tests: `test/auth-client-hashing.test.ts` asserts the real request
 * payload (it catches both mistakes), `test/auth-client-param-forwarding.test.ts` keeps the
 * source-level half so a whitelist rebuild is visible in review. If you add a wrapper that
 * hashes something, add it to both.
 */

import { passkeyClient } from '@better-auth/passkey/client';
import { adminClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/vue';

import { navigateTo } from '#imports';
import type { LtAuthClientConfig } from '../types';

import { ltSha256 } from '../utils/crypto';
import { createLtAuthFetch, isLocalDevApiProxy } from './auth-state';

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
  // When the API proxy is enabled (NUXT_PUBLIC_API_PROXY=true), use empty
  // baseURL and /api/iam path so the Vite dev proxy forwards requests to
  // the backend. This is REQUIRED for:
  // - Same-origin cookies (frontend localhost:3001 ↔ backend localhost:3000)
  // - WebAuthn/Passkey (origin must be consistent)
  // The proxy strips the /api/ prefix before forwarding to the backend.
  const useProxy = isLocalDevApiProxy();
  // Default baseURL: empty string means requests go to the current origin.
  // In production, useLtAuthClient() always passes an explicit baseURL from
  // runtimeConfig.public.apiUrl (set via NUXT_PUBLIC_API_URL env var).
  // This fallback only applies when createLtAuthClient() is called directly
  // without config — e.g., from the catch block of useLtAuthClient().
  // `import.meta.env` carries a loose index signature (Vite's own keys include
  // booleans like DEV/PROD/SSR), so reading VITE_API_URL off it yields a value
  // TypeScript cannot narrow to a string — an `||` chain over it widens to
  // `string | true`. Take the value only when it really is a string, so a
  // mis-set env var can never reach Better Auth's `baseURL` as a boolean.
  const envApiUrl = typeof import.meta.env?.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL : undefined;
  const defaultBaseURL = useProxy ? '' : envApiUrl || process.env.API_URL || '';
  const defaultBasePath = useProxy ? '/api/iam' : '/iam';

  const {
    baseURL = defaultBaseURL,
    basePath = defaultBasePath,
    twoFactorRedirectPath = '/auth/2fa',
    enableAdmin = true,
    enableTwoFactor = true,
    enablePasskey = true,
    plugins: externalPlugins = [],
  } = config;

  // Build plugins array based on configuration
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
  const authFetch = createLtAuthFetch(basePath.replace('/api', ''));

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

  // Return extended client with password hashing.
  //
  // EVERY method below is listed by name on purpose, and that is the whole mechanism —
  // there is no fallback that catches the rest. This object used to begin with
  // `...baseClient` under a comment claiming it spread "all base client properties and
  // methods". It spread nothing. Better-Auth builds its client through
  // `createDynamicPathProxy`: a `new Proxy(function () {}, { apply, get })` over an empty
  // function, with no `ownKeys` trap. Every method is fabricated inside `get`, so the
  // proxy owns no enumerable properties and a spread copies none of them —
  // `Object.keys({ ...baseClient })` is `[]`.
  //
  // What made that dangerous rather than merely useless is that TypeScript spreads the
  // DECLARED members regardless. `LtAuthClient` is `ReturnType<typeof createLtAuthClient>`,
  // so some fourteen methods were promised by the type, offered by autocomplete and waved
  // through by the compiler, while being `undefined` at runtime. Three projects
  // independently met that crash and rebuilt the call against raw `$fetch`; each looked
  // like a project going its own way, and each was the only thing that worked.
  //
  // To expose a Better-Auth method, add a line here. Nothing else will.
  return {
    useSession: baseClient.useSession,
    passkey: (baseClient as any).passkey,
    /**
     * Better-Auth admin plugin, passed through UNWRAPPED — and therefore UNHASHED.
     *
     * `admin.createUser` (`password`) and `admin.setUserPassword` (`newPassword`) carry
     * credentials that every other method in this file hashes. These two do not.
     *
     * Why that is deliberate rather than an oversight: `@lenne.tech/nest-server` does not
     * register better-auth's `admin()` plugin and offers no option to — the two routes do
     * not exist server-side, so a call 404s today. Hashing here would build a client
     * expectation the server does not answer, and if the plugin were later enabled without
     * normalising those routes, this wrapper would CREATE the credential-store desync it
     * was meant to prevent.
     *
     * What that costs, stated plainly: `auth.enableAdmin` defaults to `true`, so the admin
     * CLIENT plugin is registered in every consuming project. The trap is armed and waiting
     * for a server that answers. Enabling `admin()` server-side is therefore a LOCKSTEP
     * change — the routes join nest-server's password-normalisation table and these two
     * methods get `ltSha256` wrappers here, in one release. Half of it produces accounts
     * whose password nobody can log in with, and nothing warns.
     */
    admin: (baseClient as any).admin,
    $Infer: baseClient.$Infer,
    $fetch: baseClient.$fetch,
    $store: baseClient.$store,
    /**
     * Read the current session (`GET /get-session`).
     *
     * Carries no credential, so it is a bare passthrough.
     */
    getSession: baseClient.getSession,

    /**
     * Send (or re-send) an email-verification mail (`POST /send-verification-email`).
     *
     * A BARE passthrough, and it must stay one. `callbackURL` is the value Better Auth
     * puts into the mail, and it MUST reach the server exactly as the caller wrote it:
     * Better Auth resolves a relative value against the API origin, so `/auth/verify-email`
     * lands on `api.<host>/auth/verify-email`, where the route does not exist. The mail
     * still goes out, and the user follows a link to a 404 — the same silent failure
     * `redirectTo` produces on the reset path.
     *
     * So do not normalise it here, do not supply a default, and do not resolve it against
     * the client's `baseURL`. A library that quietly repairs the value hides the mistake
     * until the next caller makes it somewhere we cannot see. Fixing it belongs to the
     * caller (the lt starters use `appUrl()`, which throws rather than return something
     * relative).
     */
    sendVerificationEmail: baseClient.sendVerificationEmail,

    /**
     * Verify an email address from a token (`POST /verify-email`).
     *
     * Carries no credential, so it is a bare passthrough. Note what the endpoint does with
     * the query, because it decides the shape of the answer: WITH a `callbackURL` it
     * answers `302` to that URL (carrying neither token nor status), WITHOUT one it answers
     * `{ status: true }` as JSON. Callers that want the result rather than a redirect must
     * therefore omit `callbackURL` here — which is not the same parameter as the one
     * `sendVerificationEmail` puts into the mail, and confusing the two is easy.
     */
    verifyEmail: baseClient.verifyEmail,

    // Deliberately a bare passthrough: it takes an email address, never a password, so
    // there is nothing to hash — and passing it through untouched is what keeps
    // `redirectTo` intact (see the note above `resetPassword`).
    requestPasswordReset: baseClient.requestPasswordReset,

    /**
     * Change password for an authenticated user (both passwords are hashed).
     *
     * `revokeOtherSessions` is the option that made the whitelist bug matter — see the
     * file header.
     */
    changePassword: async <T extends { currentPassword: string; newPassword: string }>(params: T, options?: any) => {
      const [hashedCurrent, hashedNew] = await Promise.all([ltSha256(params.currentPassword), ltSha256(params.newPassword)]);
      if (!baseClient.changePassword) {
        // Not defensive noise: `?.` here would resolve to `undefined`, the caller would find
        // no `error` on it and report success, and the password would be unchanged.
        throw new Error('[lt-auth] changePassword is unavailable on the Better-Auth client — the password was NOT changed.');
      }
      return baseClient.changePassword({ ...params, currentPassword: hashedCurrent, newPassword: hashedNew }, options);
    },

    /**
     * Reset password with token (new password is hashed before sending).
     *
     * Spread first, then overwrite the one field this wrapper exists for — see the file
     * header for why the order is not a style question.
     */
    resetPassword: async <T extends { newPassword: string; token: string }>(params: T, options?: any) => {
      const hashedPassword = await ltSha256(params.newPassword);
      if (!baseClient.resetPassword) {
        // A silent `undefined` here is the worst case in the whole file: the user believes a
        // credential rotation happened, and it did not.
        throw new Error('[lt-auth] resetPassword is unavailable on the Better-Auth client — the password was NOT changed.');
      }
      return baseClient.resetPassword({ ...params, newPassword: hashedPassword }, options);
    },

    // Override signIn to hash password (keep passkey method from plugin)
    signIn: {
      ...baseClient.signIn,
      /**
       * Sign in with email and password (password is hashed before sending)
       */
      email: async <T extends { email: string; password: string; rememberMe?: boolean }>(params: T, options?: any) => {
        const hashedPassword = await ltSha256(params.password);
        return baseClient.signIn.email({ ...params, password: hashedPassword }, options);
      },
      /**
       * Sign in with passkey (pass through to base client - provided by passkeyClient plugin)
       * @see https://www.better-auth.com/docs/plugins/passkey
       */
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
      email: async <T extends { email: string; name: string; password: string }>(params: T, options?: any) => {
        const hashedPassword = await ltSha256(params.password);
        return baseClient.signUp.email({ ...params, password: hashedPassword }, options);
      },
    },

    // Override twoFactor to hash passwords (provided by twoFactorClient plugin)
    twoFactor: {
      ...(baseClient as any).twoFactor,
      /**
       * Disable 2FA (password is hashed before sending)
       */
      disable: async <T extends { password: string }>(params: T, options?: any) => {
        const hashedPassword = await ltSha256(params.password);
        // Spread, never a whitelist — see the note above `resetPassword`.
        return (baseClient as any).twoFactor.disable({ ...params, password: hashedPassword }, options);
      },
      /**
       * Enable 2FA (password is hashed before sending)
       */
      enable: async <T extends { password: string }>(params: T, options?: any) => {
        const hashedPassword = await ltSha256(params.password);
        // Spread, never a whitelist — see the note above `resetPassword`.
        return (baseClient as any).twoFactor.enable({ ...params, password: hashedPassword }, options);
      },
      /**
       * Generate backup codes (password is hashed before sending)
       */
      generateBackupCodes: async <T extends { password: string }>(params: T, options?: any) => {
        const hashedPassword = await ltSha256(params.password);
        // Spread, never a whitelist — see the note above `resetPassword`.
        return (baseClient as any).twoFactor.generateBackupCodes({ ...params, password: hashedPassword }, options);
      },
      /**
       * Verify TOTP code (pass through to base client)
       */
      verifyTotp: (baseClient as any).twoFactor.verifyTotp,
      /**
       * Verify backup code (pass through to base client)
       */
      verifyBackupCode: (baseClient as any).twoFactor.verifyBackupCode,
    },
  };
}

// Type export for the auth client
export type LtAuthClient = ReturnType<typeof createLtAuthClient>;
