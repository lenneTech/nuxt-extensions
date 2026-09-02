import type { ComputedRef, Ref } from 'vue';

// =============================================================================
// User & Session Types
// =============================================================================

/**
 * User type for Better Auth session
 * Compatible with @lenne.tech/nest-server IAM module
 */
export interface LtUser {
  banExpires?: Date;
  banned?: boolean;
  banReason?: string;
  email: string;
  emailVerified?: boolean;
  id: string;
  image?: string;
  name?: string;
  /** Single-role shape (Better-Auth admin plugin). See also {@link LtUser.roles}. */
  role?: string;
  /**
   * Multi-role shape, and the canonical home for this fact: `@lenne.tech/nest-server`
   * registers `roles` as a core Better-Auth additionalField (`type: 'string[]'`,
   * `defaultValue: []`), so its users carry `roles: ['admin']` and usually NO
   * singular `role`.
   *
   * NOT a source of authorization truth: this lives in the non-httpOnly
   * `lt-auth-state` cookie and is therefore client-writable. It is kept
   * fail-closed on session merge (see `AUTHZ_KEYS` in `use-lt-auth.ts`) so a
   * backend downgrade is never masked by a stale value — that is a *staleness*
   * guarantee, not a security guarantee. `isAdmin` reads it for UI gating;
   * authorization is enforced server-side (`@Restricted(RoleEnum.ADMIN)`).
   */
  roles?: string[];
  twoFactorEnabled?: boolean;
}

/**
 * Authentication mode for Cookie/JWT dual-mode authentication
 * - 'cookie': Primary mode using HttpOnly session cookies (more secure)
 * - 'jwt': Fallback mode using JWT tokens in Authorization header
 */
export type LtAuthMode = 'cookie' | 'jwt';

/**
 * Stored auth state (persisted in cookie for SSR compatibility)
 */
export interface LtAuthState {
  authMode: LtAuthMode;
  user: LtUser | null;
}

// =============================================================================
// Auth Client Configuration
// =============================================================================

/**
 * Configuration options for the auth client factory
 * All options have sensible defaults for nest-server compatibility
 */
export interface LtAuthClientConfig {
  /** API base URL (default: `''` — empty means requests use the current app origin; production passes an explicit URL from `NUXT_PUBLIC_API_URL`. No implicit `localhost` fallback) */
  baseURL?: string;
  /** Auth API base path (default: '/iam' - must match nest-server betterAuth.basePath) */
  basePath?: string;
  /** Enable admin plugin (default: true) */
  enableAdmin?: boolean;
  /** Enable passkey plugin (default: true) */
  enablePasskey?: boolean;
  /** Enable 2FA plugin (default: true) */
  enableTwoFactor?: boolean;
  /** 2FA redirect path (default: '/auth/2fa') */
  twoFactorRedirectPath?: string;
  /** Additional Better Auth client plugins (e.g., organizationClient, magicLinkClient) */
  plugins?: unknown[];
}

/**
 * Normalized response type for Better-Auth operations
 * The Vue client returns complex union types - this provides a consistent interface
 */
export interface LtAuthResponse {
  data?: null | {
    redirect?: boolean;
    token?: null | string;
    url?: string;
    user?: LtUser;
  };
  error?: null | {
    code?: string;
    message?: string;
    status?: number;
  };
}

/**
 * Result of passkey authentication
 */
export interface LtPasskeyAuthResult {
  error?: string;
  session?: { token: string };
  success: boolean;
  user?: LtUser;
}

/**
 * Result of passkey registration
 */
export interface LtPasskeyRegisterResult {
  error?: string;
  passkey?: unknown;
  success: boolean;
}

// =============================================================================
// Auth Composable Return Type
// =============================================================================

/**
 * Return type for useLtAuth composable
 */
/**
 * Accepts any caller-supplied shape while refusing a stray plaintext credential field.
 *
 * WHY A GENERIC AND NOT `& Record<string, unknown>`
 *
 * TypeScript gives a `type` alias an implicit index signature and an `interface` deliberately none
 * (declaration merging could add anything later). So an intersection with `Record<string, unknown>`
 * REJECTS an interface-typed variable — and `app/interfaces/*.interface.ts` plus `Ref<Form>.value`
 * are the dominant shapes in this stack. That is how 1.15.0 broke consuming projects; the same
 * mistake in a different costume is not worth repeating.
 *
 * A generic parameter carries every shape and keeps the excess-property check, which matters:
 * widening these signatures to forward caller options also removed the compiler's objection to
 * `changePassword({ …, password: plaintext })` — a plaintext credential that would land in the
 * request body and from there in proxy logs, APM body capture and error reporters. Naming the
 * foreign credential keys `never` puts that objection back without closing the passthrough.
 *
 * @typeParam T - whatever the caller actually passes
 * @typeParam Own - the credential keys this method legitimately carries
 */
type NoStrayCredential<T, Own extends string> = Omit<{ currentPassword?: never; newPassword?: never; password?: never }, Own> & T;

export interface UseLtAuthReturn {
  // Auth state
  authMode: ComputedRef<LtAuthMode>;
  isAuthenticated: ComputedRef<boolean>;
  isJwtMode: ComputedRef<boolean>;
  isLoading: ComputedRef<boolean>;
  jwtToken: Ref<string | null>;
  user: ComputedRef<LtUser | null>;

  // User properties
  /**
   * Returns `true` when the current user has ANY of the given roles (union).
   * Same shape-tolerance and UX-gate-only caveats as {@link UseLtAuthReturn.hasRole}.
   *
   * @example
   * // <NuxtLink v-if="hasAnyRole('admin', 'editor')" to="/manage">Manage</NuxtLink>
   */
  hasAnyRole: (...roles: string[]) => boolean;
  /**
   * Returns `true` when the current user has `role` in EITHER supported shape:
   * `role === role` (Better-Auth admin plugin) or `roles` containing it
   * (`@lenne.tech/nest-server`; see {@link LtUser.roles}). A malformed non-array
   * `roles` degrades to `false` — never throws, never fail-opens via
   * `String.prototype.includes` substring matching. Reads `user` live, so call it
   * from a template or `computed` for reactivity.
   *
   * Prefer this over the raw `user.value?.roles?.includes(x)`, which is unguarded
   * against the string-`roles` substring-confusion this method closes.
   *
   * UX gate only — the `lt-auth-state` cache is client-writable; enforce rights
   * server-side.
   *
   * @example
   * // <button v-if="hasRole('editor')">Edit</button>
   * @see {@link LtUser.role}
   * @see {@link LtUser.roles}
   */
  hasRole: (role: string) => boolean;
  is2FAEnabled: ComputedRef<boolean>;
  /**
   * `true` when the current user is an admin in EITHER supported shape:
   * `role === 'admin'` (Better-Auth admin plugin) or `roles` containing `'admin'`
   * (`@lenne.tech/nest-server`; see {@link LtUser.roles}). Equivalent to
   * `hasRole('admin')`. A malformed non-array `roles` degrades to `false` (never
   * throws, never fail-opens). Independent of the `enableAdmin` module option,
   * which only toggles the Better-Auth admin *client plugin*.
   *
   * UX gate only: the `lt-auth-state` cache it reads is client-writable, so treat
   * this as "what to render", never as the gate itself. Enforce admin rights
   * server-side.
   *
   * @see {@link UseLtAuthReturn.hasRole}
   * @see {@link LtUser.roles}
   */
  isAdmin: ComputedRef<boolean>;

  // Feature detection
  features: ComputedRef<Record<string, boolean | number | string[]>>;
  fetchFeatures: () => Promise<Record<string, boolean | number | string[]>>;

  // Auth actions
  authenticateWithPasskey: () => Promise<LtPasskeyAuthResult>;
  /**
   * Change the password of the signed-in user. Both passwords are hashed client-side.
   *
   * Pass `revokeOtherSessions: true` after a suspected compromise — Better Auth reads it on the
   * `update-user` route and ends every other session. Until 1.16.0 the wrapper silently dropped
   * it, so a caller believed foreign sessions were ended when they were not.
   */
  changePassword: <T extends { currentPassword: string; newPassword: string }>(
    params: NoStrayCredential<T, 'currentPassword' | 'newPassword'>,
    options?: unknown,
  ) => Promise<unknown>;
  clearUser: () => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  refreshJwtToken: () => Promise<boolean>;
  registerPasskey: (name?: string) => Promise<LtPasskeyRegisterResult>;

  /**
   * Ask for a password-reset mail.
   *
   * `redirectTo` MUST be an absolute app URL — Better Auth resolves it against the API
   * origin, so a relative value lands on the API host, the route does not exist, and the
   * answer is a 403 with no mail sent. In an lt starter project `appUrl()` builds one; elsewhere
   * construct it yourself, e.g. `new URL('/auth/reset-password', config.public.siteUrl).toString()`.
   *
   * **SECURITY: never build `redirectTo` from `route.query`, a referrer, or a form field.** The
   * reset redirect carries a live single-use token, so an attacker-controlled value is account
   * takeover rather than phishing. What holds it back is `trustedOrigins` rejecting foreign
   * origins — a project that widens that removes the last barrier.
   *
   * From `@lenne.tech/nest-server` 11.38.0 the reset mail links straight to the app, so
   * `redirectTo` is no longer consulted on the default path. It stays load-bearing where a project
   * sets `betterAuth.emailVerification.passwordResetLink: false` to keep Better Auth's own link.
   *
   * Generic rather than a closed shape: this is a passthrough, and a closed shape would push
   * callers back to the raw client for any option the library has not enumerated yet — which is
   * how hand-rolled reset flows start.
   *
   * @example
   * const { requestPasswordReset } = useLtAuth();
   * await requestPasswordReset({
   *   email,
   *   redirectTo: new URL('/auth/reset-password', config.public.siteUrl).toString(),
   * });
   * @see {@link UseLtAuthReturn.resetPassword} — step two, with the token from the query string.
   */
  requestPasswordReset: <T extends { email: string }>(params: NoStrayCredential<T, never>, options?: unknown) => Promise<unknown>;

  /**
   * Set a new password from a reset token. The password is hashed client-side.
   *
   * **The minimum-length rule has to live in your form.** Better Auth checks `minPasswordLength`
   * against the value it RECEIVES, and this client hashes first — so the server sees 64 characters
   * whatever the user typed, on every version. That is a consequence of client-side hashing, not
   * of any particular server release. The lt starter's `reset-password.vue`, `register.vue` and
   * `setup.vue` declare `v.minLength(8)`; a project using this package without those forms has to
   * add it.
   *
   * Takes `{ newPassword, token }` and nothing else — better-auth's `/reset-password` body schema
   * carries no `redirectTo`, so the absolute-URL trap applies one step earlier, on
   * {@link UseLtAuthReturn.requestPasswordReset}.
   *
   * @example
   * const { resetPassword } = useLtAuth();
   * await resetPassword({ newPassword, token: route.query.token as string });
   */
  resetPassword: <T extends { newPassword: string; token: string }>(params: NoStrayCredential<T, 'newPassword'>, options?: unknown) => Promise<unknown>;
  setUser: (userData: LtUser | null, mode?: LtAuthMode) => void;
  signIn: {
    email: <T extends { email: string; password: string; rememberMe?: boolean }>(params: NoStrayCredential<T, 'password'>, options?: unknown) => Promise<unknown>;
    passkey?: (options?: unknown) => Promise<unknown>;
  };
  signOut: (options?: unknown) => Promise<unknown>;
  signUp: {
    email: <T extends { email: string; name: string; password: string }>(params: NoStrayCredential<T, 'password'>, options?: unknown) => Promise<unknown>;
  };
  switchToJwtMode: () => Promise<boolean>;
  validateSession: () => Promise<boolean>;

  // Better Auth client passthrough
  passkey?: unknown;
  twoFactor?: unknown;
}
