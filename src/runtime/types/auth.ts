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
  changePassword: (params: { currentPassword: string; newPassword: string }, options?: unknown) => Promise<unknown>;
  clearUser: () => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  refreshJwtToken: () => Promise<boolean>;
  registerPasskey: (name?: string) => Promise<LtPasskeyRegisterResult>;
  setUser: (userData: LtUser | null, mode?: LtAuthMode) => void;
  signIn: {
    email: (params: { email: string; password: string; rememberMe?: boolean }, options?: unknown) => Promise<unknown>;
    passkey?: (options?: unknown) => Promise<unknown>;
  };
  signOut: (options?: unknown) => Promise<unknown>;
  signUp: {
    email: (params: { email: string; name: string; password: string } & Record<string, unknown>, options?: unknown) => Promise<unknown>;
  };
  switchToJwtMode: () => Promise<boolean>;
  validateSession: () => Promise<boolean>;

  // Better Auth client passthrough
  passkey?: unknown;
  twoFactor?: unknown;
}
