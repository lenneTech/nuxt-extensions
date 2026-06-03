/**
 * @lenne.tech/nuxt-extensions
 *
 * Reusable Nuxt 4 composables, components, and Better-Auth integration
 * for lenne.tech projects.
 */

import { addComponent, addImports, addPlugin, addRouteMiddleware, createResolver, defineNuxtModule } from '@nuxt/kit';

import type { LtExtensionsModuleOptions } from './runtime/types';

// Module meta
export const name = '@lenne.tech/nuxt-extensions';
export const version = '1.5.2';
export const configKey = 'ltExtensions';

// Default cookie names — re-exported from auth-state so consumers can read
// them as a fallback before runtime config is available.
export const DEFAULT_LT_AUTH_STATE_COOKIE = 'lt-auth-state';
export const DEFAULT_LT_JWT_TOKEN_COOKIE = 'lt-jwt-token';

// Default options
const defaultOptions: LtExtensionsModuleOptions = {
  ai: {
    basePath: '/ai',
    enabled: true,
  },
  auth: {
    basePath: '/iam',
    baseURL: '',
    cookieNames: {
      state: DEFAULT_LT_AUTH_STATE_COOKIE,
      token: DEFAULT_LT_JWT_TOKEN_COOKIE,
    },
    enabled: true,
    enableAdmin: true,
    enablePasskey: true,
    enableTwoFactor: true,
    interceptor: {
      enabled: true,
      publicPaths: [],
    },
    loginPath: '/auth/login',
    systemSetup: {
      enabled: false,
      setupPath: '/auth/setup',
    },
    twoFactorRedirectPath: '/auth/2fa',
  },
  errorTranslation: {
    enabled: true,
    defaultLocale: 'de',
  },
  i18n: {
    autoMerge: true,
  },
  tus: {
    defaultChunkSize: 5 * 1024 * 1024, // 5MB
    defaultEndpoint: '/files/upload',
  },
};

export default defineNuxtModule<LtExtensionsModuleOptions>({
  meta: {
    configKey,
    name,
    version,
  },
  defaults: defaultOptions,
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    // Merge options with defaults
    const resolvedOptions = {
      ai: { ...defaultOptions.ai, ...options.ai },
      auth: {
        ...defaultOptions.auth,
        ...options.auth,
        cookieNames: { ...defaultOptions.auth!.cookieNames, ...options.auth?.cookieNames },
        systemSetup: { ...defaultOptions.auth!.systemSetup, ...options.auth?.systemSetup },
      },
      errorTranslation: { ...defaultOptions.errorTranslation, ...options.errorTranslation },
      i18n: { ...defaultOptions.i18n, ...options.i18n },
      tus: { ...defaultOptions.tus, ...options.tus },
    };

    // Declare runtimeConfig keys with empty defaults so Nuxt can override them at runtime.
    //
    // WHY no process.env reads here?
    // This setup() runs at BUILD time. In containerized deployments (Docker, K8s),
    // env vars are injected at RUNTIME and may differ from the build environment.
    // Nuxt's built-in mechanism handles this correctly:
    //
    //   NUXT_API_URL          → runtimeConfig.apiUrl        (server only, at runtime)
    //   NUXT_PUBLIC_API_URL   → runtimeConfig.public.apiUrl (client + server, at runtime)
    //
    // The actual URL resolution happens in buildLtApiUrl() which reads from
    // useRuntimeConfig() — always returning the runtime-overridden values.
    //
    // SECURITY: NUXT_API_URL is never promoted to public config. It may contain
    // internal network addresses (e.g., http://api.svc.cluster.local) that must
    // not be exposed in the client bundle.
    const rc = nuxt.options.runtimeConfig;
    if (!(rc as any).apiUrl) {
      (rc as any).apiUrl = '';
    }
    if (!(rc.public as any).apiUrl) {
      (rc.public as any).apiUrl = '';
    }

    // Declare the public `cookiePrefix` key so `NUXT_PUBLIC_COOKIE_PREFIX` is
    // picked up at runtime for EVERY project without each one re-declaring it.
    // This is the dedicated, OPT-IN override for the auth cookie namespace (see
    // resolveLtCookiePrefix), letting a project run fully autonomously on a
    // shared host. Empty default keeps the legacy `lt-auth-state` /
    // `lt-jwt-token` names (fully backward compatible — `storagePrefix` does NOT
    // affect cookie names). MUST mirror the backend `COOKIE_PREFIX` env so both
    // sides agree.
    if (!(rc.public as any).cookiePrefix) {
      (rc.public as any).cookiePrefix = '';
    }

    // Add runtime config
    nuxt.options.runtimeConfig.public.ltExtensions = {
      ai: {
        basePath: resolvedOptions.ai?.basePath || '/ai',
        enabled: resolvedOptions.ai?.enabled ?? true,
      },
      auth: {
        basePath: resolvedOptions.auth?.basePath || '/iam',
        baseURL: resolvedOptions.auth?.baseURL || '',
        cookieNames: {
          state: resolvedOptions.auth?.cookieNames?.state || DEFAULT_LT_AUTH_STATE_COOKIE,
          token: resolvedOptions.auth?.cookieNames?.token || DEFAULT_LT_JWT_TOKEN_COOKIE,
        },
        enabled: resolvedOptions.auth?.enabled ?? true,
        enableAdmin: resolvedOptions.auth?.enableAdmin ?? true,
        enablePasskey: resolvedOptions.auth?.enablePasskey ?? true,
        enableTwoFactor: resolvedOptions.auth?.enableTwoFactor ?? true,
        interceptor: {
          enabled: resolvedOptions.auth?.interceptor?.enabled ?? true,
          publicPaths: resolvedOptions.auth?.interceptor?.publicPaths || [],
        },
        loginPath: resolvedOptions.auth?.loginPath || '/auth/login',
        systemSetup: {
          enabled: resolvedOptions.auth?.systemSetup?.enabled ?? false,
          setupPath: resolvedOptions.auth?.systemSetup?.setupPath || '/auth/setup',
        },
        twoFactorRedirectPath: resolvedOptions.auth?.twoFactorRedirectPath || '/auth/2fa',
      },
      errorTranslation: {
        enabled: resolvedOptions.errorTranslation?.enabled ?? true,
        defaultLocale: resolvedOptions.errorTranslation?.defaultLocale || 'de',
      },
      tus: {
        defaultChunkSize: resolvedOptions.tus?.defaultChunkSize || 5 * 1024 * 1024,
        defaultEndpoint: resolvedOptions.tus?.defaultEndpoint || '/files/upload',
      },
    };

    // Add explicit imports to avoid duplicates
    addImports([
      // Composables
      { name: 'useLtAuth', from: resolve('./runtime/composables/auth/use-lt-auth') },
      { name: 'useLtAuthClient', from: resolve('./runtime/composables/use-lt-auth-client') },
      { name: 'ltAuthClient', from: resolve('./runtime/composables/use-lt-auth-client') },
      {
        name: 'useLtErrorTranslation',
        from: resolve('./runtime/composables/use-lt-error-translation'),
      },
      { name: 'useLtFile', from: resolve('./runtime/composables/use-lt-file') },
      { name: 'useLtTusUpload', from: resolve('./runtime/composables/use-lt-tus-upload') },
      { name: 'useLtShare', from: resolve('./runtime/composables/use-lt-share') },
      { name: 'useSystemSetup', from: resolve('./runtime/composables/auth/use-system-setup') },
      // Utils
      { name: 'ltSha256', from: resolve('./runtime/utils/crypto') },
      { name: 'ltArrayBufferToBase64Url', from: resolve('./runtime/utils/crypto') },
      { name: 'ltBase64UrlToUint8Array', from: resolve('./runtime/utils/crypto') },
      { name: 'tw', from: resolve('./runtime/utils/tw') },
      // Lib - Auth Client & Plugin Registry
      { name: 'createLtAuthClient', from: resolve('./runtime/lib/auth-client') },
      { name: 'registerLtAuthPlugins', from: resolve('./runtime/lib/auth-client') },
      { name: 'getLtAuthPluginRegistry', from: resolve('./runtime/lib/auth-client') },
      { name: 'clearLtAuthPluginRegistry', from: resolve('./runtime/lib/auth-client') },
      // Lib - Auth State
      { name: 'getLtAuthMode', from: resolve('./runtime/lib/auth-state') },
      { name: 'setLtAuthMode', from: resolve('./runtime/lib/auth-state') },
      { name: 'getLtJwtToken', from: resolve('./runtime/lib/auth-state') },
      { name: 'setLtJwtToken', from: resolve('./runtime/lib/auth-state') },
      { name: 'getLtApiBase', from: resolve('./runtime/lib/auth-state') },
      { name: 'getLtAuthCookieNames', from: resolve('./runtime/lib/auth-state') },
      { name: 'buildLtApiUrl', from: resolve('./runtime/lib/auth-state') },
      { name: 'isLocalDevApiProxy', from: resolve('./runtime/lib/auth-state') },
      { name: 'attemptLtJwtSwitch', from: resolve('./runtime/lib/auth-state') },
      { name: 'isLtAuthenticated', from: resolve('./runtime/lib/auth-state') },
      { name: 'createLtAuthFetch', from: resolve('./runtime/lib/auth-state') },
      { name: 'ltAuthFetch', from: resolve('./runtime/lib/auth-state') },
    ]);

    // AI composables + helpers (only when the AI module is enabled)
    if (resolvedOptions.ai?.enabled !== false) {
      addImports([
        { name: 'useLtAi', from: resolve('./runtime/composables/use-lt-ai') },
        { name: 'useLtAiChat', from: resolve('./runtime/composables/use-lt-ai-chat') },
        { name: 'useLtAiConnections', from: resolve('./runtime/composables/use-lt-ai-connections') },
        { name: 'useLtAiUsage', from: resolve('./runtime/composables/use-lt-ai-usage') },
        { name: 'useLtAiPrompts', from: resolve('./runtime/composables/use-lt-ai-prompts') },
        { name: 'useLtAiPlaceholders', from: resolve('./runtime/composables/use-lt-ai-placeholders') },
        { name: 'useLtAiAdmin', from: resolve('./runtime/composables/use-lt-ai-admin') },
        { name: 'buildLtAiUrl', from: resolve('./runtime/lib/ai') },
        { name: 'ltAiRequest', from: resolve('./runtime/lib/ai') },
        { name: 'parseLtAiSseStream', from: resolve('./runtime/lib/ai') },
      ]);
    }

    // Register transition components
    const transitionComponents = ['LtTransitionFade', 'LtTransitionSlide', 'LtTransitionSlideBottom', 'LtTransitionSlideRevert', 'LtTransitionFadeScale'];

    for (const componentName of transitionComponents) {
      addComponent({
        name: componentName,
        filePath: resolve(`./runtime/components/transition/${componentName}.vue`),
      });
    }

    // Add auth interceptor plugin if enabled
    if (resolvedOptions.auth?.enabled && resolvedOptions.auth?.interceptor?.enabled) {
      addPlugin(resolve('./runtime/plugins/auth-interceptor.client'));
    }

    // Add system setup middleware if enabled
    if (resolvedOptions.auth?.systemSetup?.enabled) {
      addRouteMiddleware({
        name: 'lt-system-setup',
        path: resolve('./runtime/middleware/setup'),
        global: true,
      });
    }

    // Add error translation plugin if enabled
    if (resolvedOptions.errorTranslation?.enabled) {
      addPlugin(resolve('./runtime/plugins/error-translation.client'));
    }

    // i18n integration - merge locale files if @nuxtjs/i18n is installed
    if (resolvedOptions.i18n?.autoMerge) {
      // Cast to any to support @nuxtjs/i18n hook which is not in base NuxtHooks
      (nuxt.hook as any)('i18n:registerModule', (register: (config: { langDir: string; locales: Array<{ code: string; file: string }> }) => void) => {
        register({
          langDir: resolve('./runtime/locales'),
          locales: [
            { code: 'en', file: 'en.json' },
            { code: 'de', file: 'de.json' },
          ],
        });
      });
    }

    // Transpile runtime directory and tus-js-client (ESM compatibility)
    nuxt.options.build.transpile.push(resolve('./runtime'));
    nuxt.options.build.transpile.push('tus-js-client');

    console.log(`[${name}] Module loaded with config:`, {
      auth: resolvedOptions.auth?.enabled ? 'enabled' : 'disabled',
      i18nAutoMerge: resolvedOptions.i18n?.autoMerge,
      tusEndpoint: resolvedOptions.tus?.defaultEndpoint,
    });
  },
});

// =============================================================================
// Type Exports
// =============================================================================
// Re-export all public types for external use
// These can be imported as: import type { LtUser } from '@lenne.tech/nuxt-extensions'

// Single source of truth: every public type lives in src/runtime/types/.
// Forwarding via the barrel prevents the historical drift where this module's
// re-export list silently fell behind src/runtime/types/* and dropped types
// from the consumer-facing dist/types.d.mts. The Vitest export-coverage spec
// (test/public-exports.test.ts) guards against the same drift inside the barrel.
export type * from './runtime/types';
