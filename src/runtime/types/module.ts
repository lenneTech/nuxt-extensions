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
  /** Form label association repair configuration */
  formLabelAssociation?: LtFormLabelAssociationOptions;
  /** i18n configuration */
  i18n?: LtI18nModuleOptions;
  /** Pre-hydration input preservation configuration */
  preHydrationInput?: LtPreHydrationInputOptions;
  /** TUS upload module configuration */
  tus?: LtTusModuleOptions;
}

/**
 * Repair of `<label for>` associations broken by an SSR/client `useId()` divergence.
 *
 * Nuxt UI's `FormField` derives the label's `for` and the control's `id` from ONE `useId()`
 * call, so they cannot disagree — unless `useId()` itself returns different values on server
 * and client, which it does whenever the two walk a different number of async boundaries.
 * The label then keeps the server value while the control adopts the client one.
 *
 * The control loses its programmatic label. Without a placeholder it has no accessible name
 * at all and a screen reader announces "edit text, blank"; with one, the placeholder becomes
 * the name instead, so the visible label is no longer part of it and speech input stops
 * working. Either way clicking the label focuses nothing — which on a checkbox or radio is
 * the primary hit target, not a convenience.
 *
 * Vue >= 3.5.39 did not cause this, it exposed it: vuejs/core#9083 force-patches an element's
 * dynamic props during hydration, and the control's `id` is one while the label's `for` —
 * passed through reka-ui's `Label` component and `$attrs` — is not.
 *
 * The repair refuses to guess: it only fires when the field contains exactly one eligible
 * control, so a radio or checkbox group is skipped rather than having every caption bound to
 * its first option.
 *
 * @example
 * ```ts
 * export default defineNuxtConfig({
 *   ltExtensions: {
 *     formLabelAssociation: { enabled: false },
 *   },
 * });
 * ```
 */
export interface LtFormLabelAssociationOptions {
  /**
   * Enable the repair. Defaults to `true`.
   *
   * Turn it off only with a reason. Two real ones: an application that assigns `for` itself
   * and depends on those exact values, or a test suite asserting on literal `for` / `id`
   * strings rather than on the accessible name. The alternative is a form whose fields carry
   * no programmatic label.
   */
  enabled?: boolean;

  /**
   * How long after mount to keep repairing, in milliseconds. Defaults to `1500`; `0` sweeps
   * once and stops. Values above 30000 are clamped, and a non-finite value is treated as `0` —
   * a delay past 2^31 overflows `setTimeout` and fires immediately, silently turning an
   * over-large window into no window at all.
   *
   * Most fields are repaired in the first pass. The window exists for server-rendered subtrees
   * whose hydration is deferred — an unresolved `<Suspense>`, an island — which carry the same
   * divergence but hydrate after `app:mounted`. It does NOT reach `hydrate-on-visible` or
   * `hydrate-on-interaction`, which can fire minutes later; `observeDeferred` covers those.
   */
  maxRepairMs?: number;

  /**
   * Keep watching for server-rendered subtrees that hydrate after the window closes.
   * Defaults to `true`.
   *
   * `hydrate-on-visible` fires on scroll and `hydrate-on-interaction` on a click — either can
   * be long after mount, and both carry the very same divergence, so no fixed window reaches
   * them. A `MutationObserver` does, and it costs nothing while nothing changes: it reacts
   * only to added subtrees that actually contain a field label, and coalesces a burst into one
   * sweep per frame.
   *
   * Turn it off if your application renders no lazily hydrated server content and you would
   * rather not carry an observer at all; the bounded window then remains the only mechanism.
   */
  observeDeferred?: boolean;
}

/**
 * Pre-hydration input preservation.
 *
 * Until Vue hydrates a server-rendered `<input>`, the element carries no framework listener:
 * text typed into it reaches no model and is then overwritten by the mounting value — ERASED,
 * not delayed.
 *
 * Vue fixed this in 3.5.41 (vuejs/core#14411), but only for `type="text"` and `textarea`.
 * Every other type still loses the entry: `email`, `password`, `tel`, `url`, `search`,
 * `number` — precisely the fields a sign-in form uses, and where people are most likely to
 * type on sight. Widening it is tracked upstream as vuejs/core#15210.
 *
 * This closes that remaining gap: what the user typed is read out of the DOM just before
 * hydration and written back afterwards, with a synthetic `input` event so `v-model` adopts
 * it. Fields stay ordinary editable fields throughout — nothing is made `readonly`, so
 * autofill, screen-reader semantics and the mobile keyboard are untouched. A browser autofill
 * that lands before hydration is recovered the same way.
 *
 * Applies to every `<input>` and `<textarea>` on the page, regardless of which UI library
 * rendered it. It is a stopgap and is meant to be removed once Vue covers the remaining
 * types.
 *
 * @example
 * ```ts
 * export default defineNuxtConfig({
 *   ltExtensions: {
 *     preHydrationInput: { enabled: false },
 *   },
 * });
 * ```
 */
export interface LtPreHydrationInputOptions {
  /**
   * Enable preservation. Defaults to `true`.
   *
   * Turn it off only with a reason: the alternative is that a user who types immediately
   * after a page appears loses the entry silently.
   */
  enabled?: boolean;

  /**
   * How long after mount to keep restoring, in milliseconds. Defaults to `1500`; `0` restores
   * once and stops immediately.
   *
   * Most fields are repaired in the first pass. The window exists for subtrees whose mount is
   * deferred — an unresolved `<Suspense>` boundary writes its model value later than
   * `app:mounted`. When it elapses the snapshot is dropped, so preserved values, passwords
   * included, are not kept alive for the session.
   */
  maxRestoreMs?: number;
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
    formLabelAssociation: {
      enabled: boolean;
      maxRepairMs: number;
      observeDeferred: boolean;
    };
    preHydrationInput: {
      enabled: boolean;
      maxRestoreMs: number;
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
