/**
 * @lenne.tech/nuxt-extensions
 *
 * Reusable Nuxt 4 composables, components, and Better-Auth integration
 * for lenne.tech projects.
 */

import { addComponent, addImports, addPlugin, addRouteMiddleware, createResolver, defineNuxtModule, tryResolveModule } from '@nuxt/kit';
import { pathToFileURL } from 'node:url';

import type { LtExtensionsModuleOptions } from './runtime/types';

// Module meta
export const name = '@lenne.tech/nuxt-extensions';
export const version = '1.15.0';
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
  formLabelAssociation: {
    enabled: true,
  },
  i18n: {
    autoMerge: true,
  },
  preHydrationInput: {
    enabled: true,
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
      formLabelAssociation: { ...defaultOptions.formLabelAssociation, ...options.formLabelAssociation },
      i18n: { ...defaultOptions.i18n, ...options.i18n },
      preHydrationInput: { ...defaultOptions.preHydrationInput, ...options.preHydrationInput },
      tus: { ...defaultOptions.tus, ...options.tus },
    };

    // `@better-auth/passkey` is an OPTIONAL peer, but `auth-client.ts` imports
    // `passkeyClient` at the top level — so the bundler must resolve the
    // specifier even when a project never enables passkeys. Alias it onto a
    // no-op stub when the package is absent, otherwise the build fails with an
    // unresolved-optional-peer error instead of honouring the optionality.
    // Resolve from the CONSUMER's root as well as from this module's own location.
    // Under a strict (non-hoisted) install the package sits in the consumer's tree and is
    // not reachable from here — resolving only against `import.meta.url` would report it
    // absent, silently alias the stub, and disable passkeys with nothing but a warning.
    const passkeyAvailable = !!(await tryResolveModule('@better-auth/passkey/client', [new URL(import.meta.url), pathToFileURL(`${nuxt.options.rootDir}/`)]));
    if (!passkeyAvailable) {
      const passkeyStub = resolve('./runtime/lib/passkey-stub');
      nuxt.options.alias['@better-auth/passkey/client'] = passkeyStub;
      nuxt.options.nitro ??= {};
      nuxt.options.nitro.alias = { ...nuxt.options.nitro.alias, '@better-auth/passkey/client': passkeyStub };
    }

    // Passkeys need the package, no matter what the project asked for.
    const enablePasskey = (resolvedOptions.auth?.enablePasskey ?? true) && passkeyAvailable;
    if ((resolvedOptions.auth?.enablePasskey ?? true) && !passkeyAvailable) {
      console.warn(
        `[${name}] Passkey support disabled: the optional peer dependency "@better-auth/passkey" is not installed. ` +
          'Install it to use passkeys, or set `ltExtensions.auth.enablePasskey = false` to silence this warning.',
      );
    }

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
        enablePasskey,
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
      formLabelAssociation: {
        enabled: resolvedOptions.formLabelAssociation?.enabled ?? true,
        maxRepairMs: resolvedOptions.formLabelAssociation?.maxRepairMs ?? 1500,
        observeDeferred: resolvedOptions.formLabelAssociation?.observeDeferred ?? true,
      },
      preHydrationInput: {
        enabled: resolvedOptions.preHydrationInput?.enabled ?? true,
        maxRestoreMs: resolvedOptions.preHydrationInput?.maxRestoreMs ?? 1500,
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

    // Validate the resolved API URL once at app init rather than on every
    // buildLtApiUrl() call. Warnings are one-shot and shared with buildLtApiUrl,
    // so a misconfigured app reports it exactly once per process / page load.
    addPlugin(resolve('./runtime/plugins/lt-config-check'));

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

    // =========================================================================
    // Pre-hydration input preservation
    // =========================================================================
    // Vue 3.5.41 already keeps text typed before hydration — but only for `type="text"`
    // and `textarea` (vuejs/core#14411). Every other type, sign-in fields included, is
    // still erased. This plugin is a stopgap for that gap; see its header for the
    // upstream issue that will make it removable.
    if (resolvedOptions.preHydrationInput.enabled !== false) {
      addPlugin(resolve('./runtime/plugins/pre-hydration-input.client'));
    }

    // A control whose `<label for>` no longer resolves loses its programmatic label: no
    // accessible name at all without a placeholder, the placeholder as a WRONG name with
    // one, and a caption that is dead to the mouse either way. The ids diverge between SSR
    // and client because the control's `id` is force-patched on hydration while the label's
    // `for` — a prop on reka-ui's Label component — is not. See the plugin header for the
    // measurement, the upstream reference, and why the repair refuses to guess.
    if (resolvedOptions.formLabelAssociation.enabled !== false) {
      addPlugin(resolve('./runtime/plugins/form-label-association.client'));
    }

    // Transpile runtime directory and tus-js-client (ESM compatibility)
    nuxt.options.build.transpile.push(resolve('./runtime'));
    nuxt.options.build.transpile.push('tus-js-client');

    // One terse line, ALWAYS — `scripts/check-consumer-build.mjs` asserts that this
    // module's name appears in a consumer's `nuxt build` output, which is how it proves
    // the packed tarball actually registered rather than silently doing nothing. A build
    // can succeed with the module inert; this line is the evidence that it did not.
    //
    // Do NOT gate this on `nuxt.options.dev`. It was tried (1.15.0) and it turned the
    // release gate red: `✗ the packed module never announced itself during the build`.
    // Naming itself once is also what every Nuxt module does, so it is not noise.
    console.log(`[${name}] v${version}`);

    // The verbose config dump IS dev-only — it fires once per build in every consuming
    // project and has no diagnostic value in someone else's production CI log.
    if (nuxt.options.dev) {
      console.log(`[${name}] Module loaded with config:`, {
        auth: resolvedOptions.auth?.enabled ? 'enabled' : 'disabled',
        i18nAutoMerge: resolvedOptions.i18n?.autoMerge,
        tusEndpoint: resolvedOptions.tus?.defaultEndpoint,
      });
    }
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
