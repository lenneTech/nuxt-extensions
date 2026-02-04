import type { ComputedRef, Ref } from "vue";

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
  role?: string;
  twoFactorEnabled?: boolean;
}

/**
 * Authentication mode for Cookie/JWT dual-mode authentication
 * - 'cookie': Primary mode using HttpOnly session cookies (more secure)
 * - 'jwt': Fallback mode using JWT tokens in Authorization header
 */
export type LtAuthMode = "cookie" | "jwt";

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
  /** API base URL (default: from env or http://localhost:3000) */
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
  is2FAEnabled: ComputedRef<boolean>;
  isAdmin: ComputedRef<boolean>;

  // Feature detection
  features: ComputedRef<Record<string, boolean | number | string[]>>;
  fetchFeatures: () => Promise<Record<string, boolean | number | string[]>>;

  // Auth actions
  authenticateWithPasskey: () => Promise<LtPasskeyAuthResult>;
  changePassword: (
    params: { currentPassword: string; newPassword: string },
    options?: unknown,
  ) => Promise<unknown>;
  clearUser: () => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  refreshJwtToken: () => Promise<boolean>;
  registerPasskey: (name?: string) => Promise<LtPasskeyRegisterResult>;
  setUser: (userData: LtUser | null, mode?: LtAuthMode) => void;
  signIn: {
    email: (
      params: { email: string; password: string; rememberMe?: boolean },
      options?: unknown,
    ) => Promise<unknown>;
    passkey?: (options?: unknown) => Promise<unknown>;
  };
  signOut: (options?: unknown) => Promise<unknown>;
  signUp: {
    email: (
      params: { email: string; name: string; password: string } & Record<string, unknown>,
      options?: unknown,
    ) => Promise<unknown>;
  };
  switchToJwtMode: () => Promise<boolean>;
  validateSession: () => Promise<boolean>;

  // Better Auth client passthrough
  passkey?: unknown;
  twoFactor?: unknown;
}
