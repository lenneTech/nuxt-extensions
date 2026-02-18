// =============================================================================
// Module Configuration Types
// =============================================================================

/**
 * Auth module configuration options
 */
export interface LtSystemSetupModuleOptions {
  /** Enable system setup flow (default: false) */
  enabled?: boolean;
  /** Path to the setup page (default: '/auth/setup') */
  setupPath?: string;
}

export interface LtAuthModuleOptions {
  /** Auth API base path (default: '/iam' - must match nest-server betterAuth.basePath) */
  basePath?: string;
  /** API base URL (default: from env or http://localhost:3000) */
  baseURL?: string;
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
 * Main module options for @lenne.tech/nuxt-extensions
 */
export interface LtExtensionsModuleOptions {
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
    auth: {
      basePath: string;
      baseURL: string;
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
declare module "nuxt/schema" {
  interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {}
}

declare module "@nuxt/schema" {
  interface PublicRuntimeConfig extends LtExtensionsPublicRuntimeConfig {}
}
