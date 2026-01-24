/**
 * Error Translation Composable
 *
 * Translates backend error codes to user-friendly messages.
 * Works with or without @nuxtjs/i18n.
 *
 * Backend error format: "#LTNS_0100: Unauthorized - User is not logged in"
 * Translations loaded from: GET /api/i18n/errors/:locale
 */

import type {
  LtErrorTranslationResponse,
  LtParsedError,
  UseLtErrorTranslationReturn,
} from "../types/error";

import { computed, ref, useState, useNuxtApp, useRuntimeConfig } from "#imports";

// Regex to parse #CODE: Message format
const ERROR_CODE_REGEX = /^#([A-Z_]+_\d+):\s*(.+)$/;

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
  const translations = useState<Record<string, Record<string, string>>>(
    "lt-error-translations",
    () => ({}),
  );
  const isLoading = ref(false);

  // Get module config
  const config = runtimeConfig.public?.ltExtensions?.errorTranslation;

  /**
   * Helper function for i18n with German fallback
   */
  function t(key: string, germanFallback: string): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const i18n = (nuxtApp as any).$i18n;
    if (i18n?.locale?.value) {
      return i18n.locale.value;
    }

    // 2. Check browser language (client-side only)
    if (import.meta.client && navigator?.language) {
      const browserLang = navigator.language.split("-")[0] ?? "de";
      if (["de", "en"].includes(browserLang)) {
        return browserLang as string;
      }
    }

    // 3. Config default or fallback to 'de'
    return config?.defaultLocale || "de";
  }

  /**
   * Get API base URL
   */
  function getApiBase(): string {
    // Use auth baseURL if available, otherwise empty (relative)
    return runtimeConfig.public?.ltExtensions?.auth?.baseURL || "";
  }

  /**
   * Load translations for a locale from backend
   */
  async function loadTranslations(locale?: string): Promise<void> {
    const targetLocale = locale || detectLocale();

    // Already loaded
    if (translations.value[targetLocale]) {
      return;
    }

    // Already loading
    if (isLoading.value) {
      return;
    }

    isLoading.value = true;

    try {
      const apiBase = getApiBase();
      const response = await $fetch<LtErrorTranslationResponse>(
        `${apiBase}/api/i18n/errors/${targetLocale}`,
      );

      if (response?.errors) {
        translations.value = {
          ...translations.value,
          [targetLocale]: response.errors,
        };
      }
    } catch (error) {
      console.warn(`[LtErrorTranslation] Failed to load translations for ${targetLocale}:`, error);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Extract message string from various error formats
   */
  function extractMessage(errorOrMessage: unknown): string {
    if (typeof errorOrMessage === "string") {
      return errorOrMessage;
    }

    if (errorOrMessage instanceof Error) {
      return errorOrMessage.message;
    }

    if (typeof errorOrMessage === "object" && errorOrMessage !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = errorOrMessage as any;
      // Try common error response formats
      return (
        obj.message || obj.error?.message || obj.data?.message || obj.statusMessage || String(obj)
      );
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
      const code = match[1] || "";
      const developerMessage = match[2] || "";
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
   * Translate an error to user-friendly message
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

    // Use Nuxt UI useToast composable via nuxtApp context
    try {
      nuxtApp.runWithContext(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toastComposable = (nuxtApp as any).useToast || (globalThis as any).useToast;
        if (typeof toastComposable === "function") {
          const toast = toastComposable();
          toast.add({
            color: "error",
            title: title || t("lt.error.title", "Fehler"),
            description: parsed.translatedMessage,
          });
        } else {
          // Nuxt UI not available, fallback to console
          console.error("[LtErrorTranslation]", parsed.translatedMessage);
        }
      });
    } catch {
      // Toast failed, log to console
      console.error("[LtErrorTranslation]", parsed.translatedMessage);
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
