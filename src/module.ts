/**
 * @lenne.tech/nuxt-extensions
 *
 * Reusable Nuxt 4 composables, components, and Better-Auth integration
 * for lenne.tech projects.
 */

import { addComponent, addImports, addPlugin, createResolver, defineNuxtModule } from "@nuxt/kit";

import type { LtExtensionsModuleOptions } from "./runtime/types";

// Module meta
export const name = "@lenne.tech/nuxt-extensions";
export const version = "1.0.0";
export const configKey = "ltExtensions";

// Default options
const defaultOptions: LtExtensionsModuleOptions = {
  auth: {
    basePath: "/iam",
    baseURL: "",
    enabled: true,
    enableAdmin: true,
    enablePasskey: true,
    enableTwoFactor: true,
    interceptor: {
      enabled: true,
      publicPaths: [],
    },
    loginPath: "/auth/login",
    twoFactorRedirectPath: "/auth/2fa",
  },
  i18n: {
    autoMerge: true,
  },
  tus: {
    defaultChunkSize: 5 * 1024 * 1024, // 5MB
    defaultEndpoint: "/files/upload",
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
      auth: { ...defaultOptions.auth, ...options.auth },
      i18n: { ...defaultOptions.i18n, ...options.i18n },
      tus: { ...defaultOptions.tus, ...options.tus },
    };

    // Add runtime config
    nuxt.options.runtimeConfig.public.ltExtensions = {
      auth: {
        basePath: resolvedOptions.auth?.basePath || "/iam",
        baseURL: resolvedOptions.auth?.baseURL || "",
        enabled: resolvedOptions.auth?.enabled ?? true,
        enableAdmin: resolvedOptions.auth?.enableAdmin ?? true,
        enablePasskey: resolvedOptions.auth?.enablePasskey ?? true,
        enableTwoFactor: resolvedOptions.auth?.enableTwoFactor ?? true,
        interceptor: {
          enabled: resolvedOptions.auth?.interceptor?.enabled ?? true,
          publicPaths: resolvedOptions.auth?.interceptor?.publicPaths || [],
        },
        loginPath: resolvedOptions.auth?.loginPath || "/auth/login",
        twoFactorRedirectPath: resolvedOptions.auth?.twoFactorRedirectPath || "/auth/2fa",
      },
      tus: {
        defaultChunkSize: resolvedOptions.tus?.defaultChunkSize || 5 * 1024 * 1024,
        defaultEndpoint: resolvedOptions.tus?.defaultEndpoint || "/files/upload",
      },
    };

    // Add explicit imports to avoid duplicates
    addImports([
      // Composables
      { name: "useLtAuth", from: resolve("./runtime/composables/auth/use-lt-auth") },
      { name: "useLtAuthClient", from: resolve("./runtime/composables/use-lt-auth-client") },
      { name: "ltAuthClient", from: resolve("./runtime/composables/use-lt-auth-client") },
      { name: "useLtFile", from: resolve("./runtime/composables/use-lt-file") },
      { name: "useLtTusUpload", from: resolve("./runtime/composables/use-lt-tus-upload") },
      { name: "useLtShare", from: resolve("./runtime/composables/use-lt-share") },
      // Utils
      { name: "ltSha256", from: resolve("./runtime/utils/crypto") },
      { name: "ltArrayBufferToBase64Url", from: resolve("./runtime/utils/crypto") },
      { name: "ltBase64UrlToUint8Array", from: resolve("./runtime/utils/crypto") },
      { name: "tw", from: resolve("./runtime/utils/tw") },
      // Lib - Auth State
      { name: "createLtAuthClient", from: resolve("./runtime/lib/auth-client") },
      { name: "getLtAuthMode", from: resolve("./runtime/lib/auth-state") },
      { name: "setLtAuthMode", from: resolve("./runtime/lib/auth-state") },
      { name: "getLtJwtToken", from: resolve("./runtime/lib/auth-state") },
      { name: "setLtJwtToken", from: resolve("./runtime/lib/auth-state") },
      { name: "getLtApiBase", from: resolve("./runtime/lib/auth-state") },
      { name: "attemptLtJwtSwitch", from: resolve("./runtime/lib/auth-state") },
      { name: "isLtAuthenticated", from: resolve("./runtime/lib/auth-state") },
      { name: "createLtAuthFetch", from: resolve("./runtime/lib/auth-state") },
      { name: "ltAuthFetch", from: resolve("./runtime/lib/auth-state") },
    ]);

    // Register transition components
    const transitionComponents = [
      "LtTransitionFade",
      "LtTransitionSlide",
      "LtTransitionSlideBottom",
      "LtTransitionSlideRevert",
      "LtTransitionFadeScale",
    ];

    for (const componentName of transitionComponents) {
      addComponent({
        name: componentName,
        filePath: resolve(`./runtime/components/transition/${componentName}.vue`),
      });
    }

    // Add auth interceptor plugin if enabled
    if (resolvedOptions.auth?.enabled && resolvedOptions.auth?.interceptor?.enabled) {
      addPlugin(resolve("./runtime/plugins/auth-interceptor.client"));
    }

    // i18n integration - merge locale files if @nuxtjs/i18n is installed
    if (resolvedOptions.i18n?.autoMerge) {
      // @ts-expect-error - i18n:registerModule is only available when @nuxtjs/i18n is installed
      nuxt.hook(
        "i18n:registerModule",
        (
          register: (config: {
            langDir: string;
            locales: Array<{ code: string; file: string }>;
          }) => void,
        ) => {
          register({
            langDir: resolve("./runtime/locales"),
            locales: [
              { code: "en", file: "en.json" },
              { code: "de", file: "de.json" },
            ],
          });
        },
      );
    }

    // Transpile runtime directory and tus-js-client (ESM compatibility)
    nuxt.options.build.transpile.push(resolve("./runtime"));
    nuxt.options.build.transpile.push("tus-js-client");

    console.log(`[${name}] Module loaded with config:`, {
      auth: resolvedOptions.auth?.enabled ? "enabled" : "disabled",
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

// Auth Types
export type {
  LtAuthClientConfig,
  LtAuthMode,
  LtAuthResponse,
  LtAuthState,
  LtPasskeyAuthResult,
  LtPasskeyRegisterResult,
  LtUser,
  UseLtAuthReturn,
} from "./runtime/types/auth";

// Upload Types
export type {
  LtFileInfo,
  LtUploadItem,
  LtUploadOptions,
  LtUploadProgress,
  LtUploadStatus,
  UseLtFileReturn,
  UseLtTusUploadReturn,
} from "./runtime/types/upload";

// Module Types
export type {
  LtAuthModuleOptions,
  LtExtensionsModuleOptions,
  LtExtensionsPublicRuntimeConfig,
  LtI18nModuleOptions,
  LtTusModuleOptions,
} from "./runtime/types/module";
