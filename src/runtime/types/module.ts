// =============================================================================
// Module Configuration Types
// =============================================================================

/**
 * System setup module configuration options
 *
 * When enabled, a global middleware redirects to the setup page if no admin user exists.
 *
 * @example
 * ```typescript
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   ltExtensions: {
 *     auth: {
 *       systemSetup: {
 *         enabled: true,
 *         setupPath: '/auth/setup',
 *       },
 *     },
 *   },
 * });
 * ```
 */
export interface LtSystemSetupModuleOptions {
  /** Enable system setup flow (default: false) */
  enabled?: boolean;
  /** Path to the setup page (default: '/auth/setup') */
  setupPath?: string;
}

/**
 * Configurable cookie names used by the auth module.
 *
 * The two cookies are written and read across `useLtAuth()` and the
 * `auth-state.ts` helpers. Override them per project to avoid clashes
 * when multiple lenne.tech apps share a domain. Each key is independent;
 * unspecified keys keep their default value.
 *
 * @example
 * ```typescript
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   ltExtensions: {
 *     auth: {
 *       cookieNames: {
 *         state: 'my-app-auth-state',
 *         token: 'my-app-jwt',
 *       },
 *     },
 *   },
 * });
 * ```
 */
export interface LtAuthCookieNamesOptions {
  /** Name of the auth-state cookie (default: 'lt-auth-state') */
  state?: string;
  /** Name of the JWT-token cookie (default: 'lt-jwt-token') */
  token?: string;
}

export interface LtAuthModuleOptions {
  /** Auth API base path (default: '/iam' - must match nest-server betterAuth.basePath) */
  basePath?: string;
  /** API base URL (default: `''` — resolved at runtime from `NUXT_PUBLIC_API_URL` / `NUXT_API_URL`; no implicit `localhost` fallback, so an unset URL keeps API paths relative to the app origin) */
  baseURL?: string;
  /** Override the cookie names used for auth state and JWT storage */
  cookieNames?: LtAuthCookieNamesOptions;
  /** Enable the auth module (default: true) */
  enabled?: boolean;
  /** Enable admin plugin (default: true) */
  enableAdmin?: boolean;
  /** Enable passkey plugin (default: true) */
  enablePasskey?: boolean;
  /** Enable 2FA plugin (default: true) */
  enableTwoFactor?: boolean;
  /** Auth interceptor configuration */
  interceptor?: {
    /** Enable the auth interceptor plugin (default: true) */
    enabled?: boolean;
    /** Paths that should not trigger auto-logout on 401 */
    publicPaths?: string[];
  };
  /** Login page path for redirects (default: '/auth/login') */
  loginPath?: string;
  /** System setup configuration */
  systemSetup?: LtSystemSetupModuleOptions;
  /** 2FA redirect path (default: '/auth/2fa') */
  twoFactorRedirectPath?: string;
}

/**
 * TUS upload module configuration options
 */
export interface LtTusModuleOptions {
  /** Default chunk size in bytes (default: 5MB) */
  defaultChunkSize?: number;
  /** Default TUS upload endpoint (default: '/files/upload') */
  defaultEndpoint?: string;
}

/**
 * i18n module configuration options
 */
export interface LtI18nModuleOptions {
  /** Automatically merge locale files with @nuxtjs/i18n (default: true) */
  autoMerge?: boolean;
}

/**
 * Error translation module configuration options
 */
export interface LtErrorTranslationModuleOptions {
  /** Enable error translation feature (default: true) */
  enabled?: boolean;
  /** Default locale if not detected (default: 'de') */
  defaultLocale?: string;
}

/**
 * AI module configuration options (client side). Mirrors the nest-server AI
 * module's REST base path so the composables hit the right endpoints.
 */
export interface LtAiModuleOptions {
  /** AI API base path (default: '/ai' — must match the nest-server AI controller). */
  basePath?: string;
  /** Enable the AI composables/auto-imports (default: true). */
  enabled?: boolean;
}

/**
 * Main module options for @lenne.tech/nuxt-extensions
 */
export interface LtExtensionsModuleOptions {
  /** AI module configuration */
  ai?: LtAiModuleOptions;
  /** Auth module configuration */
  auth?: LtAuthModuleOptions;
  /** Error translation configuration */
  errorTranslation?: LtErrorTranslationModuleOptions;
  /** i18n configuration */
  i18n?: LtI18nModuleOptions;
  /** TUS upload module configuration */
  tus?: LtTusModuleOptions;
}

// =============================================================================
// Runtime Config Types
// =============================================================================

/**
 * Public runtime config added by this module
 */
export interface LtExtensionsPublicRuntimeConfig {
  ltExtensions: {
    ai: {
      basePath: string;
      enabled: boolean;
    };
    auth: {
      basePath: string;
      baseURL: string;
      cookieNames: {
        state: string;
        token: string;
      };
      enabled: boolean;
      enableAdmin: boolean;
      enablePasskey: boolean;
      enableTwoFactor: boolean;
      interceptor: {
        enabled: boolean;
        publicPaths: string[];
      };
      loginPath: string;
      systemSetup: {
        enabled: boolean;
        setupPath: string;
      };
      twoFactorRedirectPath: string;
    };
    errorTranslation: {
      enabled: boolean;
      defaultLocale: string;
    };
    tus: {
      defaultChunkSize: number;
      defaultEndpoint: string;
    };
  };
}

// Extend Nuxt's runtime config types
declare module 'nuxt/schema' {
  interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {}
}

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {}
}
