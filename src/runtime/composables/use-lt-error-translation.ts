/**
 * Error Translation Composable
 *
 * Translates backend error codes to user-friendly messages.
 * Works with or without @nuxtjs/i18n.
 *
 * Backend error format: "#LTNS_0100: Unauthorized - User is not logged in"
 * Translations loaded from: GET /i18n/errors/:locale
 *
 * URL handling is delegated to {@link buildLtApiUrl} (SSR / proxy / direct).
 *
 * Until the translations for the current locale are loaded, `translateError` returns the
 * developer message. The plugin starts the load after the app is mounted and does not wait
 * for it (DEV-4078); every instance shares that request, see {@link inFlightLoads}.
 */

import type { LtErrorTranslationResponse, LtParsedError, UseLtErrorTranslationReturn } from '../types/error';

import { computed, useState, useNuxtApp, useRuntimeConfig } from '#imports';
import { buildLtApiUrl } from '../lib/auth-state';
import { ltAddToast } from '../lib/toast';

// Regex to parse #CODE: Message format
const ERROR_CODE_REGEX = /^#([A-Z_]+_\d+):\s*(.+)$/;

/**
 * Loads in flight, per Nuxt app and locale. Every instance of the composable shares them: the
 * plugin's load after mount and a component's `await loadTranslations()` are one request, and
 * the component's `await` returns once the translations are there, not while they are still on
 * the way. Keyed by the app, so on the server, where each request has an app of its own, no
 * load is shared across requests.
 */
const inFlightLoads = new WeakMap<object, Map<string, Promise<void>>>();

function inFlightLoadsOf(app: object): Map<string, Promise<void>> {
  let loads = inFlightLoads.get(app);
  if (!loads) {
    loads = new Map();
    inFlightLoads.set(app, loads);
  }
  return loads;
}

/**
 * Error Translation composable
 *
 * @returns Functions and state for error translation
 *
 * @example
 * ```typescript
 * const { translateError, showErrorToast, parseError } = useLtErrorTranslation();
 *
 * // Translate error from API response
 * const message = translateError(error.message);
 * // Input: "#LTNS_0100: Unauthorized - User is not logged in"
 * // Output: "Sie sind nicht angemeldet." (when locale is 'de')
 *
 * // Show error as toast
 * showErrorToast(error, 'Login fehlgeschlagen');
 *
 * // Parse error for custom handling
 * const parsed = parseError(error.message);
 * // { code: 'LTNS_0100', developerMessage: 'Unauthorized...', translatedMessage: '...' }
 * ```
 */
export function useLtErrorTranslation(): UseLtErrorTranslationReturn {
  const nuxtApp = useNuxtApp();
  const runtimeConfig = useRuntimeConfig();

  // Shared state for translations (SSR-compatible)
  const translations = useState<Record<string, Record<string, string>>>('lt-error-translations', () => ({}));
  // Shared like the loads themselves: `true` while any instance's load is in flight.
  const isLoading = useState<boolean>('lt-error-translations-loading', () => false);

  // Get module config
  const config = runtimeConfig.public?.ltExtensions?.errorTranslation;

  /**
   * Helper function for i18n with German fallback
   */
  function t(key: string, germanFallback: string): string {
    const i18n = (nuxtApp as any).$i18n;

    // No i18n installed -> German (for single-language DE projects)
    if (!i18n?.t) {
      return germanFallback;
    }
    // i18n installed -> use i18n
    return i18n.t(key);
  }

  /**
   * Detect current locale
   * Priority: i18n > browser language > config default > 'de'
   */
  function detectLocale(): string {
    // 1. Check @nuxtjs/i18n
    const i18n = (nuxtApp as any).$i18n;
    if (i18n?.locale?.value) {
      return i18n.locale.value;
    }

    // 2. Check browser language (client-side only)
    if (import.meta.client && navigator?.language) {
      const browserLang = navigator.language.split('-')[0] ?? 'de';
      if (['de', 'en'].includes(browserLang)) {
        return browserLang as string;
      }
    }

    // 3. Config default or fallback to 'de'
    return config?.defaultLocale || 'de';
  }

  function buildErrorUrl(locale: string): string {
    return buildLtApiUrl(`/i18n/errors/${locale}`);
  }

  /**
   * Load translations for a locale from backend.
   *
   * Resolves once they are in the shared state, or once the load failed (logged, never
   * rejected): `translateError` then keeps returning the developer message, and the next
   * call tries again. A call for a locale that is already loading waits for that request.
   */
  function loadTranslations(locale?: string): Promise<void> {
    const targetLocale = locale || detectLocale();

    // Already loaded
    if (translations.value[targetLocale]) {
      return Promise.resolve();
    }

    // Already loading: wait for the same request
    const loads = inFlightLoadsOf(nuxtApp);
    const pending = loads.get(targetLocale);
    if (pending) {
      return pending;
    }

    let url: string;
    try {
      // Built now, while the Nuxt context exists; it is gone after the first `await`.
      url = buildErrorUrl(targetLocale);
    } catch (error) {
      console.warn(`[LtErrorTranslation] Failed to load translations for ${targetLocale}:`, error);
      return Promise.resolve();
    }

    isLoading.value = true;
    const load = fetchTranslations(url, targetLocale).finally(() => {
      loads.delete(targetLocale);
      isLoading.value = loads.size > 0;
    });
    loads.set(targetLocale, load);
    return load;
  }

  async function fetchTranslations(url: string, targetLocale: string): Promise<void> {
    try {
      const response = await $fetch<LtErrorTranslationResponse>(url);

      if (response?.errors) {
        translations.value = {
          ...translations.value,
          [targetLocale]: response.errors,
        };
      }
    } catch (error) {
      console.warn(`[LtErrorTranslation] Failed to load translations for ${targetLocale}:`, error);
    }
  }

  /**
   * Extract message string from various error formats
   */
  function extractMessage(errorOrMessage: unknown): string {
    if (typeof errorOrMessage === 'string') {
      return errorOrMessage;
    }

    if (errorOrMessage instanceof Error) {
      // The response body wins over the thrown message, and that ordering is the whole
      // point. ofetch's `FetchError` extends `Error`, puts the TRANSPORT line in `message`
      // (`[POST] "/iam/reset-password": 400 Bad Request`) and the parsed body in `data`.
      // The backend's own message — the only one that can carry a `#LTNS_` marker — lives
      // in the body. This branch used to return `message` unconditionally, so the
      // `obj.data?.message` fallback below was unreachable for every real fetch error and
      // the user was shown the transport line verbatim.
      const body = (errorOrMessage as { data?: { message?: unknown } }).data;
      if (typeof body?.message === 'string' && body.message) {
        return body.message;
      }
      return errorOrMessage.message;
    }

    if (typeof errorOrMessage === 'object' && errorOrMessage !== null) {
      const obj = errorOrMessage as any;
      // Try common error response formats
      return obj.message || obj.error?.message || obj.data?.message || obj.statusMessage || String(obj);
    }

    return String(errorOrMessage);
  }

  /**
   * Parse a backend error to extract code and messages
   */
  function parseError(errorOrMessage: unknown): LtParsedError {
    const message = extractMessage(errorOrMessage);

    // Parse #CODE: Message format
    const match = message.match(ERROR_CODE_REGEX);

    if (match) {
      const code = match[1] || '';
      const developerMessage = match[2] || '';
      const locale = detectLocale();
      const localeTranslations = translations.value[locale] || {};
      const translatedMessage = localeTranslations[code] || developerMessage;

      return {
        code,
        developerMessage,
        translatedMessage,
      };
    }

    // No code found, return original message
    return {
      code: null,
      developerMessage: message,
      translatedMessage: message,
    };
  }

  /**
   * Translate an error to user-friendly message.
   *
   * Never returns an empty string for an error that carries a message — which is why
   * `translateError(x) || 'Fallback'` is a no-op. The full contract lives on
   * `UseLtErrorTranslationReturn` in `runtime/types/error.ts`, the surface consumers
   * actually read; one copy cannot drift from itself.
   */
  function translateError(errorOrMessage: unknown): string {
    const parsed = parseError(errorOrMessage);
    return parsed.translatedMessage;
  }

  /**
   * Show translated error as toast notification
   */
  function showErrorToast(errorOrMessage: unknown, title?: string): void {
    if (!import.meta.client) {
      return;
    }

    const parsed = parseError(errorOrMessage);

    // Show it via Nuxt UI's toaster. `runWithContext` keeps the Nuxt instance
    // available when this is called from outside a component (e.g. after an
    // awaited API call in a composable), which `useToast()` needs for `useState`.
    const shown = nuxtApp.runWithContext(() =>
      ltAddToast({
        color: 'error',
        description: parsed.translatedMessage,
        title: title || t('lt.error.title', 'Fehler'),
      }),
    );

    // No toaster in this app (Nuxt UI not installed) — never swallow the error.
    if (!shown) {
      console.error('[LtErrorTranslation]', parsed.translatedMessage);
    }
  }

  // Computed properties
  const currentLocale = computed(() => detectLocale());
  const isLoaded = computed(() => !!translations.value[currentLocale.value]);

  return {
    translateError,
    parseError,
    showErrorToast,
    loadTranslations,
    isLoaded,
    isLoading,
    currentLocale,
  };
}
